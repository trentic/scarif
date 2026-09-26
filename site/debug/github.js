// Minimal GitHub REST client for reading and committing the archive.
// Several files (archive.json + media) go into one commit through the Git
// Data API, so the published site never sees a half-finished change.

const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

const textToBase64 = (text) => bytesToBase64(new TextEncoder().encode(text));
const base64ToText = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));

export class GitHub {
  constructor(token, { owner, repo, branch, siteDir }) {
    this.token = token;
    this.owner = owner;
    this.repo = repo;
    this.branch = branch || null;
    this.siteDir = siteDir.replace(/\/+$/, '');
  }

  async req(path, { method = 'GET', body } = {}) {
    const res = await fetch(`${API}/repos/${this.owner}/${this.repo}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    }).catch(() => {
      throw new GitHubError("Couldn't reach GitHub. Check your connection.", 0);
    });
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) {
      const msg =
        res.status === 401 ? 'GitHub rejected the token (it may have expired or been revoked).' :
        res.status === 403 ? 'The token is missing permission. It needs "Contents: Read and write" on this repository.' :
        res.status === 404 ? `Repository ${this.owner}/${this.repo} not found, or the token can't see it.` :
        data?.message || `GitHub error ${res.status}`;
      throw new GitHubError(msg, res.status);
    }
    return data;
  }

  // Confirms the token can push, and learns the default branch.
  async checkAccess() {
    const info = await this.req('');
    if (!info.permissions?.push) {
      throw new GitHubError('This token can read the repository but not write to it. Give it "Contents: Read and write".', 403);
    }
    this.branch ||= info.default_branch;
    return info;
  }

  async head() {
    if (!this.branch) await this.checkAccess();
    const ref = await this.req(`/git/ref/heads/${encodeURIComponent(this.branch)}`);
    const commit = await this.req(`/git/commits/${ref.object.sha}`);
    return { sha: ref.object.sha, tree: commit.tree.sha };
  }

  async readArchive(ref) {
    try {
      const file = await this.req(`/contents/${this.siteDir}/data/archive.json?ref=${ref}`);
      return JSON.parse(base64ToText(file.content));
    } catch (err) {
      if (err.status === 404) return { updatedAt: null, entries: [] };
      throw err;
    }
  }

  rawUrl(path) {
    if (!path || /^https?:/i.test(path)) return path;
    return `https://raw.githubusercontent.com/${this.owner}/${this.repo}/${this.branch}/${this.siteDir}/${path}`;
  }

  // mutate(archive) → { archive, message, add: [{ path, base64 }], remove: [path] }
  // Retries on top of the new head if someone else committed in between.
  async commitArchive(mutate) {
    const blobCache = new Map();
    for (let attempt = 0; attempt < 4; attempt++) {
      const head = await this.head();
      const current = await this.readArchive(head.sha);
      const change = await mutate(structuredClone(current));
      change.archive.updatedAt = new Date().toISOString();

      const tree = [];
      for (const file of change.add || []) {
        let sha = blobCache.get(file.path);
        if (!sha) {
          sha = (await this.req('/git/blobs', { method: 'POST', body: { content: file.base64, encoding: 'base64' } })).sha;
          blobCache.set(file.path, sha);
        }
        tree.push({ path: `${this.siteDir}/${file.path}`, mode: '100644', type: 'blob', sha });
      }
      for (const path of change.remove || []) {
        tree.push({ path: `${this.siteDir}/${path}`, mode: '100644', type: 'blob', sha: null });
      }
      tree.push({
        path: `${this.siteDir}/data/archive.json`,
        mode: '100644',
        type: 'blob',
        content: `${JSON.stringify(change.archive, null, 2)}\n`,
      });

      const newTree = await this.req('/git/trees', { method: 'POST', body: { base_tree: head.tree, tree } });
      const commit = await this.req('/git/commits', {
        method: 'POST',
        body: { message: change.message, tree: newTree.sha, parents: [head.sha] },
      });
      try {
        await this.req(`/git/refs/heads/${encodeURIComponent(this.branch)}`, { method: 'PATCH', body: { sha: commit.sha, force: false } });
        return change.archive;
      } catch (err) {
        if (err.status !== 422 || attempt === 3) throw err; // 422 = branch moved; retry on the new head
      }
    }
    throw new GitHubError('Could not save after several tries. Reload and try again.', 409);
  }
}

export { textToBase64 };

// Minimal browser side of WebAuthn: converts the server's JSON options into
// what navigator.credentials expects, and the result back into JSON.
const toBuf = (b64url) => {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64url.length / 4) * 4, '=');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
};
const toB64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const supported = () => Boolean(window.PublicKeyCredential && navigator.credentials);

export async function createCredential(opts) {
  const cred = await navigator.credentials.create({
    publicKey: {
      ...opts,
      challenge: toBuf(opts.challenge),
      user: { ...opts.user, id: toBuf(opts.user.id) },
      excludeCredentials: (opts.excludeCredentials || []).map((c) => ({ ...c, id: toBuf(c.id) })),
    },
  });
  return {
    id: cred.id,
    rawId: toB64url(cred.rawId),
    type: cred.type,
    authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
    clientExtensionResults: cred.getClientExtensionResults(),
    response: {
      clientDataJSON: toB64url(cred.response.clientDataJSON),
      attestationObject: toB64url(cred.response.attestationObject),
      transports: cred.response.getTransports?.() || [],
    },
  };
}

export async function getAssertion(opts) {
  const cred = await navigator.credentials.get({
    publicKey: {
      ...opts,
      challenge: toBuf(opts.challenge),
      allowCredentials: (opts.allowCredentials || []).map((c) => ({ ...c, id: toBuf(c.id) })),
    },
  });
  return {
    id: cred.id,
    rawId: toB64url(cred.rawId),
    type: cred.type,
    authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
    clientExtensionResults: cred.getClientExtensionResults(),
    response: {
      clientDataJSON: toB64url(cred.response.clientDataJSON),
      authenticatorData: toB64url(cred.response.authenticatorData),
      signature: toB64url(cred.response.signature),
      userHandle: cred.response.userHandle ? toB64url(cred.response.userHandle) : undefined,
    },
  };
}

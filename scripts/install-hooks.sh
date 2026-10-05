#!/bin/sh
# Installs a git pre-commit hook that refreshes version.json whenever code changes.
hook="$(git rev-parse --git-dir)/hooks/pre-commit"
cat > "$hook" <<'HOOK'
#!/bin/sh
if git diff --cached --name-only | grep -qE '^(js|css|debug)/|^config\.js$'; then
  node scripts/stamp-version.mjs >/dev/null && git add version.json
fi
HOOK
chmod +x "$hook"
echo "Installed $hook"

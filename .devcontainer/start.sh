#!/usr/bin/env bash
# Starts the full app (BFF + built client) inside a GitHub Codespace.
set -euo pipefail
cd "$(dirname "$0")/.."

SECRET_FILE=.devcontainer/.session-secret
[ -s "$SECRET_FILE" ] || node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))" > "$SECRET_FILE"

if [ -n "${CODESPACE_NAME:-}" ]; then
  ORIGIN="https://${CODESPACE_NAME}-8080.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
else
  ORIGIN="http://localhost:8080"
fi

[ -d client/dist ] && [ -d server/dist ] || npm run build

echo "WorldWave Radio: ${ORIGIN}"
# development mode: Codespaces terminates TLS itself, so the app's own HTTP->HTTPS
# redirect and HSTS are not needed here. Everything else (tokens, CSRF, origin checks,
# rate limits, SSRF guard, CSP) is active.
exec env \
  NODE_ENV=development \
  PORT=8080 \
  TRUST_PROXY=1 \
  ALLOWED_ORIGINS="${ORIGIN}" \
  SESSION_SECRET="$(cat "$SECRET_FILE")" \
  INCLUDE_HTTP_STREAMS=false \
  STATIC_DIR="$PWD/client/dist" \
  node server/dist/index.js

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

WorldWave Radio: a React client (`client/`) and a hardened Express "Backend-for-Frontend" (`server/`) that proxies the public Radio Browser API. Three separate npm packages (root, `client/`, `server/`), each with its own lockfile. Node 22+.

## Commands

Run from the repo root unless noted.

- Install everything: `npm run install:all` (uses `npm ci` in all three packages)
- Dev: `npm run dev:server` (tsx watch, :8080) and `npm run dev:client` (Vite, :5173, proxies `/api` to :8080). Open http://localhost:5173 — `ALLOWED_ORIGINS` defaults include it.
- Build + serve from the server: `npm run build && npm start` → http://localhost:8080. The server serves `client/dist` by default (override with `STATIC_DIR`).
- Typecheck: `npm --prefix server run typecheck`, `npm --prefix client run typecheck` (the client build also typechecks)
- Server tests (Vitest + Supertest): `npm test`
  - Single file: `npm --prefix server test -- test/ssrfGuard.test.ts`
  - Single test by name: `npm --prefix server test -- -t "rejects expired tokens"`
  - Redis rate-store tests are skipped unless `TEST_REDIS_URL=redis://127.0.0.1:6379` is set.
- E2E (Playwright): `npm run test:e2e` — builds, then runs `server/dist` on :4173 against `e2e/mock-upstream.mjs` on :4010. No public API traffic. Needs `npx playwright install chromium` once.
- Audit all packages: `npm run audit`

There is no linter configured. CI (`.github/workflows/ci.yml`) runs install, server typecheck, tests with Redis, audit, and e2e.

Dependencies are pinned to exact versions (`.npmrc` `save-exact`); keep it that way when adding packages.

## Architecture

### Request pipeline (server)

`server/src/index.ts` composes dependencies (config → mirror discovery → `RadioBrowserClient` → `RadioCatalog`, Redis or memory `RateStore`) and passes them to `createApp` in `server/src/app.ts`. Tests call `createApp` directly with a fake `Catalog` and `MemoryRateStore` — see `makeApp` in `server/test/app.test.ts`. New dependencies should flow through `AppDeps` the same way.

Middleware order in `app.ts` matters and is the security model:

1. `httpsRedirect`, `securityHeaders` (helmet/CSP) for everything
2. `/api`: `cors` → health endpoint (no auth) → `cookieParser` → `originGuard` → `botGuard` → per-IP rate limit
3. `/api/session` issues/rotates the HMAC session cookie (`ww_session`, HttpOnly) and CSRF token
4. `/api/v1`: `requireSession` → `requireCsrf` → `v1Router` (`server/src/routes/v1.ts`), which adds per-session rate limits and Zod validation per route

Route handlers read validated input via `validate({ params, query })` + `validated(res, ...)` from `security/validate.ts` — never from `req.query` directly. Responses always use the `{ data, meta, error }` envelope (`lib/envelope.ts`). Throw `HttpError`/`UpstreamError` (`lib/errors.ts`); the central error handler turns them into generic client messages and logs details.

### Upstream data path

`upstream/mirrors.ts` (mirror discovery + host allowlist) → `upstream/radioBrowser.ts` (HTTP via `security/ssrfGuard.ts`, which checks resolved IPs inside the socket DNS lookup and on every redirect) → `upstream/schemas.ts` (Zod) → `services/normalize.ts` + `lib/sanitize.ts` (drop unsafe URLs, HTTP-only streams unless `INCLUDE_HTTP_STREAMS`) → `services/catalog.ts` (LRU cache: countries 24 h, stations 1 h, with in-flight request collapsing).

### Client

- Talks only to its own origin through `client/src/api/client.ts`, which bootstraps the session, stores the CSRF token in memory, refreshes before expiry, and re-bootstraps and retries once on 401 (or 403 on non-GET). Don't call third-party APIs from the browser — the README treats that as a hard requirement.
- Hash router in `lib/router.ts` (`#/`, `#/country/IN`, `#/search/<q>`, `#/favourites`, `#/recent`); views in `views/`.
- `state/PlayerContext.tsx` owns the single `<audio>` element and lazy-loads hls.js for HLS streams; `state/PrefsContext.tsx` owns theme/volume/favourites/recent, persisted via `lib/storage.ts` (try/catch, re-validated on read).
- Render station data as text only — no `dangerouslySetInnerHTML`.

## Config gotchas

- `server/src/config.ts` parses env with Zod. `NODE_ENV=production` requires `SESSION_SECRET` (≥32 chars) and turns on HSTS/HTTPS redirect; otherwise a random per-process secret is used, so sessions reset on restart.
- `UPSTREAM_ALLOW_PRIVATE` (lets the SSRF guard reach loopback) is rejected unless `NODE_ENV=test`; e2e relies on it — see `playwright.config.ts` for the full test env.
- Changing CSP or the mixed-content behaviour: read the "Mixed content" and "Deviations and limits" sections of `README.md` first. Proxying audio streams through the server was deliberately rejected.
- The README's "Security checklist" maps each security requirement to its implementing file; update it when moving that code.

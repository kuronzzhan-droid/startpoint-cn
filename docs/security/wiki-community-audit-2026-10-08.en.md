# Security Audit and Fix Report: Community API of the "Xingjian Tujian" Game Wiki

[中文版](wiki-community-audit-2026-10-08.md)

- Author: kuronzzhan-droid (PARADOX)
- Dates: audited 2026-10-08; fix deployed 2026-10-09
- Target: the community API behind https://wf-mod-wiki.pages.dev (Cloudflare Pages Functions with a D1 database)
- Fix commit: [`bdfb6b18`](https://github.com/kuronzzhan-droid/startpoint-cn/commit/bdfb6b18b5f84ab0fc27f4836487e8752fb5321e)

## Summary

I did a white-box security review of the community backend of a fan game wiki that I build and run. The backend handles team sharing, likes, ratings, rankings and an admin console.

I found no authorization, injection or session-hijacking flaws. Two issues needed fixing:

| # | Severity | Issue | Status |
|---|---|---|---|
| 1 | Medium (CVSS 3.1: 5.3) | Rate-limit counters still wrote to the database after a request was rejected. Anonymous traffic could exhaust the D1 free-tier daily write quota and take community features offline until the next reset. | Fixed |
| 2 | Medium (hardening) | The static site had no Content-Security-Policy or other security headers, so a future XSS would have had no second line of defence. | Fixed |

Both were fixed and deployed on 2026-10-09. This report is published after the fix.

## Scope and method

- **Code:** the `mod-tools/wiki-community/` backend and the `mod-tools/wiki/` frontend. The review focused on authentication, authorization, SQL, input validation, uploads, rate limiting and rendering.
- **Method:**
  - Line-by-line source review.
  - Reproduction against an in-memory SQLite database using the project's own request handler, with a local stub for the Turnstile captcha so nothing went over the network.
  - After the fix, the full test suites plus a whole-site regression run locally against the production build.
- **Boundary:** no offensive testing against production. Post-deployment checks were limited to normal browsing and inspecting response headers.

## Finding 1: rate-limit bookkeeping spent the write quota, enabling a quota-exhaustion DoS

**Severity:** Medium, CVSS 3.1 5.3 (`AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L`), CWE-770

### Root cause

Per-IP, per-window counters lived in a D1 table, and the code incremented before checking:

```js
const row = await db.prepare(`INSERT INTO community_limits(key,count,expires_at) VALUES(?,1,?)
  ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count`).bind(key, expires).first();
if (row.count > max) fail(429, 'rate_limited', ...);
```

**Every request that was already over the limit, and got a 429, still wrote a row.** These endpoints reach this code without solving a captcha:

- Team-code lookup: a fully anonymous GET.
- Login: the IP bucket is charged before captcha verification. The Origin check only stops cross-site browser requests; a script can send any Origin.
- Presence heartbeat and character view counts: these need a visitor cookie, but the cookie is free and unlimited.

### Impact

The D1 free tier allows 100,000 row writes per day. Once that is spent, likes, ratings, rankings and admin edits all fail until the daily reset; the static wiki pages keep working. An attacker needs no account and no captcha solves, only a steady request stream from a single machine.

### Reproduction (local in-memory database)

```
GET /game-codes (no captcha): 1000 requests, 404x300 / 429x700, 1001 rows written
POST /auth/login (before captcha): 200 requests, 403x20 / 429x180, 200 rows written
```

The 700 and 180 rejected requests still wrote to the database.

### Fix

1. **Stop writing once the bucket is full.** SQLite's UPSERT supports `DO UPDATE ... WHERE`. When the condition fails, nothing is updated and no row is returned, so an empty result means "over the limit":

   ```js
   const row = await db.prepare(`INSERT INTO community_limits(key,count,expires_at) VALUES(?,1,?)
     ON CONFLICT(key) DO UPDATE SET count=count+1 WHERE community_limits.count<? RETURNING count`)
     .bind(key, expires, max).first();
   if (!row) fail(429, 'rate_limited', ...);
   ```

   The login IP and email buckets got the same change.
2. **Hourly budgets for captcha-free endpoints.** Every allowed request still costs a write, so team-code lookups, presence heartbeats and character views moved from 300 or 120 per minute to 120 per hour per IP.
3. **Frontend fallback.** When recording a character view is rate-limited, the panel now shows the read-only total instead of an "unavailable" state.

### Verification

- The same reproduction after the fix: 1000 lookups wrote 121 rows (120 allowed plus one maintenance lease), and 200 login attempts wrote 20 rows.
- Three regression tests were added or extended: "a full bucket writes no rows", "a full login IP bucket writes nothing", and "a rate-limited view falls back to read-only". The first two fail on the old code and pass on the new code.
- Backend tests: 288 passed and 5 skipped, the same skips as before the change. Frontend tests: 732 passed.

## Finding 2: no CSP or security headers on the static site

**Severity:** Medium (defence-in-depth hardening)

### State before the fix

The site's `_headers` file only set caching rules for media. There was no Content-Security-Policy, X-Frame-Options or similar header.

The frontend had no XSS at the time of the review: all API data is rendered with `textContent`, and there is no `innerHTML`, `insertAdjacentHTML`, `document.write`, `eval` or `new Function` anywhere in the code. However, the backend filters control characters but not angle brackets. If one rendering path ever switched to `innerHTML`, this escalation path would open:

- A semi-trusted editor stores a script in a team note.
- The script runs when the site owner opens the admin console.
- It calls the account-management API with same-origin requests to create a deputy or reset passwords.

Same-origin script passes the Origin check, and SameSite=Strict cookies do not stop it.

### Fix

```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self'; img-src 'self' https: data: blob:; media-src 'self' data:; style-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
```

- Only the two Turnstile sources that Cloudflare's documentation requires are allowed for scripts and frames.
- `img-src https:` is for sponsor images hosted elsewhere, `data:` for CSS mask icons, and `blob:` for upload previews in the admin console.
- `media-src data:` is for a silent clip that unlocks audio in the battle mini-game. The first draft of the policy missed it; it turned up while auditing the battle module's resource usage.

### Verification

- Local whole-site regression found no CSP violations across the catalogue, character pages, voice playback, the battle mode, the share poster, admin login, announcements, the sponsor slot and guide-image uploads.
- Negative probes: an injected inline script, an inline event handler and `eval` were all blocked.
- In production after deployment: the headers are live, browsing the pages produced no console violations, and the Turnstile widget renders.

## Areas confirmed sound

- **SQL:** every query uses bound parameters, and `LIKE` wildcards are escaped.
- **Sessions:** 32-byte random tokens, of which only the SHA-256 hash is stored. Cookies are `__Host-`, HttpOnly, SameSite=Strict and Secure, with an 8-hour lifetime. Every request re-checks the account's enabled flag and password version. Password changes, disables and resets revoke old sessions, and session issuance re-checks the version so concurrent resets cannot race it.
- **Login:** unknown accounts get a dummy key derivation and the same error message, so accounts cannot be enumerated. There are separate IP and email buckets, and Turnstile responses are checked for action and hostname.
- **Authorization:** the owner, deputy and editor roles are enforced both in routing and in SQL `WHERE` clauses.
- **CSRF:** all writes check Origin and `Sec-Fetch-Site`.
- **Uploads:** PNG, JPEG and WebP structures are parsed byte by byte, and SVG and animated images are rejected. Images are served with `nosniff` and a `sandbox` CSP.
- **Private content:** teams that are hidden or moved to a private space cannot leak through guide references.
- **Errors:** visitors never see SQL, secrets or raw exceptions.

## Timeline

| Date | Event |
|---|---|
| 2026-10-08 | Review completed; finding 1 reproduced locally |
| 2026-10-08 | Fix and regression tests completed; local whole-site CSP regression run |
| 2026-10-09 | Fix deployed and checked in production |
| 2026-10-09 | Fix pushed to GitHub; this report published |

## Lessons for Cloudflare D1 developers

1. **Rate limiting has a cost of its own.** On a database billed per row with hard daily quotas, "increment, then check" turns the limiter into an amplifier. Stop writing once a bucket is full, or move limiting in front of the database, for example into WAF rules or in-memory counters.
2. **Budget captcha-free endpoints in rows per day.** For anything anonymous, set thresholds by how many rows they can write per day, not only by requests per minute.
3. **CSP is cheapest early.** With no inline scripts, a strict policy costs almost nothing. Validate it before shipping with a whole-site regression run plus negative probes, so you know it neither breaks pages nor fails open.

## Disclosure

The review, fix and verification were carried out with the help of Claude, an AI assistant made by Anthropic. Every conclusion was confirmed by local reproduction or automated tests, and production checks were limited to normal browsing.

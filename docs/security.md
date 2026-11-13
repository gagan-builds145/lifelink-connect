# LifeLink security architecture

LifeLink is a Vite/React single-page app talking to Convex (queries, mutations,
actions, HTTP actions, auth and storage), plus an optional Python FastAPI ML
service and an optional PX4/ArduPilot SITL bridge. That shape determines where
each control belongs:

- the **browser** is untrusted;
- **Convex functions** are the only trusted data path;
- the **ML service** is a private backend dependency;
- the **SITL bridge** is a local simulation-only CLI;
- the **edge** (nginx + ModSecurity/CRS, or Cloudflare) is where HTTP attacks
  and volumetric abuse are stopped.

> Claim discipline: application-layer controls below are implemented and
> exercised by tests in this repository. The WAF and TLS configuration in
> `deploy/` is a **deployment blueprint**; it is not active in this preview
> environment. Do not describe the WAF as deployed until it is live and verified
> with the checks in [waf-deployment.md](waf-deployment.md).

---

## 1. Layered architecture

```
                       ┌──────────────────────────────────────────┐
 Internet ── TLS ──▶   │ Edge WAF: nginx + ModSecurity + CRS 4.x   │
                       │ TLS 1.2/1.3 · size caps · rate limits     │
                       │ SQLi/XSS/LFI rules · security headers     │
                       └───────────────┬──────────────────────────┘
                                       │
                     ┌─────────────────┴──────────────────┐
                     ▼                                    ▼
        ┌────────────────────────┐          ┌───────────────────────────┐
        │ SPA (static build)     │          │ Convex deployment         │
        │ CSP, no secrets,       │          │ auth + RBAC + ownership   │
        │ masked errors          │          │ audit/security events     │
        └────────────────────────┘          │ input validation          │
                                            └──────┬──────────────┬─────┘
                                                   │              │
                                    ┌──────────────┘              └────────────┐
                                    ▼                                          ▼
                        ┌─────────────────────┐                    ┌────────────────────┐
                        │ ML service (FastAPI)│                    │ SITL bridge (local)│
                        │ bearer token        │                    │ token + fence +    │
                        │ size/rate/timeouts  │                    │ replay ledger      │
                        │ PII-free logs       │                    │ audit log          │
                        └─────────────────────┘                    └────────────────────┘
```

Trust boundaries:

1. Browser → edge: everything is attacker-controlled.
2. Edge → Convex/SML: only well-formed, size-bounded HTTP.
3. Convex → ML service: server-to-server with `ML_SERVICE_TOKEN`.
4. Operator CLI → SITL: local only, loopback UDP, explicit confirmation.

---

## 2. Control inventory (implemented in this repo)

### 2.1 Edge / WAF (deployment-time)

Files: `deploy/nginx/lifelink.conf`, `deploy/modsecurity/lifelink-custom.conf`,
[`waf-deployment.md`](waf-deployment.md).

- TLS-only, HSTS, HTTP→HTTPS redirect, TLS 1.2/1.3.
- `client_max_body_size 6m`, header buffer and timeout caps.
- Per-IP rate/connection limits: general 60 r/m, auth 10 r/m, OTP 5 r/m,
  uploads 10 r/m, 30 concurrent connections.
- ModSecurity + OWASP CRS 4.x with explicit SQLi/XSS/LFI/method rules for JSON
  bodies, plus narrow clinical-text exclusions so hospital notes are not
  blocked.
- Do not expose `VITE_*` secrets, source maps, `.env`, `.map`, `.log`, `.sql`.
- Response headers: CSP, HSTS, nosniff, DENY framing, Referrer-Policy,
  Permissions-Policy, COOP/CORP.

### 2.2 Authentication firewall

Files: `src/convex/auth/emailOtp.ts`, `src/convex/authGate.ts`,
`src/convex/http.ts`, `src/convex/lib/helpers.ts`.

- OTP sends pass through `/otp-gate`, an HTTP action requiring a server-only
  secret (`OTP_GATE_SECRET`, falling back to `VLY_INTEGRATION_KEY`) so the
  endpoint cannot be used by the public as an email cannon.
- Durable limits: 5 code requests per 15 minutes per address and 120/minute for
  the whole endpoint, stored in `rateLimits` and recorded as security events.
- Best-effort in-isolate limiter remains as a second layer if the gate endpoint
  is unreachable.
- Messages never reveal whether an account exists; failed/limited sends use one
  generic retry message.
- OTP codes and tokens are never logged, persisted in security events, or
  returned in errors.
- Sessions are issued by Convex Auth (HTTP-only cookies); logout calls
  `signOut` and the client drops its cached session. Session lifetime is the
  Convex Auth default and must be tuned at the deployment (see remaining risks).
- Every security event is identifier-free (`entityId: "redacted"` for users).

### 2.3 Role-based API security

Server-side only. Frontend route guards (`RequireAuth`, `RequireRole`) are
convenience, never the enforcement point.

| Role | Key server-side rules |
| --- | --- |
| donor | Own profile, own offers, compatible open requests only (masked). Never sees patient identity. |
| requestor/user | Own requests, own documents; cannot read or mutate another user's request. |
| hospital | Own organization inventory, own requests, receipt of transfers addressed to it. |
| red_cross | Verification, allocation, donor directory (contact only with consent), transfer dispatch/receipt. |
| admin | Security monitoring, model retraining, global views. |
| drone_ops | Mission planning/dispatch/abort/emergency stop for its organization; still checked against airspace and preflight. |

Helpers live in `src/convex/lib/helpers.ts` (`requireUser`, `requireRole`,
`requireStaff`, `requireRedCross`, `requireDroneOps`, `requireAdmin`,
`roleOf`) and `src/convex/lib/vault.ts` (ownership/tenant checks, transfer-side
checks, inventory ownership, drone command/mission authority, size guards).

### 2.4 Convex backend hardening

- **Strict inputs**: `convex/values` validators on every public function, plus
  `requireText` / `requirePhone` / `requireEmail` / `requireUnits` /
  `requireDateString` and JSON/string size guards in `vault.ts` and `contact.ts`.
- **Server-side identity**: every mutation resolves the caller from context;
  never trusts a client-supplied user id.
- **Ownership checks**: `requests.getDetail` returns `null` for non-owners and
  logs a cross-user denial; `documents.getUrl` permits uploader, admin,
  Red Cross, or the linked hospital; `inventory.updateStock` and
  `recordMovement` call `authorizeInventoryOwnershipOrStaff`.
- **Transaction protection**: reservations use serializable Convex mutations
  with re-reads before decrementing `unitsAvailable`/`unitsReserved`; dispatch
  refuses inconsistent batches; receipt is idempotent per transfer.
- **Receipt authorization**: `allocation.receiveTransfer` requires the receiving
  verified organization and complete verification checks.
- **Idempotency**: `requests.create` uses a client request id; receipt checks an
  existing `transferReceipts` row; emergency stop returns `duplicate: true`.
- **Audit logging**: `auditLogs` for business actions and `securityEvents` for
  security-relevant denials.
- **Safe errors**: `safeError()` returns stable messages with no stack traces,
  table names, secrets or sensitive identifiers.
- **Transactional audit**: Convex rolls back every write when a mutation throws,
  so a security event inserted immediately before a `throw` would be lost. Rate
  limiters therefore *return* a denial after writing, and `ml.authorizeMlAction`
  returns `{allowed:false}` so its event commits before the calling action raises
  the user-facing error. Throwing authorization checks still log a stable,
  identifier-free line to the Convex function log; they are not duplicated into
  `securityEvents` (see residual risk 11).

### 2.5 AI/ML firewall

Files: `ml_service/app/main.py`, `ml_service/app/schemas.py`,
`src/convex/lib/mlClient.ts`, `src/convex/ml.ts`.

- Bearer auth (`ML_SERVICE_TOKEN`) on `/health`, `/v1/*`; `/livez` is the only
  unauthenticated endpoint and returns service/version only.
- `ML_REQUIRE_AUTH=true` makes startup fail if the token is missing; the
  Dockerfile sets it.
- Token comparison uses `hmac.compare_digest`; failures log a generic event.
- 512 KB request cap (413), 2 MB response cap, per-client/path rate limit (429,
  configurable via `ML_RATE_LIMIT_PER_MINUTE`).
- Strict Pydantic schemas with bounded list lengths (32 demand series, 50 donors).
- Per-request model timeout (`ML_REQUEST_TIMEOUT_SECONDS`, 20 s default) → 504.
- Wildcard CORS refuses startup; docs/OpenAPI disabled when auth is required.
- Safe error bodies and a global exception handler that logs type only.
- Access logs contain method, path, status and duration — never payloads,
  donor/patient identifiers or tokens.
- Convex restricts who can call each action (`authorizeMlAction`: admin for
  training, staff for predictions, network-wide restricted to admins/Red Cross)
  and records unauthorized attempts as `ml_auth_failure`/`unauthorized_access`.

### 2.6 Drone simulation firewall

Files: `src/convex/drones.ts`, `drone_bridge/sitl_bridge.py`.

- Operator auth: all command mutations call `requireDroneOps`.
- Command validation: mission state machine (`canTransition`), delivery handoff
  code, container temperature vs component storage range.
- Mission authorization: `routeAuthorized`, simulated airspace authorization,
  preflight checks, restricted-zone geometry, drone availability/maintenance.
- Operational restrictions in simulation: payload/energy/range limits, base must
  match the supplying facility.
- Emergency stop: `drones.emergencyStop` moves the mission to
  `EMERGENCY_LANDING`, grounds the drone, notifies operator/admin, audits the
  command, and is idempotent.
- Command audit: `auditLogs` entries for plan/dispatch/load/delivery/abort/stop
  plus `missionEvents` state history.
- Replay protection: state guards make dispatch/load/delivery/stop single-shot;
  the SITL bridge keeps a single-use mission ledger, rejects stale exports by
  `issuedAt`, and enforces a geometric fence, altitude and payload bounds.
- Simulation only: no real aircraft path is enabled; the bridge requires
  `--confirm SITL` and loopback UDP.

### 2.7 Frontend security

- Baseline CSP + referrer policy in `index.html`; production CSP/HSTS headers in
  `deploy/nginx/lifelink.conf`.
- React escapes rendered text; no `dangerouslySetInnerHTML` in app code.
- Contact submissions reject obvious script/`onerror` payloads server-side and
  render whatever is stored as text.
- No API secrets in `VITE_*`; only `VITE_CONVEX_URL` and public contact info are
  browser-visible. Server secrets live on the Convex deployment.
- Platform error reporting strips query strings/fragments before sending a URL
  and never sends auth data.
- No `console.log` of user or clinical data in app code.

### 2.8 Security monitoring dashboard

`src/convex/security.ts` + the Admin Console “Security monitoring” tab.

Shows total/unresolved counts and a timeline with severity, kind, service,
timestamp and a generic reason; per-category cards for auth failures, OTP
limits, access denials, blocked/throttled requests and ML/drone denials.
Resolution actions are admin-only. The dashboard reads security events only —
never patients, donors, contacts, tokens or codes.

---

## 3. Modified / added files

| Area | Files |
| --- | --- |
| Schema/helpers | `src/convex/schema.ts`, `src/convex/lib/helpers.ts`, `src/convex/lib/vault.ts` |
| Auth firewall | `src/convex/auth/emailOtp.ts`, `src/convex/authGate.ts`, `src/convex/http.ts` |
| API hardening | `src/convex/contact.ts`, `src/convex/requests.ts`, `src/convex/inventory.ts`, `src/convex/allocation.ts`, `src/convex/documents.ts`, `src/convex/drones.ts`, `src/convex/ml.ts`, `src/convex/lib/mlClient.ts`, `src/convex/security.ts` |
| ML service | `ml_service/app/main.py` |
| Drone bridge | `drone_bridge/sitl_bridge.py` |
| Frontend | `index.html`, `src/pages/AdminConsole.tsx`, `src/instrumentation.tsx`, `src/pages/Landing.tsx` |
| Edge/WAF | `deploy/nginx/lifelink.conf`, `deploy/modsecurity/lifelink-custom.conf` |
| Tests | `tests/security.test.ts`, `ml_service/tests/test_security.py`, `drone_bridge/tests/test_sitl_bridge.py` |
| Docs | `docs/security.md`, `docs/waf-deployment.md`, `docs/production-security-checklist.md`, `docs/environment.md` |
| Dependencies | `package.json`, `bun.lock` (axios, hono security upgrades) |

---

## 4. Automated tests and results

Command results from this workspace (all passing):

| Suite | Command | Result |
| --- | --- | --- |
| Convex security suite (14 required cases + 1) | `bun test tests/security.test.ts` | 15 pass, 0 fail |
| Full app suite | `bun test` | 68 pass, 0 fail |
| ML service | `python3 -m pytest ml_service/tests -q` | 22 pass |
| SITL bridge | `python3 -m pytest drone_bridge/tests -q` | 12 pass |
| Types | `bunx tsc -b --noEmit` | clean |
| Convex codegen | `bunx convex dev --once` | functions ready |

Mapping of the required 14 cases to tests:

1. SQL/NoSQL injection → `1. injection payloads are stored inert…`
2. XSS payload handling → `2. XSS payloads are rejected or returned as inert text`
3. Brute-force authentication → `3. brute-force / OTP requests are rate limited and logged`
4. OTP rate limiting → cases 3 and 4
5. Unauthorized role access → case 5
6. Cross-user data access → case 6
7. Malformed API requests → case 7
8. Oversized requests → case 8 (+ ML 413 test)
9. ML token validation → case 9 + `test_health_requires_token_when_configured`
10. Unauthorized drone commands → case 10
11. Replayed commands → case 11 (+ bridge replay ledger test)
12. Inventory/transfer authorization → case 12
13. Sensitive information leakage → case 13
14. Security headers → case 14

Extra: durable logging of denied ML invocations → case 15.

### Dependency and secret scanning

| Check | Command | Status |
| --- | --- | --- |
| Dependency audit | `bun audit` | Ran: 61 advisories → 32 after upgrading `axios` to 1.21.x and `hono` to 4.13.x. Remaining critical is transitive in `@convex-dev/auth`; see risks. |
| Secret scan | `grep -rniE "(api_key|secret|token)\\s*[:=]\\s*['\\"][A-Za-z0-9_-]{12,}" src ml_service drone_bridge` | Run and clean in this change; no hardcoded credentials found. |
| Lockfile review | `bun.lock` | Unchanged by this work. |

Do not record a scan as passed unless it actually ran against the lockfile.

---

## 5. Vulnerabilities found and fixed

| # | Finding | Severity | Fix |
| --- | --- | --- | --- |
| 1 | Security events recorded inside a mutation that then threw were **rolled back**, so blocked attempts never appeared in the dashboard. | High | Firewall helpers return a denial after inserting the event; callers stop work and return a safe denial. |
| 2 | OTP rate limiting existed as a helper but was **never called**. | High | `/otp-gate` HTTP action + provider guard with durable per-address limits. |
| 3 | `ml.ts` authorization used a query context that could not write security events (and the ML service was syntactically broken with duplicated routes). | High | Authorization moved to `internalMutation`; ML service rewritten with one route per endpoint. |
| 4 | No CSP, no edge security headers, no rate limits documented as active. | Medium | Baseline CSP meta + nginx header/limit blueprint; tests assert configuration. |
| 5 | Drone commands bypassed the audit log for plan/dispatch/load/delivery/abort. | Medium | Added `audit()` for each command + `emergencyStop` with grounding and idempotency. |
| 6 | SITL bridge accepted replayed exports and had no geofence/payload/altitude bounds. | Medium | Single-use mission ledger, freshness check, fence and bound validation, token gate, audit log. |
| 7 | Cross-user request denials from a query were logged via a mutation-only helper (type-unsafe and could not persist). | Low | Query paths emit identifier-free warnings; mutation paths persist durable events. |
| 8 | Third-party error reporting included `window.location.href` (query/fragment). | Low | Report origin + pathname only. |
| 9 | Contact form treated a rate-limited submission as success. | Low | Returns `saved:false` with a message; UI shows the error. |
| 10 | Dependency advisories: prototype-pollution/ReDoS/SSRF in `axios` 1.18 and ReDoS in `hono` 4.12 were reachable from server code. | High | Upgraded to `axios` 1.21.1 and `hono` 4.13.18 (in-range); audit dropped from 61 to 32 advisories. |

---

## 6. Remaining risks

1. **WAF is not deployed here.** The repo ships configuration, not an active
   edge. Until `deploy/` is applied and verified, HTTP attacks are only filtered
   by application-level validation.
2. **In-process ML rate limiting** is per worker. With multiple uvicorn workers
   or replicas, use a shared limiter (Redis) or edge limits per instance.
3. **OTP gate secret**: if neither `OTP_GATE_SECRET` nor `VLY_INTEGRATION_KEY`
   is set, the provider falls back to a per-isolate limiter. Set a dedicated
   secret in production.
4. **Session lifetime and cookie flags** are Convex Auth defaults; confirm the
   exact expiry/inactivity policy with the deployment owner.
5. **No SIEM/alerting**: events are queryable in the admin dashboard but are not
   shipped to an external monitoring system or paged on.
6. **Convex storage URLs** are signed but time-limited; document expiry and avoid
   sharing them outside authorized staff.
7. **Clinical free-text false positives**: WAF exclusions must be re-tuned
   against real traffic in DetectionOnly mode before enabling blocking.
8. **`bun audit` still reports 32 advisories**, including one critical in
   `@auth/core@0.37.4` (Email normalizer homoglyph `@` bypass, GHSA-7rqj-j65f-68wh)
   pulled in transitively by `@convex-dev/auth@0.0.90`. Remediation is an
   upgrade of `@convex-dev/auth` to 2.x (major; requires auth-flow regression
   testing) or a reviewed dependency override to `@auth/core@0.41.3`. Do not
   force the override without running the full auth test suite.
9. **No dependency/secret scan in CI yet**; the commands above must be wired into
   the pipeline.
10. **Bridge is simulation-only and unverified against real SITL** in this
    environment; the upload path is untested here.
11. **Throwing denial paths are not persisted as security events.** Convex
    rolls back writes on throw, so cross-user hospital/inventory/drone denials
    are logged to the function log but do not appear in the dashboard. Converting
    those handlers to return a denial object (like the ML path) is the correct
    next step; it requires matching UI error handling at each call site.
12. **In-isolate OTP fallback** can be bypassed across isolates if the HTTP gate
    is unavailable; the durable gate is the primary control.

---

## 7. Operating notes

- Start ModSecurity in `DetectionOnly`, review 72 hours of audit logs, then
  switch to `On` (see `waf-deployment.md`).
- Rotate `ML_SERVICE_TOKEN` and `OTP_GATE_SECRET` on a schedule and after any
  suspected exposure.
- Treat `securityEvents` as append-only; resolve, never delete.
- Review Convex function logs for `[security]` lines to see throwing denials
  that could not be persisted transactionally.
- Keep `VITE_*` limited to public configuration.

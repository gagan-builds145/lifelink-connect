# Production security checklist

Tick only what is actually verified in the target environment. Items marked
**[repo]** are implemented here; **[deploy]** require infrastructure action.

## Edge and transport

- [ ] **[deploy]** TLS 1.2/1.3 only, valid certificates, auto-renewal tested.
- [ ] **[deploy]** DNS proxied/pointed at the WAF; origin not publicly reachable.
- [ ] **[deploy]** WAF in blocking mode after a DetectionOnly review period.
- [ ] **[deploy]** Rate limits verified for auth, OTP, uploads and general traffic.
- [ ] **[deploy]** Body size cap (6 MB edge / 5 MB documents) enforced.
- [ ] **[repo]** Security headers configured (`deploy/nginx/lifelink.conf`).
- [ ] **[repo]** Baseline CSP in `index.html`; production CSP header reviewed with
      the real CDN/font/map origins.
- [ ] **[deploy]** No source maps, `.env`, `.map`, `.log` or `.sql` reachable.

## Secrets and configuration

- [ ] **[deploy]** `ML_SERVICE_TOKEN` set, strong, stored in a secret manager.
- [ ] **[deploy]** `OTP_GATE_SECRET` set (do not rely on the fallback).
- [ ] **[deploy]** `ML_REQUIRE_AUTH=true` in the ML container.
- [ ] **[deploy]** No server secret in any `VITE_*` variable (only
      `VITE_CONVEX_URL` and public contact details are browser-visible).
- [ ] **[deploy]** Convex deployment variables reviewed; test keys removed.
- [ ] **[deploy]** Rotation schedule + owner recorded; rotate after any exposure.
- [ ] **[repo]** `grep` secret scan clean; add a scanner to CI.

## Authentication

- [ ] **[repo]** OTP requests pass the `/otp-gate` limiter (5/15 min per address).
- [ ] **[repo]** Failures/limits logged without tokens or codes.
- [ ] **[deploy]** Confirm Convex Auth session duration and inactivity policy.
- [ ] **[deploy]** Secure logout verified (session invalidated server-side).
- [ ] **[deploy]** Account-enumeration review: identical messages for unknown and
      known addresses.
- [ ] **[deploy]** Email sender domain SPF/DKIM/DMARC configured.

## Authorization and data

- [ ] **[repo]** Every public mutation/query resolves identity server-side.
- [ ] **[repo]** Cross-user request/donor access denied and logged.
- [ ] **[repo]** Hospital inventory writes restricted to the owning organization.
- [ ] **[repo]** Only the receiving organization (or admin) can confirm receipt.
- [ ] **[repo]** Admin-only security dashboard and model retraining.
- [ ] **[deploy]** Seed-data review: no real patient/donor data in demo records.
- [ ] **[deploy]** Convex dashboard access limited and audited.
- [ ] **[deploy]** Retention/deletion policy approved (DPIA or equivalent).

## ML service

- [ ] **[repo]** Token required on `/health` and `/v1/*`; `/livez` minimal.
- [ ] **[repo]** 512 KB request cap, rate limiting, strict schemas, timeouts.
- [ ] **[repo]** No PII in model logs; no patient/donor identifiers in payloads.
- [ ] **[deploy]** Service reachable only from Convex (private network/gateway).
- [ ] **[deploy]** Non-root container user, CPU/memory limits, read-only FS where
      possible.
- [ ] **[deploy]** Model artifacts integrity-checked before rollout.

## Drone simulation

- [ ] **[repo]** All commands require `drone_ops`; mission authority checked.
- [ ] **[repo]** Emergency stop grounds the drone and is idempotent.
- [ ] **[repo]** Command audit entries written for plan/dispatch/load/deliver/
      abort/stop.
- [ ] **[repo]** SITL bridge rejects stale/replayed missions, enforces fence and
      payload bounds, and requires `--confirm SITL`.
- [ ] **[deploy]** Bridge is not exposed over the network; runs on the operator
      workstation only. No real aircraft is connected.

## Monitoring and response

- [ ] **[repo]** Admin security timeline shows auth failures, rate limits,
      denials, ML and drone events with severity/time/service.
- [ ] **[deploy]** Ship `securityEvents`/`auditLogs` to retention storage.
- [ ] **[deploy]** Alerting on repeated auth failures, WAF blocks, ML 401s and
      emergency stops.
- [ ] **[deploy]** Incident runbook: credential compromise, data exposure,
      wrong-unit release, drone safety event.
- [ ] **[deploy]** Backup/restore rehearsed (see `backup-recovery.md`).

## Verification gates

- [ ] `bun test` green (includes `tests/security.test.ts`).
- [ ] `python3 -m pytest ml_service/tests -q` green.
- [ ] `python3 -m pytest drone_bridge/tests -q` green.
- [ ] `bunx convex dev --once && bunx tsc -b --noEmit` clean.
- [ ] `bun audit` (or CI equivalent) reviewed.
- [ ] WAF verification block from `waf-deployment.md` executed and recorded.

Do not mark the deployment production-ready until every applicable box is
checked in the actual environment.

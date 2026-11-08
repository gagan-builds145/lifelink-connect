# Deployment Guide

> This guide describes the intended production deployment. **No production deployment, DGCA approval or clinical certification has been completed.**

## 1. Target topology

```text
Static Vite build (HTTPS)
  └── Convex client → production Convex deployment
                         ├── auth + database + file storage
                         ├── scheduled crons
                         ├── Resend / Twilio secrets
                         └── live facility adapter secrets
Facility systems ── HTTPS ──▶ inventory adapter action ──▶ Convex ledger
```

Recommended hosting for the static frontend: any HTTPS static host that supports SPA fallback (Netlify, Vercel, Cloudflare Pages, Azure Static Web Apps). The backend is Convex; no separate Node server is required.

## 2. Pre-deployment checklist

- [ ] Clinical compatibility matrix reviewed and signed off by a transfusion specialist.
- [ ] Institutional SOPs define who may auto-allocate, release, receive and override.
- [ ] Verified-only onboarding and an admin approval workflow for organizations (current build: manual admin promotion).
- [ ] Demo data disabled or isolated from production data.
- [ ] Resend domain verified, sender set; Twilio number provisioned (if used).
- [ ] Live adapter endpoints, schemas and credentials validated against a sandbox HMS/blood bank.
- [ ] Privacy policy, terms, consent language and retention schedule approved by legal/compliance.
- [ ] Backups and restore drills tested.
- [ ] Rate limiting, WAF and monitoring added at the platform edge (not included).
- [ ] Security review completed; no secrets in source or client bundles.
- [ ] Drone operations: DGCA/ATC/airspace/operator/aircraft/remote-pilot approvals. This build does not control aircraft.

## 3. Production Convex deployment

```powershell
# Authenticate once
bunx convex login

# Create or select a production deployment
bunx convex deploy
```

`convex deploy` pushes the schema, all functions and indexes. There are no SQL migrations.

Set production environment variables in the Convex dashboard (or `bunx convex env set --prod ...`):

```powershell
bunx convex env set --prod RESEND_API_KEY "re_..."
bunx convex env set --prod RESEND_FROM_EMAIL "LifeLink <alerts@yourdomain.org>"
bunx convex env set --prod TWILIO_ACCOUNT_SID "AC..."
bunx convex env set --prod TWILIO_AUTH_TOKEN "..."
bunx convex env set --prod TWILIO_FROM_NUMBER "+1..."
```

Set any live adapter keys using the exact names registered in `facilityIntegrations.credentialEnvVar`. Never commit values.

Convex Auth production values (`JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL`, auth issuer) must match the production site URL. Follow the existing Convex Auth setup; do not reuse development keys.

## 4. Build and host the frontend

Create `.env.production` (or your host's environment settings) with:

```ini
VITE_CONVEX_URL=https://<production-deployment>.convex.cloud
```

Then:

```powershell
bun install
bun run build
```

Upload `dist/` to the static host. Configure SPA fallback:

- Netlify: `/* /index.html 200`
- Vercel: framework Vite, rewrites to `/index.html`
- Cloudflare Pages: single-page app fallback
- Azure Static Web Apps: `navigationFallback` to `/index.html`

The app uses `BrowserRouter`; without fallback, deep links such as `/supply` return 404.

## 5. Post-deploy verification

1. OTP sign-in and sign-out.
2. Protected route bounce: signed-out `/supply` → `/auth?returnTo=/supply` → after sign-in returns to `/supply`.
3. Role boundaries: donor cannot open `/admin/dashboard` or `/drones` mutations.
4. Verified facility shows correct city/coordinates; test search with a real (non-demo) batch.
5. Reserve/dispatch/receive a test transfer; verify the receipt batch and ledger rows.
6. Trigger a mock sync; confirm demo labels. Configure a live sandbox adapter; confirm a failed sync writes no stock.
7. Notification with and without provider keys: `sent` vs `skipped_no_provider`.
8. Plan a mission; confirm preflight blocks low battery, no authorization and container temperature outside range.
9. Admin console shows real aggregates, no demo mixed into real metrics without the demo label.
10. Backup/restore drill and alerting test.

## 6. Monitoring and operations

Convex provides function logs and the dashboard's health views. Add:

- uptime checks on the static site and a lightweight public query;
- alerting on `facilitySyncRuns.status = failed`, `notificationJobs.status = failed`, `anomalyEvents.severity = critical`, mission `HOLD`/`EMERGENCY_LANDING`;
- log retention and access review;
- a documented incident runbook for oversupply, wrong-unit, privacy or mission-safety events;
- database backup schedule with restore tests.

## 7. Rollback

1. Re-deploy the previous known-good frontend build.
2. Convex schema changes are forward-applied. Keep additive, backward-compatible schema changes; avoid destructive field removals until older clients are gone.
3. If a bad integration writes incorrect inventory, stop its schedule, mark the adapter disabled, and reconcile affected batches through audited adjustment transactions. Do not delete ledger history.

## 8. What is deliberately not deployed

- A real PX4/ArduPilot/MAVLink bridge or aircraft command path.
- A real HMS/blood-bank production connector (the framework and mock adapter exist).
- PostgreSQL/PostGIS, Redis, Firebase, Docker Compose.
- Push notifications.
- Automated browser, load or SITL tests.

See [limitations.md](limitations.md) for the full production-readiness gap list.

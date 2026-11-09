# Deployment Guide

> This guide describes the intended production deployment. **No production deployment, DGCA approval or clinical certification has been completed.**

## 1. Target topology

```text
Static Vite build (HTTPS)
  └── Convex client → production Convex deployment
                         ├── auth + database + file storage
                         ├── scheduled crons
                         ├── Resend / Twilio secrets
                         ├── live facility adapter secrets
                         └── ML_SERVICE_URL + ML_SERVICE_TOKEN
                                    │ authenticated HTTPS
                                    ▼
                         Python FastAPI ML container (CPU)
                           ├── XGBoost demand model JSON
                           ├── Random Forest donor artifact
                           └── Isolation Forest anomaly artifact
Facility systems ── HTTPS ──▶ inventory adapter action ──▶ Convex ledger
```

Recommended hosting for the static frontend: any HTTPS static host that supports SPA fallback (Netlify, Vercel, Cloudflare Pages, Azure Static Web Apps). The backend is Convex; no separate Node server is required.

## 2. Pre-deployment checklist

- [ ] Clinical compatibility matrix reviewed and signed off by a transfusion specialist.
- [ ] Institutional SOPs define who may auto-allocate, release, receive and override.
- [ ] Verified-only onboarding and an admin approval workflow for organizations (current build: manual admin promotion).
- [ ] Demo data disabled or isolated from production data.
- [ ] Resend domain verified, sender set; Twilio number provisioned (if used).
- [ ] ML container deployed with `ML_REQUIRE_AUTH=true` and `ML_SERVICE_TOKEN`, and `ML_SERVICE_URL` set on Convex over HTTPS.
- [ ] Model artifacts retrained from deployment data or explicitly approved synthetic artifacts for a pilot.
- [ ] Donor Random Forest retrained only from consented outcomes; invitation fallback behaviour approved by clinical operations.
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
bunx convex env set --prod ML_SERVICE_URL "https://your-ml-service.example.org"
bunx convex env set --prod ML_SERVICE_TOKEN "a-long-random-secret"
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

### ML service container

```powershell
cd ml_service
docker build -t lifelink-ml .
docker run --rm -p 8000:8000 `
  -e ML_SERVICE_TOKEN="a-long-random-secret" `
  lifelink-ml
```

The image sets `ML_REQUIRE_AUTH=true`, so the token is mandatory and startup fails without it. Put the container behind HTTPS (managed container host, reverse proxy, or private service mesh) and make it reachable from Convex. Do not expose it without a token. The bundled artifacts must be replaced or retrained for a real pilot; their metrics are synthetic-data evidence only. Convex cannot reach `localhost` on your laptop.

Container probes should call public `/livez`. Convex calls authenticated `/health` and `/v1/*`. The Docker health check uses `/livez`; never place the bearer token in a probe URL. The full Python suite passed on 3.13.15 and 3.10.12, but the Docker image was not built in this workspace because Docker is unavailable.

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
10. ML health: `/admin/dashboard` → **Check service** returns all three models ready, **Refresh XGBoost forecast** stores a run, and donor invitations show a model version after automatic escalation.
11. Force an ML outage (wrong URL/token) and confirm automatic allocation still reserves stock, donor invitations use distance-only fallback, and no probability is stored.
12. Backup/restore drill and alerting test from [backup-recovery.md](backup-recovery.md).
13. Security checklist from [security.md](security.md), including secret scanning and RBAC checks.

## 6. Monitoring and operations

Convex provides function logs and the dashboard's health views. Production must also add:

- uptime checks on the static site, a lightweight public query and ML `/livez`;
- alerting on ML `/health` degradation, `facilitySyncRuns.status = failed`, `notificationJobs.status = failed`, `anomalyEvents.severity = critical`, mission `HOLD`/`EMERGENCY_LANDING`;
- alerting when the donor fallback model is `distance_only_fallback` for an unusual share of invitations;
- log retention and access review;
- a documented incident runbook for oversupply, wrong-unit, privacy or mission-safety events;
- database backup schedule with restore tests.

See [security.md](security.md), [backup-recovery.md](backup-recovery.md), [ml-operations.md](ml-operations.md), [hospital-integration.md](hospital-integration.md) and [../drone_bridge/README.md](../drone_bridge/README.md).

## 7. Rollback

1. Re-deploy the previous known-good frontend build.
2. Convex schema changes are forward-applied. Keep additive, backward-compatible schema changes; avoid destructive field removals until older clients are gone.
3. If a bad integration writes incorrect inventory, stop its schedule, mark the adapter disabled, and reconcile affected batches through audited adjustment transactions. Do not delete ledger history.

## 8. What is deliberately not deployed

- A production aircraft command path. The repository contains a SITL-only export/bridge scaffold; it was not executed against PX4/ArduPilot here.
- A real HMS/blood-bank production connector (the framework and mock adapter exist).
- PostgreSQL/PostGIS, Redis, Firebase, Docker Compose.
- Push notifications.
- Automated browser, load or SITL tests.

See [limitations.md](limitations.md) and [production-readiness.md](production-readiness.md) for the full production-readiness classification and gap list.

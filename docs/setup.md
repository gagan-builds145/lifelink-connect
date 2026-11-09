# Setup and Installation

## 1. Prerequisites

- Windows 11 (PowerShell 7 or Windows Terminal), macOS or Linux
- Git
- Node.js 20+ LTS
- Bun 1.3+ (`bun --version`)
- A Convex account/deployment
- Optional: Python 3.13 (verified) or 3.10+ for the ML service
- Optional: Resend account (email), Twilio account (SMS)

The project already targets a Convex development deployment. Keep the same deployment if you want existing accounts and demo data.

## 2. Windows 11 quick start

```powershell
git clone <your-repository-url> lifelink
cd lifelink

bun install

# Create local Vite values from the template
Copy-Item env.example .env.local
notepad .env.local
```

Set at least:

```ini
VITE_CONVEX_URL=https://<your-deployment>.convex.cloud
CONVEX_DEPLOYMENT=dev:<your-deployment>
CONVEX_SITE_URL=https://<your-deployment>.convex.site
```

Use the exact `.convex.cloud` and `.convex.site` URLs printed by Convex. Do not use the dashboard URL.

Start the backend and frontend in two terminals:

```powershell
# Terminal 1 — Convex dev + codegen + function push
bunx convex dev

# Terminal 2 — Vite
bun run dev
```

Open <http://localhost:5173>.

> In the Freebuff managed workspace, the dev server and Convex process are already running. Do not start or kill them; edits are picked up automatically.

## 3. Python ML service

The service is a separate FastAPI process. From `ml_service/`:

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
python scripts/train_all.py
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

The training script creates `artifacts/` and synthetic `data/` CSVs. This
workspace executed the complete suite on **Python 3.13.15 and 3.10.12**. The
trained artifacts are included, and retraining is reproducible. The Dockerfile
targets Python 3.13 and requires `ML_SERVICE_TOKEN`.

Expose the service to Convex over HTTPS (Convex Cloud cannot call
`127.0.0.1`). In development, a tunnel is acceptable; in production, deploy the
container in `ml_service/Dockerfile`.

## 4. Backend deployment variables

Convex deployment variables are separate from `.env.local`. Set them with:

```powershell
bunx convex env set RESEND_API_KEY "re_..."
bunx convex env set RESEND_FROM_EMAIL "LifeLink <alerts@yourdomain.org>"
bunx convex env set TWILIO_ACCOUNT_SID "AC..."
bunx convex env set TWILIO_AUTH_TOKEN "..."
bunx convex env set TWILIO_FROM_NUMBER "+1..."

# Python ML service. Use a reachable HTTPS URL, not localhost for Convex Cloud.
bunx convex env set ML_SERVICE_URL "https://your-ml-service.example.org"
bunx convex env set ML_SERVICE_TOKEN "a-long-random-secret"

# The deployed ML process must have the same token and should reject
# unauthenticated startup:
# ML_REQUIRE_AUTH=true
# ML_SERVICE_TOKEN=<same value>
```

Optional live facility adapters (the demo adapters use these names):

```powershell
bunx convex env set RC_PUNE_INVENTORY_API_KEY "..."
bunx convex env set SAHYADRI_HMS_TOKEN "..."
```

Do not set `RESEND_*` or `TWILIO_*` unless you want real outbound messages. Without them, in-app notifications still work and email/SMS jobs are marked `skipped_no_provider`.

Convex Auth needs its generated `JWT_PRIVATE_KEY`, `JWKS` and `SITE_URL` values; they are already managed by the project's Convex Auth setup. Do not overwrite them.

## 5. First accounts

1. Open `/signup` and register a **hospital**, **blood bank / Red Cross** or **donor** account using email OTP (or the demo guest path where available).
2. The server assigns the role; never set `role` in the browser.
3. For an administrator, open the Convex dashboard → **Data** → `users`, find the verified account and set `role` to `admin`. There is no public admin-signup endpoint by design. Refresh `/admin/dashboard`.
4. Sign in as admin, open **Institutions & policy**, and grant drone operations access to an existing staff account by email.
5. Confirm each facility has verified status, coordinates, `transferAuthorized` and an appropriate protected reserve.

## 6. Demo supply-chain data

From `/blood-search`, use the demo-data control; or run:

```powershell
bunx convex run demo:seed
```

The seed adds labelled demo facilities, requests, agreements, mock integrations, a drone base, two drones, an airspace zone, 60 days of demand history and one **completed simulated** mission. It is idempotent (`demo-network-v1`).

Demo inventory is `isDemo: true`; it is labelled in the UI and never presented as live hospital stock.

## 7. Tests and checks

```powershell
# Typecheck (frontend + backend types)
bun tsc -b --noEmit

# Push Convex functions / regenerate types
bunx convex dev --once

# Unit tests (supply engine)
bun test

# TypeScript JUnit evidence
bun test --reporter=junit --reporter-outfile=docs/test-results.xml

# Python ML + SITL-validation tests (activate the ML venv first)
$env:PYTHONPATH="ml_service;drone_bridge"
python -m pytest ml_service/tests drone_bridge/tests -q --junitxml=docs/python-test-results.xml
```

The suites cover deterministic domain rules, model artifact loading/prediction,
donor batch scoring and explainability, consent refusal, anomaly detection,
auth-token enforcement, model retraining and SITL export validation. Python
3.13.15 and 3.10.12 both pass 22 tests. There is **no**
Playwright/browser/API/concurrency/live-SITL/load suite. See
[test-report.md](test-report.md) and [limitations.md](limitations.md).

## 8. Manual acceptance walkthrough

Use three browser profiles:

1. **Hospital A** (verified, coordinates set): submit an O+ red-cell request; open `/supply`.
2. **Admin**: ensure a supplier has `transferAuthorized`, `autoAllocate` and an active agreement with Hospital A; ensure a drone base is hosted at the supplier.
3. **Admin**: run the demo network, then open `/supply` → select the request → **Auto-allocate**. Confirm reservations and a transfer appear.
4. **Supplier** (staff): open `/supply` → **Transfers & custody** → **Release & dispatch**.
5. **Drone ops** (or admin): open `/drones` → choose the reserved transfer and an available drone based at the supplier → **Validate & plan mission**. Inspect every preflight line.
6. **Drone ops**: **Dispatch** → wait for `PAYLOAD_LOADING` (cron advances every 30 s) → set container temperature (2–6 °C for red cells) → **Confirm loading**.
7. Wait for `AT_DESTINATION`, then **Hospital A** opens `/supply` → **Confirm receipt** (or drone ops enters the displayed handoff code). The receipt batch is written to Hospital A.
8. Wait for `RETURNING_TO_BASE` → `COMPLETED`; check the mission event log.
9. **Donor**: open `/donor/dashboard` → **Invitations**, grant temporary location consent for 24 h, respond to an invitation. Confirm no stock changes until a donation is recorded and released.
10. **Admin**: `/admin/dashboard` → verify system health, sync runs, model registry, anomalies and audit trail.
11. **ML**: start the FastAPI service, expose it over HTTPS, set `ML_SERVICE_URL`/`ML_SERVICE_TOKEN`, open `/admin/dashboard` → **ML** → **Check service**, then **Retrain from Convex history** and **Refresh XGBoost forecast** on `/supply`. Confirm model version and synthetic-data labelling. For donor retraining, use **Retrain donor model** in the same ML tab; it requires at least 40 consented answered invitations with both outcomes.
12. **Anomaly**: on `/supply` → **Demand intelligence**, run **Isolation Forest scan** and confirm any persisted alert is labelled with its model version.
13. **SITL export**: on `/drones`, select a mission and export **SITL JSON**; run the bridge's `--dry-run`. Do not run `--confirm SITL` without a local PX4/ArduPilot instance and safety review.

## 9. If the preview is blank

```powershell
bun tsc -b --noEmit
bunx convex dev --once
```

Fix any real type/function error before reloading. Do not hand-edit `src/convex/_generated/*`.

## 10. Required credentials and approvals for real deployment

| Requirement | Needed for |
| --- | --- |
| Convex production deployment + auth env values | All production use |
| Reachable ML service URL + shared bearer token | XGBoost forecasts, donor ranking and Isolation Forest alerts |
| Resend API key + verified sender domain | Email notifications |
| Twilio SID/token/from number | SMS notifications |
| Hospital/blood-bank API contracts + credentials | Live inventory synchronization |
| Clinical sign-off on component compatibility and SOPs | Real allocation |
| Named data-protection/legal review | Donor consent and retention |
| DGCA / airspace / operator / aircraft / remote-pilot approvals | Any real drone operation |
| PX4/ArduPilot SITL runtime, MAVSDK, operator/airspace approvals | Executing the included SITL bridge; this build did not run it |
| Monitoring, backups and incident response | Production operations |

This software is not certified medical or aviation software. Do not use it for real blood issue or aircraft control without clinical, legal and aviation authority approval.

# LifeLink — Blood Supply Chain & Simulated Drone Delivery

> **Find the need. Reserve the right blood. Move it with an auditable chain of custody.**

LifeLink is a working React + Convex application that connects donors, requestors, hospitals, blood banks and Red Cross facilities on one verified workflow. This build adds an institution-to-institution supply chain: geospatial blood search, deterministic allocation, transfer custody, consent-gated donor fallback, a trained Python XGBoost demand service, Isolation Forest anomaly detection, notification outbox and **simulated** drone missions.

It is not a static prototype. It is also **not** certified medical software or an aircraft control system. Read [Known limitations](docs/limitations.md) before any real use.

## LifeLink Connect 2.0 additions

- User-facing role names are now **Donor**, **Hospital**, **Blood Bank** and **Guardian**. Legacy internal role/org keys are preserved so existing records keep working.
- New **Guardian ambulance provider** role, registration, fleet/driver management, document review and dispatch dashboard.
- Shared **ambulance booking** for Donor, Hospital and Blood Bank at `/ambulance`, with nearby discovery, GPS pickup, fare/ETA estimates, lifecycle status, live location sharing and history.
- Convex tables and indexes for Guardian profiles, ambulances, bookings and append-only booking events; all authorization is server-side.
- TensorFlow/Keras ANN, LSTM and Autoencoder training pipelines are present under `ml_service/scripts/`. They require `ml_service/requirements-deep.txt` and were **not trained** in this environment (TensorFlow unavailable, disk space insufficient). No deep-learning metrics are claimed.

See [docs/lifelink-2.md](docs/lifelink-2.md) for role mapping, ambulance security rules, schema additions and the exact ML limitation.

### AI storage and model registry

Convex now stores versioned AI dataset/model/training-run metadata and storage snapshots. Bulk datasets, `.keras`/Joblib artifacts, checkpoints, logs and backups are designed for S3-compatible object storage with explicit 500 GB initial / 5 TB scale targets. PHI datasets are refused, checksums prevent duplicate payloads, and only administrators can approve or roll back model versions.

See [docs/ai-storage.md](docs/ai-storage.md) for bucket layout, retention, IAM/encryption guidance, capacity math, commands and **measured local-only** scalability results. No million-user capacity claim is made.

### Phase 2 verification

FastAPI now exposes `/ai/demand/predict`, `/ai/donor-response/predict`, `/ai/inventory/anomaly-detect`, `/ai/models`, model status/metrics and `/ai/health`. The admin AI panel shows storage, model health, approval/disable controls and recent training runs. Existing XGBoost, Random Forest and Isolation Forest models were retrained and evaluated; deep models remain untrained because TensorFlow cannot be installed on this host. Browser testing could not run because Chromium is absent and disk space is insufficient.

Read [docs/phase2-report.md](docs/phase2-report.md) for actual metrics, repairs, test counts and unresolved limitations, and [docs/deep-training-cloud.md](docs/deep-training-cloud.md) for external TensorFlow training.

---

## 1. What is implemented

| Area | Status |
| --- | --- |
| Public landing, verified blood search, camps, privacy, terms | ✅ |
| Passwordless email OTP auth, Donor/Hospital/Blood Bank/Guardian signup | ✅ |
| **Unified community dashboard** — donor + requestor in one sidebar | ✅ |
| Donor capability: availability, invitations, offers, camps, history, consent | ✅ |
| Requestor capability: create/edit/cancel, timeline, allocation, receipts | ✅ |
| Combined activity timeline + one notification centre | ✅ |
| Red Cross verification, inventory ledger, alerts, camps, analytics, audit | ✅ |
| **Autonomous supply command** (`/supply`) | ✅ search, preview, atomic allocation, transfers, forecast, integrations |
| **Geospatial search** | ✅ city / district / state / country policy with haversine distance |
| **Deterministic compatibility and eligibility** | ✅ ABO/Rh per component, expiry, release, screening, protected reserve |
| **Atomic multi-facility allocation** | ✅ Convex serializable mutations, exact reservation rows |
| **Transfer custody** | ✅ reserve → dispatch → receive / cancel, ledger + audit |
| **Facility integration framework** | ✅ mock adapter + credentialed live REST pull + sync audit |
| **Donor fallback** | ✅ temporary consent, invitations, accept/decline, appointment routing |
| **Demand forecasting** | ✅ Python FastAPI + trained XGBoost, chronological holdout, MAE/RMSE + baseline |
| **Donor response model** | ✅ Python Random Forest ranks already-eligible, consented invitations; explicit distance-only fallback if ML is unavailable |
| **Anomaly detection** | ✅ trailing z-score plus Python Isolation Forest scan and persisted alerts |
| **Notification outbox** | ✅ in-app, optional Resend email + Twilio SMS, idempotency keys, three delivery attempts and provider message ids |
| **Drone operations** (`/drones`) | ✅ bases, fleet, airspace, route proxy, 12 preflight checks |
| **Simulated mission lifecycle** | ✅ 15 states, telemetry, failure drills, handoff code, return-to-base |
| **Admin control room** (`/admin/dashboard`) | ✅ network health, policy, agreements, sync, ML, safety, audit |
| **Automated tests** | ✅ 133 TypeScript tests across 9 suites, including AI registry, map, Guardian and ambulance coverage; ✅ 45 Python tests in this environment |
| Real HMS/blood-bank production connector | ❌ framework + mock only |
| PX4/ArduPilot SITL / MAVLink | ⚠️ SITL export + MAVSDK bridge present; **not executed** because no SITL runtime is installed |
| Live API/E2E/load/security/live-SITL suites | ❌ not included |
| Push notifications | ❌ not implemented |

Test evidence: [docs/test-report.md](docs/test-report.md), [docs/test-results.xml](docs/test-results.xml), [Python 3.13 JUnit](docs/python-3.13-test-results.xml) and [Python 3.10 JUnit](docs/python-test-results.xml).

## 2. Safety rules enforced in code

1. **Clinical compatibility is deterministic.** ML never decides compatibility.
2. Expired, unverified, unscreened or unreleased units never allocate.
3. Protected reserves are subtracted before allocation.
4. Reservations are atomic; the same unit cannot be reserved twice.
5. Donors are contacted only after institutional supply is exhausted. A donor is never an available unit.
6. Donor location requires active, temporary, revocable consent.
7. Drone dispatch is role-gated and only possible after every critical preflight check passes.
8. A delivery is never marked successful without the receiver's handoff code (admin override is audited).
9. Every mission is `simulated: true`. No aircraft is connected.
10. Mock inventory is labelled `Demo`; failed syncs write no inventory.

## 3. Stack

React 19 · Vite 7 · TypeScript · React Router 7 · Tailwind CSS v4 · shadcn/ui · Leaflet · Recharts · Framer Motion · Convex + Convex Auth · Python FastAPI · XGBoost · scikit-learn.

The web backend and deterministic domain engine remain TypeScript/Convex, preserving the existing working app and auth. The ML service is a separate Python FastAPI process with saved model artifacts. See [Architecture](docs/architecture.md) and [ML service](ml_service/README.md).

## 4. Windows 11 installation

### Prerequisites

- Git for Windows
- Node.js 20+ LTS and Bun
- A Convex account/deployment
- Optional: Resend (email), Twilio (SMS), Python 3.13 (verified) or 3.10+ for ML

```powershell
git clone <your-repository-url> lifelink
cd lifelink
bun install

# The host blocks .env* edits, so the template is env.example
Copy-Item env.example .env.local
notepad .env.local
```

Minimum `.env.local`:

```ini
VITE_CONVEX_URL=https://<your-deployment>.convex.cloud
CONVEX_DEPLOYMENT=dev:<your-deployment>
CONVEX_SITE_URL=https://<your-deployment>.convex.site
```

Start in two terminals:

```powershell
bunx convex dev    # backend, schema, codegen
bun run dev        # Vite frontend → http://localhost:5173
```

In the Freebuff managed workspace both processes are already running; do not start or kill them.

### Python ML service

```powershell
cd ml_service
py -3.13 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python scripts/train_all.py
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Then set a reachable service URL and shared token on the Convex deployment:

```powershell
bunx convex env set ML_SERVICE_URL "https://your-reachable-ml-service"
bunx convex env set ML_SERVICE_TOKEN "a-long-random-secret"
```

Convex Cloud cannot reach `127.0.0.1`; use an HTTPS tunnel in development or deploy the service. Python 3.13.15 and 3.10.12 were both verified here; the Docker image targets 3.13.

## 5. Checks and tests

```powershell
bun tsc -b --noEmit
bunx convex dev --once
bun run lint
bun test
bun test --reporter=junit --reporter-outfile=docs/test-results.xml
bun run build -- --minify false

$env:PYTHONPATH="ml_service;drone_bridge"
python -m pytest ml_service/tests drone_bridge/tests -q
```

Executed results: **41 TypeScript tests / 228 assertions** and **22 Python tests on both Python 3.13.15 and 3.10.12**. The integration suite runs the real Convex modules against an in-memory transactional backend. ESLint has 0 errors and 14 Fast Refresh warnings in vendored UI/platform files. The production Vite build passed with `--minify false`; the minified bundle exceeded the runner limit during chunk rendering. Bundled ML metrics are synthetic-data evidence only. Coverage, browser E2E, live-provider, live-hospital, load, penetration and live SITL tests were not run; RBAC role guards are covered by the integration suite.

## 6. Demo data

From `/blood-search` or the CLI:

```powershell
bunx convex run demo:seed
```

The idempotent seed adds labelled demo institutions, inventory, requests, agreements, mock integrations, a drone base, two simulated drones, an airspace zone, 60 days of demand history and one completed simulated mission. Demo data is always labelled and never mixed into real stock claims.

For the first administrator, set `users.role = "admin"` in the Convex dashboard. Then grant drone operations access from `/admin/dashboard` → **Institutions & policy**.

## 7. Primary routes

| Route | Access | Purpose |
| --- | --- | --- |
| `/` | public | Landing page and network search |
| `/auth`, `/signup` | public | OTP auth and role onboarding |
| `/community/dashboard` | community/donor/requestor | Overview, Donate Blood, Request Blood, My Activities, Notifications, My Profile, Settings |
| `/donor/dashboard` | donor | legacy redirect → `/community/dashboard?section=donate` |
| `/requestor/dashboard` | requestor | legacy redirect → `/community/dashboard?section=request` |
| `/hospital/dashboard` | hospital | requests, storage, dispatch/receipt |
| `/red-cross/dashboard` | red_cross/admin | verification, inventory, camps, audit |
| `/supply` | hospital/red_cross/admin | allocation, transfers, forecasts, integrations |
| `/drones` | drone_ops/admin/hospital/red_cross | fleet, mission planning/control, read-only for facility staff |
| `/admin/dashboard` | admin | network control room |

## 8. Documentation

- [Architecture](docs/architecture.md)
- [Database design](docs/database.md)
- [API contracts](docs/api.md)
- [Setup](docs/setup.md)
- [Deployment](docs/deployment.md)
- [Test report](docs/test-report.md)
- [Known limitations & production checklist](docs/limitations.md)
- [Sample datasets](docs/sample-datasets.md)
- [Python ML service](ml_service/README.md)
- [SITL bridge](drone_bridge/README.md)
- [Production readiness](docs/production-readiness.md)
- [Security checklist](docs/security.md)
- [Backup and recovery](docs/backup-recovery.md)
- [ML operations](docs/ml-operations.md)
- [Hospital API integration](docs/hospital-integration.md)
- [Environment template](env.example)

## 9. Credentials and approvals needed for real use

| Requirement | Purpose |
| --- | --- |
| Convex production deployment + auth values | Hosting and sessions |
| Reachable Python ML service URL + shared token | XGBoost forecasts, donor ranking, Isolation Forest scans |
| Resend API key + verified sender domain | Email |
| Twilio SID/token/number | SMS |
| Hospital/blood-bank API contracts + keys | Real inventory sync |
| Clinical sign-off on compatibility and SOPs | Real blood issue |
| Data-protection/legal review | Donor consent and retention |
| DGCA/ATC/operator/aircraft/remote-pilot approvals | **Any real drone operation** |
| PX4/ArduPilot SITL runtime + MAVSDK | Executing the included, currently unverified bridge |

Email and SMS are optional: without keys jobs are marked `skipped_no_provider`; in-app notifications still work. Failed provider calls are retried up to three times; no bounce/webhook processing is implemented.

## 10. Medical and aviation disclaimer

LifeLink is decision-support software. ABO/Rh rules do not replace cross-matching, screening, clinical judgement or licensed blood-centre release. The drone module is a software simulation; no real aircraft is commanded. Do not use this system for live blood issue or flight operations without the required clinical, legal and aviation approvals.

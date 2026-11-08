# LifeLink — Blood Supply Chain & Simulated Drone Delivery

> **Find the need. Reserve the right blood. Move it with an auditable chain of custody.**

LifeLink is a working React + Convex application that connects donors, requestors, hospitals, blood banks and Red Cross facilities on one verified workflow. This build adds an institution-to-institution supply chain: geospatial blood search, deterministic allocation, transfer custody, consent-gated donor fallback, genuine demand forecasting, anomaly detection, notification outbox and **simulated** drone missions.

It is not a static prototype. It is also **not** certified medical software or an aircraft control system. Read [Known limitations](docs/limitations.md) before any real use.

---

## 1. What is implemented

| Area | Status |
| --- | --- |
| Public landing, verified blood search, camps, privacy, terms | ✅ |
| Passwordless email OTP auth, donor/requestor/hospital/Red Cross signup | ✅ |
| Donor dashboard, availability, offers, history, camps, profile | ✅ |
| Requestor + hospital request workflow, documents, timeline, receipt | ✅ |
| Red Cross verification, inventory ledger, alerts, camps, analytics, audit | ✅ |
| **Autonomous supply command** (`/supply`) | ✅ search, preview, atomic allocation, transfers, forecast, integrations |
| **Geospatial search** | ✅ city / district / state / country policy with haversine distance |
| **Deterministic compatibility and eligibility** | ✅ ABO/Rh per component, expiry, release, screening, protected reserve |
| **Atomic multi-facility allocation** | ✅ Convex serializable mutations, exact reservation rows |
| **Transfer custody** | ✅ reserve → dispatch → receive / cancel, ledger + audit |
| **Facility integration framework** | ✅ mock adapter + credentialed live REST pull + sync audit |
| **Donor fallback** | ✅ temporary consent, invitations, accept/decline, appointment routing |
| **Demand forecasting** | ✅ ridge regression, chronological holdout, MAE/RMSE + baseline |
| **Donor response model** | ✅ optional logistic model, refuses insufficient data |
| **Anomaly detection** | ✅ trailing z-score + persisted sync/mission anomalies |
| **Notification outbox** | ✅ in-app, optional Resend email + Twilio SMS, idempotency keys |
| **Drone operations** (`/drones`) | ✅ bases, fleet, airspace, route proxy, 12 preflight checks |
| **Simulated mission lifecycle** | ✅ 15 states, telemetry, failure drills, handoff code, return-to-base |
| **Admin control room** (`/admin/dashboard`) | ✅ network health, policy, agreements, sync, ML, safety, audit |
| **Unit tests** | ✅ 26 tests / 145 assertions, executed |
| Real HMS/blood-bank production connector | ❌ framework + mock only |
| PX4/ArduPilot SITL / MAVLink | ❌ not implemented; simulation is explicitly labelled |
| Automated API/E2E/load/security/SITL suites | ❌ not included |
| Push notifications | ❌ not implemented |

The full test evidence is in [docs/test-report.md](docs/test-report.md); raw JUnit is [docs/test-results.xml](docs/test-results.xml).

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

React 19 · Vite 7 · TypeScript · React Router 7 · Tailwind CSS v4 · shadcn/ui · Leaflet · Recharts · Framer Motion · Convex + Convex Auth.

The backend and pure domain engine are TypeScript/Convex rather than Python/FastAPI/PostGIS, preserving the existing working app and auth. See [Architecture](docs/architecture.md) for the rationale and component diagram.

## 4. Windows 11 installation

### Prerequisites

- Git for Windows
- Node.js 20+ LTS and Bun
- A Convex account/deployment
- Optional: Resend (email) and Twilio (SMS)

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

## 5. Checks and tests

```powershell
bun tsc -b --noEmit
bunx convex dev --once
bun test
bun test --reporter=junit --reporter-outfile=docs/test-results.xml
```

Current result: **26 pass, 0 fail, 0 skipped, 145 assertions**. No fabricated coverage percentage is reported; coverage, load, API, security, browser E2E and SITL tests were not run.

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
| `/donor/dashboard` | donor | availability, offers, camps, invitations + consent |
| `/requestor/dashboard` | requestor | request lifecycle |
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
- [Environment template](env.example)

## 9. Credentials and approvals needed for real use

| Requirement | Purpose |
| --- | --- |
| Convex production deployment + auth values | Hosting and sessions |
| Resend API key + verified sender domain | Email |
| Twilio SID/token/number | SMS |
| Hospital/blood-bank API contracts + keys | Real inventory sync |
| Clinical sign-off on compatibility and SOPs | Real blood issue |
| Data-protection/legal review | Donor consent and retention |
| DGCA/ATC/operator/aircraft/remote-pilot approvals | **Any real drone operation** |
| PX4/ArduPilot SITL + MAVLink bridge | Beyond the built-in simulation |

Email and SMS are optional: without keys jobs are marked `skipped_no_provider`; in-app notifications still work.

## 10. Medical and aviation disclaimer

LifeLink is decision-support software. ABO/Rh rules do not replace cross-matching, screening, clinical judgement or licensed blood-centre release. The drone module is a software simulation; no real aircraft is commanded. Do not use this system for live blood issue or flight operations without the required clinical, legal and aviation approvals.

# LifeLink Supply Chain — Architecture

## 1. Scope

This build extends the existing LifeLink blood-donation application into an institution-to-institution supply chain:

- A verified hospital raises a request.
- LifeLink computes the shortage against the hospital's own released stock.
- The search engine filters every candidate batch for clinical compatibility, screening/release status, expiry and protected reserve before scoring distance.
- The allocation engine atomically reserves eligible units across up to five pre-authorised facilities.
- A transfer record tracks custody until the receiving hospital confirms receipt.
- If institutional stock cannot cover the need, consented donors may be invited. Donors are never counted as units.
- Reserved transfers can be planned as **simulated** drone missions with preflight checks, telemetry, verified handoff and return-to-base.

## 2. Stack as built

| Layer | Technology |
| --- | --- |
| Frontend | React 19, Vite 7, TypeScript, React Router 7, Tailwind CSS v4, shadcn/ui, Recharts, Framer Motion |
| Map | Leaflet 1.9 + OpenStreetMap raster tiles |
| Backend | Convex queries/mutations/actions/internal mutations |
| Database | Convex document database with indexes and serializable mutations |
| Auth | Convex Auth (email OTP + demo guest) |
| ML | TypeScript ridge regression, logistic regression and z-score detector in `src/lib/supply.ts` |
| Email / SMS | Optional Resend and Twilio adapters in Convex actions |
| Scheduled work | Convex crons for telemetry, notification outbox, sync, forecasts and anomaly sweeps |

### Deliberate deviations from the requested reference stack

| Requested | Implemented | Reason |
| --- | --- | --- |
| Python / FastAPI / SQLAlchemy | Convex TypeScript backend | The existing LifeLink application already runs on Convex with working auth and data. Replacing it would discard working code, which the brief explicitly forbids. |
| PostgreSQL + PostGIS | Convex tables + shared haversine/geofence functions | No PostGIS in this runtime. Geospatial filtering is deterministic and test-covered, but not spatially indexed at PostgreSQL scale. |
| Redis / queues | Convex outbox table + cron worker | Durable queue semantics without adding another service. |
| PX4/ArduPilot SITL + MAVSDK | Software-in-the-loop mission simulator | No flight-controller process or MAVLink link exists in this environment. The mission state machine, preflight, telemetry and failure drills are real software; the flight is explicitly simulated. |
| XGBoost / Random Forest | Ridge time-series regression | Implemented without a Python runtime. Evaluation is genuine (chronological holdout, MAE/RMSE, baseline). It is not XGBoost. |
| MapLibre | Leaflet | Existing dependency added for the project; simpler integration. |

## 3. Component map

```text
Browser (React SPA)
  ├─ /supply          SupplyCommand.tsx     allocation, transfers, forecast, integrations
  ├─ /drones          DroneOps.tsx          fleet, bases, airspace, mission control
  ├─ /admin/dashboard AdminConsole.tsx      network health, policy, sync, ML, audit
  ├─ /donor/dashboard DonorDashboard.tsx    invitations + temporary location consent
  └─ Leaflet NetworkMap.tsx                 facilities, routes, restricted zones
          │  reactive Convex subscriptions / mutations
          ▼
Convex deployment
  ├─ allocation.ts        geospatial search, atomic reservation, transfers
  ├─ drones.ts            fleet, route planning, preflight, mission state machine, telemetry
  ├─ donorFallback.ts     consent, invitations, accept/decline, escalation gate
  ├─ integrations.ts      adapter registry, mock sync, live credentialed sync
  ├─ forecasting.ts       demand forecast, anomaly report, donor model training
  ├─ admin.ts             aggregate read models, anomaly acknowledgement
  ├─ notificationsQueue.ts email/SMS outbox worker
  ├─ crons.ts             telemetry, outbox, sync, forecast and anomaly schedules
  └─ lib/helpers.ts       auth, role, organization, rate-limit and audit guards
          │
          ▼
Convex database (shared ledger)
```

The pure domain engine `src/lib/supply.ts` is imported by both the Convex backend and the UI (and by the tests), so allocation, routing and model rules have one implementation.

## 4. Primary flow

```mermaid
sequenceDiagram
  participant H as Requesting hospital
  participant S as Supply engine
  participant B as Blood bank
  participant D as Drone ops
  participant R as Receiving hospital
  H->>S: Request verified (or hospital-origin pending)
  S->>S: Compute shortage from own released stock
  S->>B: Search batches; filter compatibility, release, expiry, reserve
  S->>B: Reserve eligible units atomically (up to 5 facilities)
  B->>S: Dispatch exact reserved batches
  S->>R: Transfer in custody
  D->>S: Plan simulated mission for reserved transfer
  S->>S: Route proxy + 12 preflight checks
  D->>S: Dispatch (only if PREFLIGHT_PASSED)
  S->>S: Simulated telemetry every 30 s
  D->>S: Confirm loading (temperature validated)
  R->>S: Confirm handoff code
  S->>R: Receipt batch added to ledger
  S->>S: Return-to-base → COMPLETED
```

If reservations do not cover the request, `autoAllocate` calls the donor fallback. The fallback re-checks active reservations and refuses to contact donors while institutional supply covers the need.

## 5. Safety and authorization invariants

1. **Clinical compatibility is deterministic.** `compatibility()` in `src/lib/blood.ts` decides ABO/Rh per component. No model participates.
2. **Eligibility precedes ranking.** Expired, unverified, unscreened, unreleased, incompatible and fully protected batches are blocked before distance is scored.
3. **Reservations are atomic.** Convex mutations are serializable; each batch's free units are re-read and re-checked before every reservation write.
4. **No duplicate reservation.** `inventoryReservations` rows hold exact units; dispatch consumes those rows; cancellation and abort release them.
5. **Protected reserve is never allocated.** Usable units = `unitsAvailable − unitsReserved − protectedReserve`.
6. **Donors are never stock.** Invitations require active consent, availability, interval guidance and compatible group. Blood counts only after licensed collection, screening, testing and release.
7. **No donor location without consent.** `donorConsents` must be active and unexpired; consent is temporary and revocable.
8. **Drone dispatch is role-gated.** `requireDroneOps` validates admin/drone-ops on every fleet/mission mutation. Facility staff have read-only access.
9. **No delivery without evidence.** `DELIVERED` requires the receiver's one-time handoff code (admin override is audited and labelled).
10. **Simulation is labelled.** Every mission carries `simulated: true`; UI, notifications and admin aggregates state that no aircraft is connected.
11. **No invented inventory.** Failed syncs write no stock. Mock imports are `isDemo: true` and visibly labelled.
12. **Forecasts refuse short data.** A group with no recorded demand returns `insufficient_data`, not a fabricated number.

## 6. Data freshness and real-time behaviour

- Convex queries are live subscriptions; a reservation, transfer or telemetry write re-renders connected dashboards without polling.
- `crons.ts` runs:
  - telemetry simulation and automatic mission state advancement,
  - notification outbox delivery/retry,
  - periodic facility syncs,
  - scheduled demand forecasts,
  - anomaly sweeps.
- The UI displays timestamps, sync status, model run times and demo labels.

## 7. Failure handling

| Failure | Response |
| --- | --- |
| External facility API unavailable | Sync run marked failed; no inventory written; anomaly raised; error visible to admin. |
| Missing provider credentials | Notification job `skipped_no_provider`, no false "sent" state. |
| Insufficient institutional stock | Allocation returns shortfall; donor invitation gate opens only after re-checking active reservations. |
| Concurrent requests for same units | Serializable mutation re-checks free units; second reservation fails or reserves different stock. |
| Preflight failure | Mission enters `HOLD`; dispatch mutation refuses non-`PREFLIGHT_PASSED` states. |
| Link loss / GPS / battery / temperature | Failure recorded; mission goes to `HOLD` or `EMERGENCY_LANDING`; operators notified. |
| Wrong handoff code | Delivery rejected and remains `AT_DESTINATION`. |

## 8. Production topology (target, not implemented here)

A production deployment would add:

- a real HMS/blood-bank connector service with signed webhooks and durable retries;
- PostgreSQL/PostGIS or a spatial index if inventory reaches millions of batches, with measured p95 search latency;
- a real PX4/ArduPilot SITL integration and then certified operations under DGCA/ATC approvals;
- an edge rate limiter, WAF, secrets manager and centralized monitoring;
- clinical sign-off on the compatibility matrix and SOPs;
- backup/restore drills and healthcare compliance review.

See [limitations.md](limitations.md) and [deployment.md](deployment.md).

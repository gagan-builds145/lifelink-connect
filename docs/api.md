# API Contracts

LifeLink exposes a Convex function API, not REST. Functions are called through the Convex client with the authenticated session attached; the browser never supplies its own role or organization. Every protected function re-resolves the caller on the server.

## 1. Access model

| Guard | Allows |
| --- | --- |
| `requireUser` | Any signed-in account |
| `requireStaff` | `hospital`, `red_cross`, `admin` |
| `requireAdmin` | `admin` only |
| `requireDroneOps` | `drone_ops`, `admin` |
| `getDonorProfile` | A signed-in account with a donor profile |
| `requireOrganization` | A staff account linked to a verified organization |

Public-safe queries return masked data. They never expose patient identity, donor contact data, precise donor location or private documents.

## 2. Supply search and allocation — `src/convex/allocation.ts`

### `searchSupply` (query, staff)

Args (one of `requestId` or explicit need):

```ts
{
  requestId?: Id<"bloodRequests">,
  bloodGroup?: "A+" | ... | "O-",
  component?: "whole_blood" | "red_cells" | "platelets" | "plasma",
  units?: number,
  city?: string,
  urgency?: "routine" | "urgent" | "emergency",
  scope?: "city" | "district" | "state" | "country",
  maxDistanceKm?: number
}
```

Returns:

- `need` — resolved need plus `remainingUnits`, `activeReserved`.
- `candidates[]` — up to 30 ranked batches with `eligible`, `usableUnits`, `distanceKm`, `tier`, `score`, `autoAuthorized`, `blockers[]`, `warnings[]`, `isDemo`, facility coordinates.
- `preview` — allocation plan for pre-authorised supply.
- `coverage` — `available`, `shortage`, `authorizedUnits`, `eligibleSources`, `expiredOrBlocked`.
- `scopePolicy` — why the requested scope is or is not allowed.
- `disclaimer`.

Rules: routine/urgent = requesting city only; emergency may widen to district, state and country. Candidate filtering happens before ranking.

### `autoAllocate` (action, requesting hospital staff or admin)

```ts
{ requestId: Id<"bloodRequests">, scope?: SupplyScope, maxDistanceKm?: number, note?: string }
```

Reserves eligible pre-authorised units atomically, creates `transfers`, writes reservation and transaction rows and queues notifications. After that transaction commits it calls the Python donor batch endpoint for the remaining shortfall. Returns `allocated`, `shortfall`, `transfers`, `invitations`, `donorFallbackError`, `applied`, `message`. If ML is unavailable, the donor fallback uses distance ordering and records no model probability. The deterministic reservation is not repeated by the action.

Rejects:

- patient-originated requests that are not approved;
- closed requests;
- callers that are not the requesting hospital (unless admin);
- non-pre-authorised supply.

### `transfersForMe` (query, signed-in)

Returns transfers where the caller is supplier/receiver; admin and drone ops see all. Includes mission summary.

### `dispatchTransfer` (mutation, supplying staff/admin)

```ts
{ transferId: Id<"transfers">, note?: string }
```

Consumes the exact active reservations, decrements `unitsAvailable` and `unitsReserved`, writes one `dispatch` ledger row per batch, sets status `dispatched`.

### `receiveTransfer` (mutation, receiving staff/admin)

```ts
{ transferId: Id<"transfers">, note?: string, evidenceCode?: string }
```

Creates a released receipt batch with the earliest expiry, writes a `receipt` transaction, marks the transfer/request received.

### `cancelTransfer` (mutation, either facility or admin)

Only `reserved`/`approved` transfers can be cancelled. Releases active reservations and writes `release` ledger rows.

### Agreements and policy

| Function | Type | Access | Purpose |
| --- | --- | --- | --- |
| `createAgreement` | mutation | admin | Create/update pre-authorisation between two verified facilities (`maxUnitsPerRequest`, `autoAllocate`). |
| `agreementsForMe` | query | signed-in | Agreements touching the caller's facility; admin sees all. |
| `setTransferPolicy` | mutation | admin | Set `transferAuthorized`, `autoAllocate`, protected reserve and search radius. |
| `networkFacilities` | query | hospital, red_cross, admin, drone_ops | Verified facility directory with policy flags and coordinates. |
| `grantDroneOps` | mutation | admin | Convert an existing staff account to `drone_ops`; donors/requestors are refused. |

## 3. Donor fallback — `src/convex/donorFallback.ts`

| Function | Type | Access | Contract |
| --- | --- | --- | --- |
| `setLocationConsent` | mutation | donor | `{ shareLocation, hours }`; 1–168 hours; revocable. |
| `myConsent` | query | donor | Active/expired status, expiry timestamp, note. |
| `myInvitations` | query | donor | Invitations with status, distance, response estimate, model provenance/explanation, appointment, centre and — only after acceptance — facility contact. |
| `respond` | mutation | donor | `{ invitationId, action: "accept" \| "decline", note? }`; only the owning donor can answer a `sent` invitation. |
| `invitationsForOrg` | query | staff | Accepted invitations for the caller's organization. |
| `escalateRequest` | action | requesting hospital staff/admin | Refuses when active reservations already cover the request; deterministic eligibility is followed by an authenticated donor batch prediction. |

No function converts a donor into inventory. Blood becomes issuable only through licensed collection and release.

## 4. Facility integrations — `src/convex/integrations.ts`

| Function | Type | Access | Contract |
| --- | --- | --- | --- |
| `registerIntegration` | mutation | admin | Register adapter (`kind`, `syncMode`, `baseUrl`, `credentialEnvVar`, `isMock`). |
| `listIntegrations` | query | signed-in | Adapter status, last run, error and history summary. |
| `runMockSync` | mutation | admin | Applies labelled demo records only; writes a sync run. |
| `runLiveSync` | action | admin | Resolves the configured env var, calls `{baseUrl}/inventory`, validates records, then applies them through a mutation. Never invents stock. |
| `syncStatusSummary` | query | admin | Aggregate sync health. |
| `runPeriodicSyncs` | internal mutation | cron | Syncs due adapters. |

Live response contract:

```json
{
  "records": [
    {
      "externalUnitRef": "UNIT-001",
      "bloodGroup": "O+",
      "component": "red_cells",
      "units": 4,
      "collectedAt": "2026-10-01",
      "expiresAt": "2026-11-20",
      "storageLocation": "Cold room A",
      "screened": true,
      "released": true,
      "storageTempC": 4
    }
  ]
}
```

Credentials are read via `process.env[credentialEnvVar]` in a `"use node"` action. They are never stored in a table or returned to the browser.

Failure semantics: failed auth/network/schema → run `failed`, `lastError` set, anomaly recorded, zero batches written.

## 5. Drone operations — `src/convex/drones.ts`

### Registration and fleet (drone ops/admin)

| Function | Args | Notes |
| --- | --- | --- |
| `registerBase` | `{ organizationId, name, latitude, longitude }` | Facility must be verified. |
| `registerDrone` | `{ baseId, model, manufacturer, maxPayloadKg, batteryCapacityWh, maxRangeKm, cruiseSpeedKmh, batteryPct, flightController: "px4" \| "ardupilot", maintenanceStatus }` | Generates a `DRN-####` id. Simulation only. |
| `updateDrone` | `{ droneId, batteryPct?, linkStatus?, gpsAvailable?, maintenanceStatus?, containerReady?, containerTempC?, status? }` | Fleet status/failure drills. |
| `addAirspaceZone` | `{ name, kind, centerLat, centerLng, radiusKm, source, note? }` | Source is `simulated` or `published`; training dataset. |
| `listBases`, `listAirspaceZones`, `fleet` | none | Read models. |

### Mission lifecycle

| Function | Type | Access | Contract |
| --- | --- | --- | --- |
| `planMission` | mutation | drone ops/admin | `{ transferId, droneId, routeAuthorized, landingZoneAvailable, containerTempC?, weather?, authorizationRef? }`. Transfer must be `reserved`/`approved`; drone must belong to the supplying facility; route must be free of restricted zones. Creates mission + preflight; returns `missionCode`, `passed`, `preflight[]`, `routeKm`, `estimatedDurationMin`, `deliveryCode`. |
| `dispatchMission` | mutation | drone ops/admin | Only from `PREFLIGHT_PASSED`. No real flight is commanded. |
| `confirmLoading` | mutation | drone ops/admin | Only in `PAYLOAD_LOADING`; container temperature must be inside the component storage range. Consumes reservations and dispatches the transfer. |
| `confirmDelivery` | mutation | receiver, drone ops, admin | Only in `AT_DESTINATION`; code must match. Receiver gets a receipt batch; writes evidence. |
| `reportFailure` | mutation | drone ops/admin | `{ missionId, kind, detail }`; `battery`, `gps`, `landing_zone` → `EMERGENCY_LANDING`; others → `HOLD`. |
| `abortMission` | mutation | drone ops/admin | Releases pre-load reservations; marks transfer failed if payload already aboard. |
| `missionDetail` | query | mission parties, drone ops, admin | Route, preflight, telemetry, state history, failure, delivery evidence and handoff code (receiver/ops only). Drone ops/admin can export the mission as `lifelink.sitl.mission.v1` JSON for the optional SITL bridge. |
| `missions`, `overview` | query | signed-in/parties | Mission list and aggregate counts. |
| `simulateTelemetry` | internal mutation | cron | Advances states and telemetry every 30 s. No browser motor commands. |

Mission states:

`PLANNED → PREFLIGHT_CHECKING → PREFLIGHT_PASSED → DISPATCHED_TO_PICKUP → AT_PICKUP → PAYLOAD_LOADING → PAYLOAD_LOADED → IN_TRANSIT_TO_DESTINATION → AT_DESTINATION → DELIVERED → RETURNING_TO_BASE → COMPLETED`, plus `HOLD`, `ABORTED`, `EMERGENCY_LANDING`.

## 6. AI / ML — `src/convex/ml.ts` and `src/convex/forecasting.ts`

The Python service endpoints are documented in [ml_service/README.md](../ml_service/README.md). Convex calls it with `ML_SERVICE_URL` and `ML_SERVICE_TOKEN`; credentials stay in the deployment environment. Prediction and health requests have per-attempt timeouts and two attempts for idempotent calls; training is single-attempt. `/livez` is public for probes; `/health` and `/v1/*` require the bearer token when configured.

| Function | Type | Access | Contract |
| --- | --- | --- | --- |
| `latestDemandForecast` | query | staff | `{ organizationId?, component? }`; latest stored XGBoost run for the scope. Returns an empty forecast list with a clear message until a service refresh succeeds. |
| `refreshDemandForecasts` | action | staff | Gathers scoped issue/dispatch history, calls `POST /v1/predict/demand/batch`, and stores 24h/7d/30d rows with model version, synthetic-data flag and metrics. Throws on an unreachable/unprepared service rather than inventing a forecast. |
| `trainDemandModel` | action | admin | Gathers up to 365 days of Convex transactions, calls `POST /v1/train/demand`, and registers the returned version/metrics. |
| `runAnomalyScan` | action | staff | Calls `POST /v1/detect/anomalies` for red-cell series and persists Isolation Forest alerts with model version and synthetic flag. |
| `trainDonorModel` | action | admin | Collects consented, answered invitation outcomes, calls `POST /v1/train/donor`, and registers the Python Random Forest version/metrics. Requires ≥40 samples and both outcomes. |
| `mlServiceStatus` | action | staff | Reads the authenticated service `/health` with two attempts; returns `reachable: false` with an error instead of pretending it is up. |
| `anomalyReport` | query | staff | Trailing 28-day z-score findings plus persisted sync/mission and Isolation Forest alerts. |
| `modelStatus` | query | staff | Active donor/demand model versions, training sizes, XGBoost description, stored XGBoost runs and service configuration flag. |
| `anomalySweep` | internal mutation | cron | Persists statistical demand anomalies once. |

Models are decision support only. Compatibility and authorization never call them. The bundled artifacts were trained on labelled synthetic data; retraining from this deployment's transactions is an explicit admin action.

## 7. Admin — `src/convex/admin.ts`

| Function | Type | Access | Contract |
| --- | --- | --- | --- |
| `overview` | query | admin | Organization/inventory/request/transfer/drone/donor/notification/integration/ML/anomaly/audit aggregates and system health. |
| `acknowledgeAnomaly` | mutation | admin | `{ anomalyId }`, audited. |
| `recentSyncRuns` | query | admin | Last 25 sync runs. |
| `notificationQueue` | query | admin | Last 40 outbox jobs with attempts, next retry, provider message id and errors. |

## 8. Notifications

- In-app notifications are inserted by `queueNotification` / `queueForOrganization` / `queueForRoles` / `queueForDonors`.
- `notificationJobs` provides an idempotent outbox keyed by `dedupeKey`.
- `dispatchPending` (internal action, cron) delivers email through Resend and SMS through Twilio when env vars exist.
- Failed attempts are requeued up to three times with a backoff timestamp; provider message ids are stored.
- Missing credentials → `skipped_no_provider`.
- `sent` means the provider accepted the request; bounce/webhook processing is not implemented.
- Push notifications are **not implemented**.
- Existing `/notifications` in-app inbox remains available.

## 9. Errors

Convex returns thrown errors as rejected promises. Typical messages:

| Message | Meaning |
| --- | --- |
| `Sign in to continue.` | No valid session. |
| `Your role cannot …` | RBAC denial. |
| `Patient-originated requests must be verified …` | Donor/patient request not approved. |
| `Only the requesting hospital can run automatic allocation.` | Wrong facility. |
| `The handoff code does not match …` | Delivery evidence invalid. |
| `Container temperature … outside …` | Loading blocked. |
| `At least 20 answered invitations … required.` | Model refused to train. |

The UI surfaces these messages; it must not convert them into a success state.

## 10. Client example

```ts
import { api } from "@/convex/_generated/api";
import { useAction, useQuery } from "convex/react";

const search = useQuery(api.allocation.searchSupply, {
  requestId,
  scope: "city",
});
const allocate = useAction(api.allocation.autoAllocate);
await allocate({ requestId, scope: "city" });
```

No `userId`, `role` or `organizationId` is accepted from the client for authorization decisions.

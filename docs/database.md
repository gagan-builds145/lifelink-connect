# Database Design

Convex owns the schema in `src/convex/schema.ts`. Convex applies schema and indexes automatically in development; there are no SQL migration files. Never edit `src/convex/_generated/*` by hand — run `bun convex dev --once` to regenerate.

## 1. Entity groups

### Identity and institutions

| Table | Purpose | Key fields |
| --- | --- | --- |
| `users` | Auth identity and server-assigned role | `name`, `email`, `role`, `organizationId`, `isDemo` |
| `authAccounts`, `authSessions`, Convex Auth tables | Sessions and OTP | managed by Convex Auth |
| `organizations` | Hospitals, blood banks and Red Cross facilities | `orgId`, `type`, `city`, `latitude`, `longitude`, `status`, `transferAuthorized`, `autoAllocate`, `protectedReserveDefault`, `searchRadiusKm` |
| `donorProfiles` | Donor identity, group, availability | `donorId`, `bloodGroup`, `city`, `available`, `lastDonationDate`, `shareContact` |
| `requestorProfiles` | Patient/representative records | `requestorId`, `city`, masked identity |
| `documentMetadata` | Private uploaded evidence | storage id, request link, uploader |

`organizations.status` must be `verified` before a facility participates in transfers. `transferAuthorized` and `autoAllocate` are policy flags, not client claims.

### Requests and inventory ledger

| Table | Purpose | Key fields |
| --- | --- | --- |
| `bloodRequests` | Shared request lifecycle | `requestId`, `status`, `urgency`, `bloodGroup`, `component`, `units`, `hospitalOrgId`, `isDemo` |
| `requestStatusHistory` | Append-only timeline | `requestId`, `status`, `actorUserId`, `actorRole`, `createdAt` |
| `inventory` | Physical batch stock | `batchRef`, `organizationId`, `bloodGroup`, `component`, `unitsAvailable`, `unitsReserved`, `expiryDate`, `storageTempC`, `verified`, `screened`, `released`, `protectedReserve`, `isDemo` |
| `inventoryTransactions` | Stock movement ledger | `inventoryId`, `type` (`reserve`, `release`, `dispatch`, `receipt`, `issue`, `adjustment`), `units`, `requestId`, `actorUserId`, `isDemo` |
| `inventoryReservations` | Units held for one request/batch | `requestId`, `inventoryId`, `transferId`, `units`, `status` |
| `stockAlerts` | Threshold/expiry alerts | organization, group, component, level |
| `transfers` | Custody between institutions | `transferId`, `requestId`, `requestingOrgId`, `supplyingOrgId`, `reservationIds`, `status`, `auto`, `droneMissionId`, `receivedAt` |

`transfers.status`: `reserved → approved → dispatched → in_transit → received`, with `cancelled` / `failed` branches. Reservation cancellation releases held units; receipt writes a new released batch.

### Facility integration

| Table | Purpose | Key fields |
| --- | --- | --- |
| `facilityIntegrations` | Adapter registry | `organizationId`, `label`, `kind`, `syncMode`, `baseUrl`, `credentialEnvVar`, `status`, `isMock`, `lastSyncAt`, `lastError` |
| `facilitySyncRuns` | Per-run audit | `integrationId`, `status`, `source`, `recordsRead`, `recordsApplied`, `startedAt`, `finishedAt`, `error`, `isMock` |

Adapter kinds include HMS API, blood-bank API, REST, webhook, database connector and mock. Credentials are stored as **environment variable names**, never values.

### Allocations and agreements

| Table | Purpose | Key fields |
| --- | --- | --- |
| `transferAgreements` | Pre-authorised institutional supply | `requestingOrgId`, `supplyingOrgId`, `status`, `autoAllocate`, `maxUnitsPerRequest` |

Reservations live in `inventoryReservations`; there is no separate reservation table for transfer allocations. This keeps one atomic stock model.

### Donor fallback

| Table | Purpose | Key fields |
| --- | --- | --- |
| `donorConsents` | Temporary location sharing | `donorUserId`, `donorProfileId`, `shareLocation`, `grantedAt`, `expiresAt`, `revokedAt` |
| `donorInvitations` | Invitation and response | `requestId`, `donorUserId`, `requestingOrgId`, `donationCenterOrgId`, `bloodGroup`, `component`, `units`, `status`, `distanceKm`, `responseProbability`, `responseModel`, `responseModelVersion`, `responseModelSynthetic`, `responseExplanation`, `predictedAt`, `appointmentAt`, `respondedAt` |
| `donations` | Licensed collection records | donor, organization, component, units, date |

An invitation is not stock. Only released `inventory` rows can be allocated.

### Drone operations

| Table | Purpose | Key fields |
| --- | --- | --- |
| `droneBases` | Authorized facility bases | `organizationId`, `name`, `city`, `latitude`, `longitude`, `status` |
| `drones` | Registered fleet | `droneId`, `baseId`, `model`, `manufacturer`, `maxPayloadKg`, `batteryCapacityWh`, `maxRangeKm`, `cruiseSpeedKmh`, `batteryPct`, `status`, `flightController`, `linkStatus`, `gpsAvailable`, `maintenanceStatus`, `containerReady`, `containerTempC`, `currentLat`, `currentLng`, `lastSeenAt` |
| `airspaceZones` | Restricted zones / corridors (training dataset) | `kind`, `centerLat`, `centerLng`, `radiusKm`, `source`, `active` |
| `droneMissions` | Mission plan and current state | `missionId`, `transferId`, `droneId`, `state`, `simulated`, `route`, `preflight`, `preflightPassed`, `weather`, `airspace`, `telemetry`, `deliveryCode`, `deliveryEvidence`, `failure`, `stateHistory` |
| `missionEvents` | Append-only state transitions | `missionId`, `fromState`, `toState`, `at`, `actorUserId`, `note`, `isSimulated` |

`droneMissions.state` is one of 15 documented states. Historical missions are retained; telemetry is the latest snapshot, not the full high-frequency log.

### Notifications, ML and audit

| Table | Purpose | Key fields |
| --- | --- | --- |
| `notifications` | In-app inbox | user/role/organization target, read state, dedupe key |
| `notificationJobs` | Outbox | `channel` (`in_app`/`email`/`sms`), `status`, `attempts`, `dedupeKey`, `lastError`, `nextAttemptAt`, `providerMessageId`, `sentAt` |
| `demandForecasts` | Stored XGBoost runs | `bloodGroup`, `component`, `scope`, `model`, `modelVersion`, `syntheticData`, `datasetLabel`, `dataDays`, `status`, `metrics`, `confidence`, `horizons`, `runAt` |
| `mlModels` | Versioned model registry | `kind` (`demand_forecast`/`donor_response`), `version`, `trainedAt`, `sampleSize`, `payload` (JSON summary/weights), `metricsJson`, `active` |
| `anomalyEvents` | Persisted statistical and Isolation Forest alerts | `kind`, `severity`, `observed`, `expected`, `zScore`, `note`, `bloodGroup`, `component`, `modelVersion`, `syntheticData`, `acknowledged` |
| `auditLogs` | Administrative and safety actions | `actorUserId`, `actorRole`, `action`, `entityType`, `entityId`, `detail`, `organizationId`, `isDemo` |

## 2. Indexes

New indexes include:

- `facilityIntegrations.by_organization`
- `facilitySyncRuns.by_integration`, `by_organization`
- `transferAgreements.by_requesting`, `by_supplying`
- `transfers.by_request`, `by_supplier`, `by_requester`, `by_status`
- `donorConsents.by_donor`
- `donorInvitations.by_donor`, `by_request`, `by_status`
- `droneBases.by_organization`
- `drones.by_organization`, `by_base`, `by_status`
- `droneMissions.by_transfer`, `by_drone`, `by_state`
- `missionEvents.by_mission`
- `demandForecasts.by_organization`, `by_group`
- `mlModels.by_kind`
- `notifications.by_dedupe`
- `notificationJobs.by_status`, `by_dedupe`
- `anomalyEvents.by_acknowledged`

## 3. Invariants

1. `unitsAvailable ≥ 0`, `unitsReserved ≥ 0`, and `unitsReserved ≤ unitsAvailable`.
2. Free stock = `unitsAvailable − unitsReserved`; allocatable = free stock − `protectedReserve`.
3. A reservation's units may not exceed the batch's free stock at write time.
4. Only `verified && screened && released && expiryDate >= today` batches can be allocated.
5. Dispatch decrements both `unitsAvailable` and `unitsReserved` by the same units; receipt creates a new released batch.
6. A transfer may have at most one non-terminal drone mission.
7. A mission's drone must belong to the supplying facility's base.
8. `DELIVERED` requires a matching handoff code unless an audited admin override is used.
9. A donor invitation requires an active, unexpired consent row and never creates inventory.
10. `isDemo` is propagated to imported inventory, transfers and missions and is visible in the UI.

## 4. Unique identifiers

`orgId`, `requestId`, `batchRef`, `transferId`, `donorId`, `droneId` and `missionId` are generated server-side with sequential counters (`nextSequentialId`). Convex does not support cross-document `UNIQUE` constraints, so uniqueness is enforced by the generation routine; do not accept client-supplied identifiers.

## 5. History and retention

- Request state and mission state each have append-only event tables.
- `inventoryTransactions` is the stock history; do not update it in place.
- Audit logs are append-only.
- A production retention/deletion policy is **not** implemented. See [limitations.md](limitations.md).

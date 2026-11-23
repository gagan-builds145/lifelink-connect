# LifeLink Connect 2.0 — roles, ambulance dispatch and deep-model status

## 1. Role model

LifeLink keeps the existing internal role keys so existing accounts and records
continue to work. The user-facing names are now:

| User-facing role | Internal key | Scope |
| --- | --- | --- |
| Donor | `community` (legacy `donor`/`requestor`) | Donate, request blood, book an ambulance, manage the unified donor dashboard |
| Hospital | `hospital` | Requests, inventory visibility, receipt confirmation, ambulance booking |
| Blood Bank | `red_cross` | Verification, inventory, camps, dispatch, forecasts, ambulance booking |
| Guardian | `guardian` | Ambulance provider fleet, drivers, availability, incoming bookings, live journey status |
| Administrator | `admin` | Network, users, ML, ambulance provider review, audit |

`red_cross` remains the organization type used by the existing inventory and
allocation ledger. Renaming that database value would require a data migration
and is intentionally avoided. All new UI labels present it as **Blood Bank**.

Guardian authorization is separate from hospital, blood bank and donor
authorization. Guardian accounts cannot access supply command, hospital
requests, inventory administration or organization policy.

## 2. Ambulance booking workflow

Routes:

- `/ambulance` — shared booking and history page for Donor, Hospital and Blood Bank.
- `/guardian/dashboard` — Guardian fleet, incoming requests, active journeys and history.
- `/signup/guardian` — Guardian registration after email verification.

Lifecycle:

`requested → accepted → guardian_assigned → on_the_way → arrived_pickup → patient_picked_up → in_transit → completed`

Cancellation is allowed until completion. Rejected requests are recorded as
`cancelled` with a reason.

Backend guarantees:

- Requester identity comes from Convex Auth, never from a client-supplied user id.
- Only Donor, Hospital, Blood Bank and admin roles can create requests.
- A Guardian can only accept/reject requests targeting their own ambulance.
- Only the assigned Guardian can update the journey or share live location.
- Accepting one request closes other pending requests targeting the same vehicle.
- An ambulance cannot be assigned to two active bookings.
- `clientRequestId` makes request creation idempotent.
- One requester cannot hold multiple active bookings.
- Completing or cancelling releases the vehicle.
- Driver phone numbers are only returned after acceptance.
- GPS coordinates for live tracking are only updated during an active assigned booking.
- Every status event is written to `ambulanceBookingEvents`.
- Notifications are role-scoped and link to the correct dashboard.

Facilities use straight-line Haversine distance and an explicit 30 km/h ETA
assumption. This is an operational estimate, not a routing guarantee.

## 3. Database additions

- `guardianProfiles` — provider identity, online state and document review status.
- `ambulances` — vehicle, type, driver, availability, last known location and document reference.
- `ambulanceBookings` — requester, route, target/assigned vehicle, status, ETA/fare estimates and idempotency key.
- `ambulanceBookingEvents` — append-only status and live-location history.

No existing tables or records were removed or rewritten. `users.role` adds the
`guardian` value. Vehicle documents reuse the existing validated `documentMetadata`
upload flow (PDF/JPEG/PNG, 5 MB maximum).

## 4. Deep-learning implementation status

The following TensorFlow/Keras pipelines are implemented and executable when the
optional dependency is installed:

- `ml_service/scripts/train_ann.py`
- `ml_service/scripts/train_lstm.py`
- `ml_service/scripts/train_autoencoder.py`
- `ml_service/scripts/train_all_deep.py`
- `ml_service/scripts/evaluate_all.py`

They use the existing clearly labelled synthetic datasets, chronological or
stratified splits, early stopping, checkpointing, saved scalers and metadata.

**They have not been trained in this environment.** TensorFlow/Keras is not
installed and the filesystem has insufficient free space to install it. No ANN,
LSTM or Autoencoder metrics or artifacts are claimed. `evaluate_all.py` reports
these artifacts as missing rather than inventing results.

Existing trained artifacts remain unchanged:

- XGBoost demand model (synthetic holdout MAE 0.2998 / RMSE 0.4500)
- Random Forest donor response model (synthetic holdout metrics in metadata)
- Isolation Forest inventory anomaly model (synthetic evaluation)

These existing numbers are synthetic-data measurements and are not evidence of
hospital or real-world performance.

## 5. Verification

- `bun test` covers ambulance authorization, dispatch, lifecycle, duplicate
  prevention, live-location authorization, cancellation and document review.
- `bunx tsc -b --noEmit`, `bun run lint`, `bun run build` and
  `bunx convex dev --once` are the required checks.
- Browser GPS, satellite tiles and responsive ambulance screens require a real
  browser pass; they cannot be visually verified in this environment.

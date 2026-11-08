# Known Limitations and Production-Readiness Checklist

This is a working software system, but it is **not** certified medical software, a live hospital integration, or an aircraft control system. The gaps below are deliberate and must be closed before any real operational use.

## 1. Clinical and operational

- **Compatibility is rule-based but not clinically certified.** `src/lib/blood.ts` encodes ABO/Rh component tables. A transfusion specialist must review and sign off the matrix and local SOPs. Cross-matching, antibody screening and clinician judgement remain mandatory.
- **No real hospital or blood-bank is connected.** The adapter framework, mock adapter and credentialed REST sync exist. No production HMS endpoint, schema mapping, sandbox certification or webhook receiver has been validated.
- **Standalone blood-bank onboarding is missing.** The organization model supports `blood_bank`, but only donor, requestor, hospital and Red Cross signup screens exist. A blood bank currently needs an administrator-created shell/organization or adaptation of the Red Cross signup.
- **Institutional agreements require admin setup.** Automatic allocation depends on active agreements and facility policy flags; there is no self-service approval workflow.
- **Admin bootstrap is manual.** Set `users.role = "admin"` in the Convex dashboard for the first administrator. There is no public admin registration.
- **No retention/deletion automation.** Legal retention schedules and donor/patient deletion workflows are not implemented.

## 2. Geospatial and scale

- **No PostgreSQL/PostGIS.** Search loads candidate batches and evaluates haversine distance/geofences in the Convex function. That is deterministic and test-covered, but it is not spatially indexed at PostgreSQL scale.
- **The sub-500 ms target was not benchmarked.** Only unit-test execution times were measured. No load, large-dataset or p95 latency test was run.
- **Coordinates depend on city defaults or organization records.** Missing/incorrect coordinates block district routing and drone planning; there is no geocoding provider.
- **Donor location is a consented city-level approximation, not live GPS.** No continuous donor tracking is implemented. This is intentional for privacy.

## 3. Drone system

- **No PX4/ArduPilot, MAVLink or MAVSDK connection.** The mission state machine, preflight, telemetry simulation and failure drills are implemented in TypeScript. No autopilot software-in-the-loop process is included, so the required SITL integration test has **not** been executed.
- **Routes are corridor proxies, not safe flight routes.** They include waypoints and restricted-zone checks but no obstacle/terrain data, NOTAMs, approved corridors or landing-zone survey.
- **Weather is simulated/manual.** There is no live weather provider.
- **Airspace data is a training dataset.** It is not authoritative and must never be used for flight clearance.
- **No real aircraft command path exists.** The browser cannot send motor commands. Real operations require DGCA/ATC approvals, certified aircraft, a remote pilot, operator certification and operational safety validation.
- **Telemetry is a latest snapshot**, not a high-frequency flight log. The simulation advances every 30 s via cron.
- **Delivery evidence is a one-time code.** An admin override is possible and audited; real operations would require stronger evidence and dual control.

## 4. AI / ML

- **No XGBoost/Random Forest.** Demand forecasting uses ridge regression with seasonality, lags and a rolling mean. Donor response uses logistic regression. Both are genuine and evaluated, but they are not the requested tree models.
- **Metrics are only as good as the data.** Demo history is synthetic and labelled. No real hospital demand dataset has been used; reported MAE/RMSE must not be treated as clinical accuracy.
- **No drift monitoring or automated retraining pipeline.** Models are versioned on manual/scheduled runs, but drift detection, approval gates and rollback are not implemented.
- **No 24-hour/7-day/30-day guarantee.** Short or sparse series return `insufficient_data` rather than a number.
- **Donor model is optional.** With fewer than 20 answered invitations, or one-sided outcomes, no model is trained and invitations fall back to distance/eligibility. It is never used for medical eligibility.

## 5. Integrations and notifications

- **Webhook and database-connector modes are registry labels, not executed ingestion paths.** The live implementation is a pull from `{baseUrl}/inventory`; mock sync is implemented. A webhook receiver and DB bridge must be built and secured.
- **No push notifications.** In-app, email (Resend) and SMS (Twilio) only. Missing credentials record `skipped_no_provider`.
- **No delivery guarantee beyond the outbox retry policy.** Provider webhooks/bounces and dead-letter dashboards are not implemented.
- **No automatic duplicate-patient detection or clinical authorization workflow** beyond the existing request verification.

## 6. Security, reliability and testing

- **No edge rate limiting/WAF.** Existing request/contact endpoints have database-backed limits, but new supply/drone/admin endpoints rely on auth and Convex platform protections.
- **No SQL injection surface** because there is no SQL, but no automated security scan or penetration test was run.
- **No automated API, database-concurrency, real-time, geospatial API, security, load or end-to-end test suite.** The executed suite is 26 pure-domain unit tests (see [test-report.md](test-report.md)).
- **Code coverage was not measured.** No coverage tool is configured; do not claim a percentage.
- **Concurrency correctness relies on Convex serializable mutations** and re-checking free stock. A multi-client simultaneous reservation test has not been automated.
- **No production backup/restore drill.** Backups are a deployment concern and must be configured and tested.
- **No offline mode or native mobile app.**
- **No monitoring/alerting integration** beyond the admin dashboard and Convex logs.

## 7. Production-readiness checklist

| Gate | Status |
| --- | --- |
| Deterministic compatibility and release filters | Implemented, needs clinical sign-off |
| Atomic reservations and protected reserve | Implemented, concurrency test not automated |
| Donor consent gate | Implemented, privacy review pending |
| Facility integration framework | Implemented for pull + mock; production connector pending |
| Genuine ML with chronological evaluation | Implemented (ridge/logistic); real data validation pending |
| Drone mission state machine / preflight / simulation | Implemented in software |
| PX4/ArduPilot SITL / MAVLink | **Not implemented** |
| Automated API/E2E/load/SITL/security tests | **Not implemented** |
| Rate limiting, WAF, monitoring, backups | Partial / deployment work required |
| Clinical, legal and DGCA approvals | **Not obtained** |
| Production deployment | **Not performed** |

**Bottom line:** the institutional allocation, consent-gated donor fallback, notification outbox and simulated drone workflow are functional and testable. Real inventory integration, real flight control, production security hardening and regulatory approval remain out of scope of this build.

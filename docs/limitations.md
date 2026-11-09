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

- **SITL was not executed.** A mission export and an optional MAVSDK bridge exist in `drone_bridge/`, but no PX4/ArduPilot SITL runtime is installed in this environment. The bridge upload path is unverified. The built-in mission state machine, preflight, telemetry simulation and failure drills are implemented and tested in software.
- **Routes are corridor proxies, not safe flight routes.** They include waypoints and restricted-zone checks but no obstacle/terrain data, NOTAMs, approved corridors or landing-zone survey.
- **Weather is simulated/manual.** There is no live weather provider.
- **Airspace data is a training dataset.** It is not authoritative and must never be used for flight clearance.
- **No real aircraft command path exists.** The browser cannot send motor commands. Real operations require DGCA/ATC approvals, certified aircraft, a remote pilot, operator certification and operational safety validation.
- **Telemetry is a latest snapshot**, not a high-frequency flight log. The simulation advances every 30 s via cron.
- **Delivery evidence is a one-time code.** An admin override is possible and audited; real operations would require stronger evidence and dual control.

## 4. AI / ML

- **Bundled metrics are synthetic.** The checked-in XGBoost artifacts were trained on a deterministic generated dataset, not hospital demand. The measured MAE/RMSE and improvement versus baseline are evidence that the training/evaluation pipeline works, **not** evidence of clinical or operational accuracy.
- **Python 3.13 was not executed here.** The service was installed, trained and tested on Python 3.10.12 because that is the available interpreter. The Dockerfile targets 3.13 and the requirements have interpreter-specific NumPy/SciPy pins, but 3.13 remains unverified in this environment.
- **Convex integration was not executed end-to-end.** Unit/API tests exercise the FastAPI service with `TestClient`. No persistent ML server was exposed to the Convex Cloud deployment during this run, so the authenticated Convex action path has not been tested live. `ML_SERVICE_URL` and `ML_SERVICE_TOKEN` are required.
- **No drift monitoring or automatic production retraining approval.** An admin-triggered retraining action and a scheduled refresh path exist, but drift detection, approval gates, rollback and model monitoring are not implemented.
- **Forecast method limitations.** The served model is a global XGBoost regressor with lag/rolling/calendar features and a one-step chronological holdout. Recursive 30-day forecasts can compound error; the reported holdout metrics are not multi-step backtest guarantees.
- **Donor models serve different roles.** The active in-app invitation ranker is a logistic model trained from Convex invitation outcomes. The Python Random Forest donor API and artifact are trained and tested separately on consented synthetic samples, but are not currently used to write invitation probabilities. Medical eligibility remains deterministic in both paths.
- **Anomaly alerts require human review.** Isolation Forest combined with a z-score can produce false positives or miss context. It does not identify theft, wastage, a clinical error or a cause.

## 5. Integrations and notifications

- **Webhook and database-connector modes are registry labels, not executed ingestion paths.** The live implementation is a pull from `{baseUrl}/inventory`; mock sync is implemented. A webhook receiver and DB bridge must be built and secured.
- **No push notifications.** In-app, email (Resend) and SMS (Twilio) only. Missing credentials record `skipped_no_provider`.
- **No delivery guarantee beyond the outbox retry policy.** Provider webhooks/bounces and dead-letter dashboards are not implemented.
- **No automatic duplicate-patient detection or clinical authorization workflow** beyond the existing request verification.

## 6. Security, reliability and testing

- **No edge rate limiting/WAF.** Existing request/contact endpoints have database-backed limits, but new supply/drone/admin endpoints rely on auth and Convex platform protections.
- **No SQL injection surface** because there is no SQL, but no automated security scan or penetration test was run.
- **No automated API, database-concurrency, real-time, geospatial API, security, load or browser end-to-end suite.** Executed: 26 TypeScript domain tests and 21 Python ML/SITL-validation/training tests. The FastAPI endpoints were tested in-process, not through the deployed Convex action path (see [test-report.md](test-report.md)).
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
| Genuine ML with chronological evaluation | XGBoost/Random Forest/Isolation Forest implemented and tested on synthetic data; real data validation pending |
| Drone mission state machine / preflight / simulation | Implemented in software |
| PX4/ArduPilot SITL / MAVSDK | Bridge scaffold + export implemented; **not executed** |
| Automated API/E2E/load/live-SITL/security tests | **Not implemented** |
| Rate limiting, WAF, monitoring, backups | Partial / deployment work required |
| Clinical, legal and DGCA approvals | **Not obtained** |
| Production deployment | **Not performed** |

**Bottom line:** the institutional allocation, consent-gated donor fallback, notification outbox, Python ML service and simulated drone workflow are functional and testable. Real inventory integration, live SITL/flight control, live Convex-to-ML deployment verification, production security hardening and regulatory approval remain out of scope of this build.

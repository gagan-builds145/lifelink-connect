# Production-readiness assessment

This assessment reflects what was actually implemented and tested in this
workspace. It is not a certification or a claim of clinical or aviation safety.

## Classification

| Area | Classification | Evidence / blocker |
| --- | --- | --- |
| Deterministic compatibility, eligibility, allocation planning | **Implemented and verified** | 41 TypeScript tests / 228 assertions, including real Convex reservation, dispatch, receipt and role-guard integration |
| XGBoost demand model loading, training and prediction | **Implemented and verified** | 22 Python tests on Python 3.13.15 and 3.10.12; synthetic holdout metrics |
| Random Forest donor batch scoring and explainability | **Implemented and verified at the API level** | Python batch test, consent rejection, top model-wide factors |
| Isolation Forest anomaly detection | **Implemented and verified at the API level** | Python tests and persisted-alert action code |
| ML service authentication and readiness | **Implemented and verified** | Bearer token tests; `/livez` public, `/health` authenticated when configured |
| ML HTTP timeouts/retries | **Implemented but not load-tested** | Shared Convex client; no deployed failure-injection test |
| Donor invitation scoring in the active allocation transaction | **Implemented and locally verified; live ML path unverified** | Auto-allocation, consent gate, invitation, acceptance, revoked consent and distance fallback pass in `convex-test`; no live Convex Cloud → HTTPS run |
| Resend email and Twilio SMS delivery | **Awaiting external credentials** | Outbox, retries/status recording and in-app fallback implemented; no provider credentials available |
| Hospital/blood-bank connector framework and mock sync | **Implemented and locally verified; live sandbox untested** | Mock sync idempotency, persisted inventory and missing-credential failure recording pass in `convex-test`; no real HMS credentials or sandbox sync |
| Browser role dashboards and screenshots | **Not executed** | No browser automation session was run in this workspace |
| Concurrency/load/security test matrix | **Partially executed** | In-memory concurrent reservation test passes; no multi-client production load, penetration or security suite |
| PX4/ArduPilot SITL upload, telemetry and abort | **Simulation only / not executed** | Export, validation and dry-run tests pass; no SITL/MAVSDK runtime installed |
| Production Convex deployment | **Awaiting external credentials and approval** | Development deployment only |
| Production ML HTTPS deployment | **Awaiting infrastructure** | Dockerfile and runbook exist; no Docker host or TLS endpoint provisioned |
| Clinical use | **Awaiting legal and clinical approval** | Compatibility tables and SOPs require specialist sign-off |
| Real drone operations | **Awaiting legal and regulatory approval** | No airworthiness, DGCA/ATC, operator, aircraft or insurance approval |

## What is complete in software

- Existing React/Convex application preserved.
- Deterministic supply chain and atomic reservations preserved.
- Python FastAPI service with XGBoost, Random Forest and Isolation Forest.
- Python 3.13.15 and 3.10.12 test runs.
- Authenticated Convex-to-ML client with timeouts and retries for idempotent calls.
- Donor scoring moved into the active allocation flow with a deterministic
  eligibility gate and a no-fabrication fallback.
- Model versioning/provenance stored on invitations and in the model registry.
- Docker production image with mandatory auth and liveness health check.
- Notification outbox with Resend/Twilio support and in-app fallback.
- Hospital pull adapter, mock adapter and failure recording.
- SITL export and safety-limited MAVSDK bridge scaffold.
- Test evidence and operations/security/backup documentation.

## What is not complete

- No production deployment or production credentials.
- No live Cloud Convex → HTTPS ML request.
- No Docker image build (Docker unavailable).
- No real email/SMS delivery test.
- No real hospital connection or sandbox certification.
- No browser/E2E screenshots or full role walkthrough.
- No production load, penetration or multi-client concurrency test; only the in-memory transactional suite.
- No minified production bundle: Vite completed the unminified production build, but minification exceeded the runner limit.
- No SITL execution or physical drone operation.
- No clinical, privacy or aviation approval.

## Bottom line

The repository is a substantial, test-backed implementation and is ready for a
controlled integration environment. It is **not** production-ready for clinical
or aviation operations. Promotion requires the external credentials, deployment,
security review, restore drill, clinical sign-off and regulatory approvals listed
above.

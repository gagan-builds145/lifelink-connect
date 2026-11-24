# LifeLink Connect 2.0 — Phase 4 final report

Date: 2026-11-24

## Implemented

### 1. Live Aadhaar Verification removed permanently

- Deleted `src/convex/aadhaar.ts`, `src/convex/lib/aadhaarProvider.ts`, the
  `/aadhaar/callback` HTTP route, the Aadhaar cron, schema table, validators,
  Admin Console identity tab and Guardian identity fields/UI.
- No UIDAI connection, live provider credentials, callback secret, sandbox mode
  or Aadhaar consent/session flow remains.
- No Aadhaar number, OTP, biometric or Aadhaar document is stored.
- Email OTP authentication is unchanged.
- Unrelated donor/requestor profiles, blood-group history, consent and audit
  records were preserved.
- Documentation now states clearly that Live Aadhaar Verification is not part of
  LifeLink. See [identity-verification.md](identity-verification.md).

### 2. Security fixes from the authorization review

- Removed the Red Cross blanket access path to all uploader documents.
- Added fail-closed document quarantine; only `scanStatus: clean` documents can
  be downloaded, reviewed, attached to requests or referenced by vehicles.
- Closed a second download bypass in request detail that returned a storage URL
  without checking scan status.
- Prevented deletion of reviewed Guardian documents.
- Required individual document approval before Guardian application approval.
- Blocked approval of an expired document.
- Restored Guardian eligibility only after a clean, approved replacement passes
  the full compliance check; restoration does not automatically go online.
- Confirmed existing server-side role ownership, ambulance tracking privacy and
  idempotency controls via the security test suite.

### 3. Malware scanning

- Added `src/convex/scan.ts` and a separate authenticated ClamAV-compatible
  scanner service under `services/malware-scanner/`.
- Files remain quarantined on scanner absence, timeout or error.
- Scan status, timestamps, engine, signature and safe error are stored; file
  contents are not exposed.
- Upload UIs show pending/scanning/clean/infected/error and provide retry for
  recoverable errors.
- See [malware-scanning.md](malware-scanning.md).

### 4. Guardian document-expiry reminders

- Daily Convex cron with configurable thresholds
  (`GUARDIAN_DOC_EXPIRY_REMINDER_DAYS`, default `30,14,7,1`).
- Idempotent Guardian and administrator notifications with deterministic dedupe
  keys and audit rows.
- Expired documents mark the profile `EXPIRED`, force it offline and suspend
  vehicle availability.
- Replacement flow restores eligibility only after clean, approved documents.
- See [guardian-onboarding.md](guardian-onboarding.md).

## Tested and passed

| Check | Command | Result |
| --- | --- | --- |
| Convex generation + TypeScript | `bun convex dev --once && bunx tsc -b --noEmit` | Passed |
| Bun + scanner tests | `bun test` | **202 passed, 0 failed**, 905 assertions, 20 files |
| Focused Phase 4 tests | `bun test tests/guardianHardening.test.ts tests/phase3.test.ts` | **15 passed** |
| Malware scanner protocol | `node --test test/*.test.mjs` | **3 passed** (clean, infected stub, unreachable fail-closed) |
| Python ML service | `python3 -m pytest -q` | **52 passed**, 1 deprecation warning |
| ESLint | `bunx eslint .` | **0 errors**, 18 existing warnings |
| Production build | `bun run build` | **Success**, 13.23 s |
| Public browser checks | `node scripts/browser-public-check.mjs` | 5 scenarios passed; see browser report |
| ML inference load | `api_load_test.py --requests 100 --concurrency 8` | 0 errors, p95 **66.99 ms**, 145.31 req/s |

Screenshots: `browser-screenshots/phase4-final/`. Raw browser report:
`browser-screenshots/phase4-browser-report.json`.

## Tested and failed / findings

1. A 120-request ML run returned 3 × HTTP 429 because the configured limit is
   120/minute. This is intended rate limiting, not a model failure. The limit
   was not weakened; the bounded 100-request run passed.
2. The Vly preview runtime injects a jsdelivr screenshot script that the app CSP
   blocks. This is a platform-only console error. CSP was **not** weakened to
   allow a third-party script.
3. Some CARTO map tiles abort when the browser test closes the page while tiles
   are loading. No app exception was recorded.

## Blocked by environment or missing credentials

### ANN / LSTM / Autoencoder — **NOT TRAINED**

Exact blocker:

```text
TensorFlow is not installed. Install ml_service/requirements-deep.txt in a
Python 3.10–3.12 environment before training deep models. No model artifacts or
metrics were produced.
```

The host has ~140 MB free disk, insufficient for TensorFlow plus dependencies.
No `.keras` file, scaler, history, metric or comparison was fabricated.
`verify_deep_artifacts.py` reports ANN/LSTM/Autoencoder missing, and the deep
FastAPI endpoints fail closed (503) rather than inventing predictions.
See [deep-training-cloud.md](deep-training-cloud.md).

### Real ClamAV end-to-end scan

`clamd` is not installed and port 3310 is closed on this host. The scanner
protocol and fail-closed paths passed against a loopback stub, but a live EICAR
scan through genuine ClamAV is **not verified**.

### Authenticated browser / mobile workflows

No usable authenticated OTP session or approved Guardian/provider account was
available. Donor/Guardian/admin onboarding, document review, role switching,
blood requests, ambulance booking/notifications, notification bell, Locate Me
and authenticated mobile layouts were **not executed** in a browser. Backend
tests do not count as a browser pass. See
[phase4-browser-report.md](phase4-browser-report.md).

### Convex production load testing

No authenticated production deployment/session was available. Concurrent users,
Convex query/mutation load, real-time subscriptions, large pagination and
Guardian workflow load were not measured. No million/ten-million-user capacity
is claimed. See [phase4-performance-report.md](phase4-performance-report.md).

## Archive verification

`lifelink-connect-2.0-phase4.zip` was created from source/config/docs/tests and
examined with `unzip -t` (no errors). It was extracted to a clean directory and
verified there independently:

- `bunx tsc -b --noEmit` — passed;
- `bun run build` — passed;
- `bun test tests/guardianHardening.test.ts services/malware-scanner/test/clamd.test.mjs`
  — **8 passed, 0 failed**.

The Phase 2 and Phase 3 archives were not modified. The archive excludes
`node_modules`, build output, VCS data and local secrets; `env.example` remains
the configuration template.

## Not implemented

- ANN donor-response deep model.
- LSTM demand deep model.
- Autoencoder inventory deep model.
- Aadhaar identity verification of any kind (intentionally not implemented).
- Million/ten-million-user scale evidence.
- Live SITL aircraft execution.

## Lightweight model metrics (synthetic data only)

These existing artifacts are genuine and load through FastAPI, but trained on
deterministic synthetic data — not hospital performance:

| Model | Metric |
| --- | --- |
| XGBoost demand | MAE 0.2998, RMSE 0.4500, baseline MAE 0.7652, 8,608 train / 2,176 holdout |
| Random Forest donor | Accuracy 0.7056, precision 0.8288, recall 0.8121, F1 0.8203, ROC-AUC 0.6066 |
| Isolation Forest anomaly | Precision 0.3333, recall 1.0, F1 0.5, FPR 0.0452 |

ML remains advisory. Deterministic compatibility, eligibility and human review
continue to govern clinical decisions.

# LifeLink Connect 2.0 — Phase 3 independent audit (historical)

> **Superseded:** The Aadhaar adapter and sandbox described below were removed permanently in the final Phase 4 release. See [identity-verification.md](identity-verification.md).

Date: 2026-11-23
Auditor: Phase 3 implementation pass
Scope: the Phase 2 project in this workspace (source tree, Convex functions, FastAPI service, ML artifacts, tests and documentation).

## Method

1. Read the application schema, role helpers, authentication configuration and every Convex module touched by the claims.
2. Read the FastAPI route table, model-loading code and AI registry.
3. Ran the existing suites and inspected their output rather than trusting the Phase 2 report.
4. Compared each claim with direct code and test evidence.
5. Anything that requires a browser, an external provider, TensorFlow, S3 credentials or a load environment is marked NOT INDEPENDENTLY TESTABLE rather than passed.

Environment limits that shape this audit: no Chromium/Chrome, no TensorFlow, no `boto3`/`pyarrow`, no S3 credentials, ~110 MB free disk.

## Status summary

| # | Feature | Reported status (Phase 2) | Actual status | Evidence | Required action |
| --- | --- | --- | --- | --- | --- |
| 1 | Seven AI API endpoints | Working | **VERIFIED** | `ml_service/app/main.py` defines `/ai/demand/predict`, `/ai/donor-response/predict`, `/ai/inventory/anomaly-detect`, `/ai/models`, `/ai/models/{name}/status`, `/ai/models/{name}/metrics`, `/ai/health`. `ml_service/tests/test_ai_endpoints.py` covers all seven plus concurrency. | None for code. Re-run the live service in a credentialed environment. |
| 2 | AI model approval and disable | Working | **VERIFIED** | `src/convex/aiRegistry.ts` implements `registerModelArtifact`, `promoteModel`, `disableModel`; `tests/aiRegistry.test.ts` proves one active version per kind, rollback and disable. | None. |
| 3 | Model training history | Working | **VERIFIED** | `aiTrainingRuns` table in `src/convex/schema.ts`; `aiRegistry.trainingRuns`; admin panel reads it. | None. |
| 4 | Model locking and concurrency | Repaired in Phase 2 | **VERIFIED** | `MODEL_LOCKS` and `_run_blocking` in `ml_service/app/main.py`; `test_ai_endpoints.py` concurrent-demand case; `api-load-report.json` records 0 errors. | None. |
| 5 | Dataset audit | 11,680 / 900 / 240 rows, no PHI | **VERIFIED** | `ml_service/artifacts/dataset-audit.json` and `scripts/audit_datasets.py` exist with the reported counts. | Re-run audit if datasets change. |
| 6 | AI management dashboard | Working | **VERIFIED (code) / NOT INDEPENDENTLY TESTABLE (visual)** | `src/pages/AdminConsole.tsx` renders storage, model catalog, training runs, promote/disable. No browser run was possible. | Browser pass in a Chromium-capable environment. |
| 7 | AI storage architecture | S3-compatible, Parquet, 500 GB → 5 TB | **PARTIALLY IMPLEMENTED** | `ml_service/app/ai_storage.py` and the CLI implement keys, capacity, retention, backup/restore; `storage-load-report.json` is local-object-store only. `boto3`/`pyarrow` are not installed and no bucket is configured. | Execute S3 and Parquet paths with credentials; replace local-only numbers. |
| 8 | Backup and restoration | Working | **PARTIALLY IMPLEMENTED** | Local backup/restore measured (0.003 s) in `tests/test_ai_storage.py`; no cloud backup test. | Run cloud backup/restore and restore-to-new-bucket test. |
| 9 | Guardian permissions | Working | **VERIFIED** | `src/convex/ambulances.ts` scopes vehicles, acceptance and live location to the owning Guardian; `tests/ambulance.test.ts` (12 tests) covers cross-Guardian access denial. | None. |
| 10 | Ambulance booking permissions | Working | **VERIFIED** | `createBooking`, `acceptBooking`, `updateBookingStatus`, `shareLocation` enforce ownership and lifecycle; tests cover unauthorized reads/cancels and illegal transitions. | None. |
| 11 | Donor consent handling | Working | **VERIFIED** | `donorConsents`, `lib/community.ts` and `donorFallback.ts` require active unexpired consent; `tests/community.test.ts` covers consent gating. | None. |
| 12 | Model artifacts and metrics | Working | **VERIFIED** | `ml_service/artifacts/demand_model.json`, `donor_response.joblib`, `inventory_anomaly.joblib`, metadata JSON and `training-summary.json`; metrics match the Phase 2 report. | Deep `.keras` artifacts remain absent (correctly reported). |
| 13 | Existing frontend/backend tests | 133 TS + 45 Python | **VERIFIED** | `bun test` now reports 146 passing (13 new Phase 3 tests); `pytest` previously reported 45 passing. | Re-run pytest after dependency changes. |
| 14 | Authentication and RBAC | Working | **VERIFIED** | Email OTP only in `src/convex/auth.ts`; no anonymous provider; `requireRole`/`requireUser` on every privileged function; `tests/auth.test.ts` + `tests/security.test.ts`. | None. |
| 15 | Deep ANN/LSTM/Autoencoder training | NOT TRAINED | **NOT IMPLEMENTED (unchanged)** | TensorFlow is absent; scripts exit 2 instead of fabricating artifacts. `docs/deep-training-cloud.md` documents the external workflow. | Run on a TensorFlow-capable host, then register and approve artifacts. |
| 16 | CNN model | NOT IMPLEMENTED | **NOT IMPLEMENTED** | No validated image dataset or task; intentionally absent. | Do not add without a validated dataset. |
| 17 | Real browser role/ambulance testing | NOT RUN | **NOT INDEPENDENTLY TESTABLE** | No Chromium executable; ~110 MB free disk. Phase 2 explicitly disclosed this. | Run the new checklist in `docs/phase3-report.md` on a browser-capable host. |
| 18 | 1M / 10M-user capacity | No claim | **NOT INDEPENDENTLY TESTABLE** | Only bounded in-process load tests exist (`40 requests`, 150.83 rps). No distributed load environment. | Do not claim these figures. Run a real load test before any claim. |

## Defects and gaps found during this audit

These are real issues in the Phase 2 code that Phase 3 fixes or documents:

| Finding | Impact | Phase 3 action |
| --- | --- | --- |
| `registerGuardian` rejected any account that already had a non-`user` role | An existing Donor could not become a Guardian without a second account, violating Part 6 | Added `guardian.registerExistingDonor` with server-side Donor-ID ownership validation, multi-role grant and workspace switching. |
| `users.role` was a single value | No supported way to hold Donor + Guardian on one account | Added `users.roles` while keeping `role` as the active workspace. `requireRole` and the UI now honour all granted roles. |
| Ambulance statuses lacked `rejected`, `expired`, `failed` | Declines were recorded as `cancelled`; stale requests never expired | Extended the validator and lifecycle, added the expiry cron and `rejectBooking → rejected`. |
| Document upload trusted the browser MIME type | A renamed non-PDF could be stored as PDF | `documents.attachDocument` now checks the real PDF/JPEG/PNG signature from stored bytes, verifies size, sanitises the filename and rate-limits. |
| Guardian onboarding collected only six fields | No driver, vehicle, insurance, fitness, PUC, permit, equipment or payout evidence | Added the full application schema, mandatory-section validation, vehicle expiry checks, per-document admin review and immutable review events. |
| No identity verification | None | Added a provider-independent Aadhaar adapter with an explicitly labelled sandbox, consent records, signed callbacks and admin review. Live verification remains disabled. |
| Guardian could go online with no approval or documents | Unapproved/expired fleets could appear in searches | `setGuardianOnline` now requires an approved application and passes the compliance check; nearby search uses approval, not the legacy flag. |
| Blood group had no provenance | A manually entered group could be mistaken for a verified one | Added `bloodGroupSource`, a changelog table, a medical-lock rule and the required "Donor-Declared Blood Group — Not Medically Verified" label. |

## Audit conclusion

The Phase 2 report is broadly accurate: it does not claim deep-model training, browser testing or cloud storage that did not happen. The main gaps were functional (single-role accounts, incomplete Guardian intake, no identity verification, weak upload validation, incomplete booking states), and those are addressed in Phase 3 with automated tests. Cloud storage, TensorFlow training, live Aadhaar and browser E2E remain genuinely unverified and are reported as such.

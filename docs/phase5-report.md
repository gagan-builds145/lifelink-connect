# LifeLink — Phase 5 implementation report

Date: 2026-11-23
Scope: close the Phase 4 gaps — deep-model training/integration, automatic ambulance re-matching, browser verification, final QA and release.

## A. ANN training

| Item | Actual result |
|---|---|
| Environment | Local Python 3.10.12; TensorFlow/Keras **not installed** |
| TensorFlow/Keras | Not available |
| GPU or CPU | **No training run** — neither GPU nor CPU |
| Dataset | Synthetic consented donor-response sample produced by `app.donor_model.synthetic_donor_samples()`; no real donor records |
| Training duration | **Not run** |
| Evaluation metrics | **None produced** |
| Artifact path | **None** |
| Integration status | Code path implemented; `/ai/ann/predict` returns 503, `ready: false` |
| Status | **NOT TRAINED** |

The existing architecture remains Dense(32, ReLU) → Dropout(0.2) → Dense(16, ReLU) → Dropout(0.2) → Dense(1, sigmoid), Adam, binary cross-entropy, batch 32, max 120 epochs, early stopping patience 12. The pipeline now holds out the same 20% stratified test fraction and seed as the Random Forest, records class weights, Brier score, environment/device, duration, split sizes and history.

## B. LSTM training

| Item | Actual result |
|---|---|
| Environment | Local Python 3.10.12; TensorFlow/Keras **not installed** |
| TensorFlow/Keras | Not available |
| GPU or CPU | **No training run** |
| Dataset | Deterministic synthetic demand, 32 blood-group/component series × 365 days |
| Training duration | **Not run** |
| Forecasting metrics | **None produced** |
| Artifact path | **None** |
| Integration status | Code path implemented; `/ai/lstm/predict` returns 503, `ready: false` |
| Status | **NOT TRAINED** |

Architecture remains LSTM(32) → Dropout(0.2) → Dense(16, ReLU) → Dense(1), Adam, MSE, batch 64, max 100 epochs, early stopping patience 10. The sequence split is now **per series chronologically** (70/15/15) before concatenation, preventing later dates in one series leaking into validation through another; the scaler fits training sequences only. A rolling 7-day mean baseline is computed on the same test sequences.

## C. Autoencoder training

| Item | Actual result |
|---|---|
| Environment | Local Python 3.10.12; TensorFlow/Keras **not installed** |
| TensorFlow/Keras | Not available |
| GPU or CPU | **No training run** |
| Dataset | Deterministic synthetic normal inventory with injected labelled synthetic spikes/drops; not hospital incidents |
| Training duration | **Not run** |
| Reconstruction threshold | **None produced** |
| Evaluation metrics | **None produced** |
| Artifact path | **None** |
| Integration status | Code path implemented; `/ai/autoencoder/detect` returns 503, `ready: false` |
| Status | **NOT TRAINED** |

Architecture remains Dense(8, ReLU) → Dense(4, ReLU) → Dense(8, ReLU) → output, Adam, MSE, batch 16, max 150 epochs, early stopping patience 15. The threshold is now the 95th percentile of **held-out normal validation** reconstruction error; the test set contains held-out normals plus all labelled anomalies. Metrics are precision, recall, F1, false-positive rate and confusion matrix.

### Deep verification evidence

```text
$ python3 scripts/train_all_deep.py
TensorFlow is not installed. Install ml_service/requirements-deep.txt ...
No model artifacts or metrics were produced.
exit 2

$ python3 scripts/evaluate_all.py
ANN / LSTM / Autoencoder: artifacts not present / not trained
exit 2

$ python3 scripts/verify_deep_artifacts.py
"missing": ["ANN", "LSTM", "Autoencoder"]
exit 2
```

No placeholder `.keras`, scaler, history or metric was created. The reproducible Colab workflow is `ml_service/notebooks/LifeLink_Deep_Training_Colab.ipynb`; it installs the pinned dependencies, reports the actual device, trains, evaluates, loads each model, runs inference, writes SHA-256 checksums and packages only verified artifacts. It has **not been executed** because this environment has no TensorFlow, no GPU and no Colab credentials/session.

## D. Automatic ambulance re-matching

### Files changed

- `src/convex/ambulances.ts` — shared candidate selection, bounded re-match mutation, honest expiry helper, expiry sweep updated.
- `src/convex/crons.ts` — one-minute re-match job.
- `src/convex/schema.ts` — `searchExpiresAt`, `rematchAttempts`, `nextRematchAt`, `rematchExhaustedAt`.
- `src/lib/ambulance.ts` — 30-minute window, 60-second interval, 20-attempt cap, deadline helper.
- `src/pages/AmbulanceOneTap.tsx` — re-check count, search deadline, requested-provider label, cancel request.
- `tests/ambulanceRematch.test.ts` — nine tests.

### Retry strategy

- A booking created with no candidate is genuinely `searching` and stores `searchExpiresAt = now + 30 min`, `rematchAttempts = 0`, `nextRematchAt = now + 60 s`.
- The server cron runs every minute. Each booking has its own due time; a booking is skipped until due.
- Candidate checks: approved provider, provider online, vehicle available, valid coordinates, not assigned to an active booking, not targeted by another open booking, within 100 km. Nearest wins.
- On no candidate: increment attempts, set next attempt (capped at the deadline).
- On candidate: re-read the vehicle, then atomically patch the target, ETA and attempt count; an event and guardian notification are written. The booking stays `searching` until a real provider accepts — it is not marked dispatched.
- On deadline or 20 attempts: status `expired`, `rematchExhaustedAt`, reason “No approved ambulance became available within the 30-minute search window”, event and requester notification with the next operational step.
- Cancellation removes the booking from the `searching` set, so no later retry can match it.

### Scheduling and duplicate protection

- Server-side Convex cron, no client timers and no unbounded `ctx.scheduler` chain.
- Duplicate execution is idempotent: only `searching` bookings without a target are considered, and a target already set is skipped.
- Target reservation prevents two searching bookings selecting the same vehicle; `acceptBooking` still re-checks for active assignment conflicts.
- Availability is re-read immediately before assignment. A vehicle that became unavailable is skipped.
- Expiry is exactly-once because the status changes to `expired`.

### Test results

`bun test tests/ambulanceRematch.test.ts`: **9 passed, 0 failed, 41 assertions**.

Covered: no ambulance initially; vehicle becomes available; offline provider comes online; vehicle unavailable before assignment; two bookings competing; cancellation while searching; duplicate cron execution; retry cap; window expiry with truthful notification; provider acceptance after a retried match; bounded `searchExpiresAt`.

## E. Browser verification

**Not performed.** Attempted setup found no browser binary:

- `~/.cache/ms-playwright` contains only `.links`; there is no Chromium or headless shell.
- No system Chromium, Chrome, Firefox or WebKit binary is installed.
- The Playwright launch fails with “Executable doesn't exist”.
- Disk is 99% full with ~44 MB free; the Chromium/headless-shell download cannot fit.
- The Vite app is reachable at `http://127.0.0.1:5173`, but no screenshots or click-through results are claimed.

Unverified in a real browser: donor dashboard button order, GPS permission/capture, one-tap submission, searching/assignment transitions, refresh reuse, GPS denial/timeout/weak fix, animations, reduced motion, responsive layout, heading-only pages and the removed identity section. Backend and unit tests cover the server logic; they are not a substitute for the browser walkthrough.

## F. Final six-model acceptance

| Model | Training | Artifact | Validation | Independent test | API inference |
|---|---|---|---|---|---|
| XGBoost | Trained (Phase 4 rerun) | `demand_model.json` + metadata | Chronological holdout | MAE **0.2998**, RMSE **0.4500**, baseline MAE 0.7652, RMSE 1.1816, **60.83%** improvement, 8,608/2,176 | Existing `/ai/demand/predict`, pytest verified |
| Random Forest | Trained (Phase 4 rerun) | `donor_response.joblib` + metadata | Stratified 720/180 | Accuracy **0.7056**, precision **0.8288**, recall **0.8121**, F1 **0.8203**, ROC-AUC **0.6066**, Brier **0.1809**, confusion `[[6,25],[28,121]]` | Existing `/ai/donor-response/predict`, pytest verified |
| Isolation Forest | Trained (Phase 4 rerun) | `inventory_anomaly.joblib` + metadata | Normal-fit + labelled synthetic anomalies | Precision **0.3333**, recall **1.0**, F1 **0.5**, FPR **0.0452**, confusion `[[211,10],[0,5]]` | Existing `/ai/inventory/anomaly-detect`, pytest verified |
| ANN | **NOT TRAINED** | None | Not run | None | 503 fail-closed |
| LSTM | **NOT TRAINED** | None | Not run | None | 503 fail-closed |
| Autoencoder | **NOT TRAINED** | None | Not run | None | 503 fail-closed |

Comparisons:

1. **Random Forest vs ANN** — cannot be completed; ANN has no trained artifact. No winner is claimed.
2. **XGBoost vs LSTM** — cannot be completed; LSTM has no trained artifact. The XGBoost holdout and the LSTM chronological test are also different targets/splits, so they would not be directly interchangeable without a shared evaluation set.
3. **Isolation Forest vs Autoencoder** — cannot be completed; Autoencoder has no trained artifact. No winner is claimed.

The three available models are synthetic-data evaluations, not hospital performance. AI remains advisory; deterministic clinical, compatibility and allocation rules remain authoritative.

## G. Quality checks

| Check | Result |
|---|---|
| `bun test` | **160 passed, 0 failed**, 751 assertions, 12 files |
| Ambulance re-matching tests | **9 passed** |
| `python3 -m pytest -q` | **64 passed**, 1 deprecation warning |
| `bunx convex dev --once` | Convex functions ready |
| `bunx tsc -b --noEmit` | Clean |
| `bunx eslint .` | 0 errors, 16 pre-existing warnings |
| `bun run build` | **Success, exit 0** |
| Deep artifact load/inference | **Blocked**; verifier exits 2, no artifacts |
| Manual browser walkthrough | **Blocked**; no browser binary and insufficient disk |

## H. Release archive

`lifelink-connect-2.0-phase5.zip` — created after the final checks, integrity-tested with `unzip -t`, excludes virtual environments, caches, secrets and the previous archives. It includes the Colab notebook, verifier, Phase 5 report and existing classical artifacts; it does **not** include deep `.keras` artifacts because none exist. The Phase 4 archive is retained.

## Remaining acceptance gaps

1. ANN, LSTM and Autoencoder are not trained or integrated with real artifacts.
2. Deep-model comparisons cannot be produced.
3. The manual browser walkthrough, GPS simulations, animation and responsive checks remain unperformed.
4. The release can be built from source, but a “production-ready six-model” claim is not supportable until the Colab package is generated, verified, extracted and re-tested here.

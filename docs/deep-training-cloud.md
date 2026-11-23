# Deep-model training in a capable external environment

The development workspace has **1 CPU, 1.9 GiB RAM and ~44 MB free disk**.
TensorFlow/Keras is not installed, and the TensorFlow wheel cannot be installed
without freeing substantially more disk. No deep model was trained here.

Use this guide in Google Colab, Kaggle, a cloud VM or a GPU workstation. The
reproducible notebook is
[`ml_service/notebooks/LifeLink_Deep_Training_Colab.ipynb`](../ml_service/notebooks/LifeLink_Deep_Training_Colab.ipynb).
Do not copy real patient/donor identifiers into the notebook or upload a `.env`
file.

## 1. Choose an environment

| Resource | Minimum | Recommended |
| --- | --- | --- |
| Python | 3.10–3.12 | 3.11 |
| RAM | 4 GiB | 8–16 GiB |
| Disk | 5 GiB free | 20 GiB |
| GPU | Not required | Optional for CNN/research only |

TensorFlow CPU is enough for the current small synthetic datasets.

## 2. Install

```bash
git clone <your-repository-url> lifelink
cd lifelink/ml_service
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install --upgrade pip
pip install -r requirements.txt -r requirements-deep.txt -r requirements-storage.txt
python -c "import tensorflow as tf; print(tf.__version__)"
```

`requirements-deep.txt` is intentionally separate from the inference image.

## 3. Audit and train

```bash
python scripts/audit_datasets.py
python scripts/train_all.py            # existing XGBoost/RF/Isolation Forest
python scripts/train_ann.py
python scripts/train_lstm.py
python scripts/train_autoencoder.py
python scripts/train_all_deep.py       # or run each individually
python scripts/evaluate_all.py
python scripts/render_evaluation_plots.py
```

The scripts use deterministic synthetic development data and save:

```text
artifacts/deep/ann-donor-<timestamp>.keras
artifacts/deep/ann-donor-<timestamp>.scaler.joblib
artifacts/deep/ann-donor-<timestamp>.history.json
artifacts/deep/ann-donor-<timestamp>.metadata.json
artifacts/deep/lstm-demand-<timestamp>.keras
artifacts/deep/autoencoder-inventory-<timestamp>.keras
```

Training refuses to run if TensorFlow is unavailable. It never writes fake
metrics. All metadata records the dataset label, provenance, synthetic flag,
split method, feature names, environment, TensorFlow/Keras version, actual
device (CPU/GPU), duration, hyperparameters and metrics. The LSTM splits each
series chronologically before concatenation; the Autoencoder chooses its
threshold on held-out normal validation data and scores a separate test set.

After training, verify, checksum and package in the same environment:

```bash
python scripts/verify_deep_artifacts.py --package /content/lifelink-deep-artifacts.zip
```

This loads every `.keras` model and scaler, runs a deterministic inference,
validates metadata and writes `artifacts/deep/deep-artifacts-manifest.json` with
SHA-256 hashes. It exits 2 if anything is missing or unloadable. A downloaded
file alone is not integration.

## 4. Upload artifacts and metadata

Set the storage variables in the external environment:

```bash
export AI_S3_BUCKET=lifelink-ai-production
export AI_S3_REGION=ap-south-1
export AI_STORAGE_CAPACITY_GB=500
```

Then:

```bash
python scripts/ai_storage_cli.py upload-model \
  --kind lstm_demand --version <timestamp> \
  --dataset-key demand --dataset-version <version> \
  --metrics artifacts/deep/<metadata>.json \
  artifacts/deep/<model>.keras
```

Do the same for the scaler as the preprocessing artifact and the evaluation JSON.
Upload datasets with `upload-dataset` and `--stage`.

## 5. Register and approve

Object storage alone does **not** deploy a model. An administrator must:

1. Register the dataset/version in Convex.
2. Register the model artifact as `candidate`.
3. Review metrics, dataset label and synthetic warning.
4. Approve it; the previous active version is marked `rolled_back`.
5. Verify `/ai/models` and a prediction smoke test.
6. Keep the previous artifact available for rollback.

Never automatically replace a production model after training completes.

## 6. Required evidence before claiming success

- TensorFlow version and environment.
- Actual command output and exit code.
- Training duration and resource use.
- Training/validation/test sizes.
- Metrics from the untouched test split.
- Artifact SHA-256 and object key.
- Dataset version and synthetic flag.
- FastAPI `/ai/models/{name}/status` and prediction response.
- Confirmation that the model is advisory and not used for eligibility.

## 7. Current blocked result

In this workspace (verified 2026-11-23):

- `train_all_deep.py` exits 2 with “TensorFlow is not installed … No model
  artifacts or metrics were produced.”
- No `.keras` files or deep metrics exist.
- `evaluate_all.py` exits 2 and reports ANN, LSTM and Autoencoder missing.
- `scripts/verify_deep_artifacts.py` exits 2 with the same three models missing.
- `/ai/models` reports them not trained; `/ai/ann/predict`, `/ai/lstm/predict`
  and `/ai/autoencoder/detect` return 503 rather than a fabricated result.
- Playwright browser verification is also blocked: the browser cache is empty
  and ~44 MB free disk is insufficient for the Chromium download.

Run the Colab notebook, verify the package, extract it into
`ml_service/artifacts/deep/`, then rerun `verify_deep_artifacts.py`, the FastAPI
tests and `/ai/models`. Only then can the deep models be considered integrated.

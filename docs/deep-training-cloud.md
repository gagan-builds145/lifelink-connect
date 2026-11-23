# Deep-model training in a capable external environment

The development workspace has **1 CPU, 1.9 GiB RAM and ~115 MB free disk**.
TensorFlow/Keras is not installed, and the TensorFlow wheel cannot be installed
without freeing substantially more disk. No deep model was trained here.

Use this guide in Google Colab, Kaggle, a cloud VM or a GPU workstation. Do not
copy real patient/donor identifiers into the notebook.

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
artifacts/deep/ann-donor-<timestamp>.metadata.json
artifacts/deep/lstm-demand-<timestamp>.keras
artifacts/deep/autoencoder-inventory-<timestamp>.keras
```

Training refuses to run if TensorFlow is unavailable. It never writes fake
metrics. All metadata records the dataset label, synthetic flag, split method,
hyperparameters and metrics.

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

In this workspace:

- `train_ann.py`, `train_lstm.py`, `train_autoencoder.py` and
  `train_all_deep.py` all exit with code 2 and report TensorFlow missing.
- No `.keras` files or deep metrics exist.
- `evaluate_all.py` exits 2 and reports the missing artifacts.
- The `/ai` endpoints report those models as not trained.

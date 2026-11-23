# AI data storage, model management and capacity

## Architecture

```text
Training / evaluation jobs                Inference service
  datasets -> Parquet                     approved artifact only
  checkpoints -> .keras                   FastAPI loads approved version
        |                                        |
        +---------- S3-compatible bucket --------+
                    (SSE, versioning, lifecycle)
                              |
                    Convex AI metadata
        datasets, versions, checksums, lineages, model refs,
        training runs, storage snapshots, prediction summaries
```

- **Convex** stores application records, AI metadata, object keys, checksums,
  model versions, dataset versions, training-run status, prediction summaries
  and storage snapshots. It never stores bulk payloads or PHI.
- **S3-compatible object storage** stores datasets, training files, `.keras` and
  Joblib artifacts, checkpoints, evaluation reports, logs and backups.
- **Parquet** is the preferred format for large structured datasets.
- **`.keras`** is required for ANN, LSTM, Autoencoder and CNN artifacts.
- The local-directory backend is for automated tests only and is labelled
  `local-dev` everywhere. It is not a production storage claim.

## Capacity planning

| Stage | Plan |
| --- | --- |
| Initial | 500 GB finite AI object-storage allocation |
| 10-million-user target | 5 TB (5,120 GB) allocation, based on measured usage |
| Expansion trigger | 80% used by default, or projected 90-day usage above headroom |
| Enforcement | `AI_STORAGE_CAPACITY_GB` is required and must be positive; no code path assumes unlimited storage |

Capacity is driven by dataset and artifact growth, not registered users. The
`storage_load_test.py` report includes used bytes, capacity, percentage and a
`needs_expansion` flag. Every snapshot is stored in Convex and shown to admins.

Initial capacity is binary (500 GiB = 536,870,912,000 bytes); the provider quota
must be purchased explicitly.

## Bucket layout

```text
lifelink-ai/
  datasets/{raw|cleaned|processed|training|validation|testing}/{dataset}/{version}/
    *.parquet
    manifest.json
  models/{kind}/{version}/artifact.keras
  models/{kind}/{version}/preprocessing.joblib
  evaluations/{kind}/{version}.json
  checkpoints/{run}/epoch-0001.keras
  training-logs/{run}.jsonl
  backups/{UTC timestamp}/{prefix}/
```

Supported model kinds: `xgboost_demand`, `random_forest_donor`,
`isolation_forest`, `ann_donor`, `lstm_demand`, `autoencoder_inventory`,
`cnn_research`.

## Dataset lifecycle

1. **Raw** — immutable source extract with no direct identifiers.
2. **Cleaned** — invalid rows removed; schema normalised.
3. **Processed** — features derived and documented.
4. **Training / validation / testing** — deterministic splits recorded in separate
   manifests, each with its own SHA-256 checksum and parent version.

Convex refuses datasets with `containsPhi: true`, duplicate checksums, duplicate
dataset/version pairs, unsafe object keys and missing checksums. Manifests store
the schema, row count, source, synthetic-data flag, retention and lineage.

Retention defaults:

- datasets: 365 days;
- checkpoints: 30 days;
- backups: provider lifecycle rule, not unlimited retention.

`ai_storage_cli.py retention --prefix ... --days ... --apply` lists expired keys
and deletes them only with `--apply`. Backups use a timestamped prefix and can be
restored with `restore --backup-key`. Provider-side bucket versioning and object
lock should be enabled for deletion recovery.

## Security and privacy

- AI datasets must be minimised and anonymised; the backend rejects PHI flags.
- Direct identifier columns (`name`, `email`, `phone`, `address`, `patient_id`,
  `mrn`, `donor_phone`, etc.) are refused by `prepare_dataset.py` unless removed.
- S3 requests use server-side encryption (`AES256` by default; use
  `aws:kms` with a customer-managed key where required).
- TLS is required for the endpoint; credentials belong in the deployment secret
  store, never in the repository.
- IAM should grant only `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`,
  `s3:ListBucket`, `s3:GetBucketLocation` on the AI prefix. Training and
  inference roles must be separate.
- Convex AI queries/mutations are administrator-only.
- Logs contain object keys and run metadata, never donor/patient records.

## Configuration

```text
AI_S3_BUCKET=lifelink-ai-production
AI_S3_REGION=ap-south-1
AI_S3_ENDPOINT_URL=            # blank for AWS
AI_S3_PREFIX=lifelink-ai
AI_S3_SSE=AES256
AI_STORAGE_CAPACITY_GB=500
AI_STORAGE_EXPANSION_PCT=80
AI_DATASET_RETENTION_DAYS=365
AI_CHECKPOINT_RETENTION_DAYS=30
```

Credentials come from the instance role / workload identity. Do not put access
keys in source control or the frontend.

## Model management

1. Training jobs write `.keras`/Joblib artifacts, preprocessing, evaluation JSON
   and logs to staging prefixes.
2. An administrator registers the dataset version and model artifact in Convex.
   TensorFlow artifacts must be `.keras`; an active dataset version is required.
3. The artifact starts as `candidate`; the admin console can approve it.
4. Approval marks one version `active` and rolls back the previous active version
   for that model kind. Both remain in object storage for comparison/rollback.
5. Inference is intended to load only the approved version and verify its SHA-256
   before use.

Training and inference remain separate processes. This repository does not yet
run a TensorFlow inference server, so the object-storage-to-FastAPI promotion
loader is **not implemented or tested**. Existing FastAPI predictions still use
the checked-in artifacts.

## Commands

```bash
cd ml_service
pip install -r requirements-storage.txt

python scripts/prepare_dataset.py data/demand_history.csv \
  --dataset-id demand --version v1 --stage raw \
  --output data/processed/demand-v1.parquet --synthetic

python scripts/ai_storage_cli.py usage --json-out artifacts/storage-usage.json
python scripts/ai_storage_cli.py upload-dataset --stage training \
  --dataset-id demand --version v1 --source synthetic-generator --synthetic \
  --rows 8760 data/processed/demand-v1-training.parquet
python scripts/ai_storage_cli.py upload-model --kind lstm_demand \
  --version 2026.11.1 --dataset-key demand --dataset-version v1 \
  --metrics artifacts/metrics.json artifacts/lstm.keras
python scripts/ai_storage_cli.py backup datasets/training/
python scripts/ai_storage_cli.py retention --prefix datasets/raw/ --days 365
python scripts/storage_load_test.py --objects 16 --size-kb 256 --concurrency 4
```

## Measured results

Run on 2026-11-23 with the **local-dev filesystem backend**:

| Test | Actual result |
| --- | --- |
| Objects uploaded | 16 × 256 KiB = 4 MiB |
| Concurrency | 4 upload/reload workers |
| Total elapsed | 0.021 s |
| Upload p95 | < 1 ms (timer resolution) |
| Listing 16 objects | 0.001 s |
| Backup + restore size verification | 0.003 s |
| Capacity snapshot | 500 GB capacity, 4.25 MB used, not expanding |

These are bounded local smoke-test numbers. They are **not** evidence that the
service supports 1 million or 10 million users. No S3 endpoint, network
throughput, throttling, multi-region latency, concurrent TensorFlow training, or
real million-user traffic was tested.

## Remaining limitations

- No S3 credentials were available; S3 integration is implemented but unexecuted.
- `boto3` and `pyarrow` are not installed in this workspace; Parquet conversion
  was not executed. The scripts fail clearly instead of fabricating output.
- TensorFlow is unavailable, so deep models were not trained and `.keras` loading
  was not tested.
- The Convex registry is populated by admin mutations; automatic registration
  from the Python CLI is not wired.
- Backup/restore was verified on the local backend only; provider lifecycle,
  cross-region replication and disaster-recovery drills remain to be tested.
- Million- and ten-million-user capacity claims remain unproven.

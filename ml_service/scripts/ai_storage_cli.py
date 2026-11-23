"""Operate LifeLink AI datasets, artifacts, backups and retention.

Examples:
    python scripts/ai_storage_cli.py usage
    python scripts/ai_storage_cli.py upload-dataset --stage training \
        --dataset-id demand --version v1 --source synthetic-generator \
        --synthetic --rows 8760 data/demand.parquet
    python scripts/ai_storage_cli.py upload-model --kind lstm_demand \
        --version 2026.11.1 --dataset-key demand --dataset-version v1 \
        --metrics metrics.json artifacts/lstm.keras
    python scripts/ai_storage_cli.py retention --prefix datasets/raw/ \
        --days 365 --apply

Production requires an S3-compatible bucket and boto3. Without a bucket this
falls back to the local development directory and clearly labels the result.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.ai_storage import (  # noqa: E402
    DATASET_STAGES,
    MODEL_KINDS,
    StorageConfig,
    backup_key,
    capacity_plan,
    dataset_key,
    dataset_manifest,
    evaluation_key,
    expired_objects,
    make_store,
    model_key,
    preprocessing_key,
    training_log_key,
    usage_report,
    write_usage_report,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--capacity-gb", type=int, help="Explicit finite capacity for this run.")
    sub = parser.add_subparsers(dest="command", required=True)

    usage = sub.add_parser("usage", help="Measure object count, bytes and expansion need.")
    usage.add_argument("--json-out", type=Path, default=Path("storage-usage.json"))

    upload_dataset = sub.add_parser("upload-dataset", help="Upload a staged dataset and manifest.")
    upload_dataset.add_argument("file", type=Path)
    upload_dataset.add_argument("--stage", choices=DATASET_STAGES, required=True)
    upload_dataset.add_argument("--dataset-id", required=True)
    upload_dataset.add_argument("--version", required=True)
    upload_dataset.add_argument("--source", required=True)
    upload_dataset.add_argument("--rows", type=int, default=0)
    upload_dataset.add_argument("--synthetic", action="store_true")
    upload_dataset.add_argument("--schema-json", default="{}")
    upload_dataset.add_argument("--lineage")

    upload_model = sub.add_parser("upload-model", help="Upload an approved .keras/joblib artifact.")
    upload_model.add_argument("file", type=Path)
    upload_model.add_argument("--kind", choices=MODEL_KINDS, required=True)
    upload_model.add_argument("--version", required=True)
    upload_model.add_argument("--dataset-key", required=True)
    upload_model.add_argument("--dataset-version", required=True)
    upload_model.add_argument("--metrics", type=Path, required=True)
    upload_model.add_argument("--preprocessing", type=Path)
    upload_model.add_argument("--evaluation", type=Path)
    upload_model.add_argument("--training-config", type=Path)
    upload_model.add_argument("--logs", type=Path)

    download = sub.add_parser("download", help="Download one object.")
    download.add_argument("key")
    download.add_argument("destination", type=Path)

    backup = sub.add_parser("backup", help="Copy a prefix into a timestamped backup.")
    backup.add_argument("prefix")

    restore = sub.add_parser("restore", help="Restore one object from a backup key.")
    restore.add_argument("backup_key")
    restore.add_argument("destination", type=Path)

    retention = sub.add_parser("retention", help="List or delete expired dataset objects.")
    retention.add_argument("--prefix", required=True)
    retention.add_argument("--days", type=int)
    retention.add_argument("--apply", action="store_true")
    retention.add_argument("--json-out", type=Path, default=Path("retention-report.json"))

    sub.add_parser("plan", help="Print the finite capacity plan.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    config = StorageConfig.from_env()
    if args.capacity_gb:
        if args.capacity_gb < 1:
            raise SystemExit("--capacity-gb must be positive.")
        config = StorageConfig(
            **{**config.__dict__, "capacity_bytes": args.capacity_gb * 1024**3}
        )
    store = make_store(config)

    if args.command == "plan":
        print(json.dumps(capacity_plan(int(config.capacity_gb)), indent=2))
        return 0

    if args.command == "usage":
        report = usage_report(
            store,
            capacity_bytes=config.capacity_bytes,
            threshold_pct=config.expansion_threshold_pct,
        )
        write_usage_report(report, args.json_out)
        print(json.dumps(report.as_dict(), indent=2))
        if report.provider == "local-dev":
            print("WARNING: local-dev backend. This is not cloud capacity evidence.")
        return 0

    if args.command == "upload-dataset":
        if not args.file.exists():
            raise SystemExit(f"File not found: {args.file}")
        schema = json.loads(args.schema_json)
        if not isinstance(schema, dict):
            raise SystemExit("--schema-json must be an object.")
        manifest = dataset_manifest(
            dataset_id=args.dataset_id,
            version=args.version,
            stage=args.stage,
            source=args.source,
            synthetic=args.synthetic,
            row_count=args.rows,
            local_path=args.file,
            schema=schema,
        )
        if args.lineage:
            manifest["lineage"] = args.lineage
        key = manifest["object_key"]
        info = store.put_file(args.file, key)
        manifest_path = args.file.with_name(f"{args.file.stem}.manifest.json")
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        store.put_file(manifest_path, key.rsplit("/", 1)[0] + "/manifest.json", "application/json")
        print(json.dumps({**manifest, "uploaded_bytes": info.size_bytes}, indent=2))
        return 0

    if args.command == "upload-model":
        if not args.file.exists():
            raise SystemExit(f"File not found: {args.file}")
        if args.kind in {"ann_donor", "lstm_demand", "autoencoder_inventory", "cnn_research"}:
            if args.file.suffix != ".keras":
                raise SystemExit("TensorFlow/Keras artifacts must use .keras.")
        metrics = json.loads(args.metrics.read_text(encoding="utf-8"))
        key = model_key(args.kind, args.version, args.file.suffix)
        info = store.put_file(args.file, key)
        if args.preprocessing:
            store.put_file(args.preprocessing, preprocessing_key(args.kind, args.version))
        if args.evaluation:
            store.put_file(args.evaluation, evaluation_key(args.kind, args.version))
        if args.logs:
            store.put_file(args.logs, training_log_key(args.version))
        config_payload = {
            "dataset_key": args.dataset_key,
            "dataset_version": args.dataset_version,
            "metrics": metrics,
            "uploaded_at": datetime.now(timezone.utc).isoformat(),
        }
        if args.training_config:
            config_payload["training_config"] = json.loads(
                args.training_config.read_text(encoding="utf-8")
            )
        print(json.dumps({**config_payload, "artifact_key": key, "bytes": info.size_bytes}, indent=2))
        return 0

    if args.command == "download":
        path = store.get_file(args.key, args.destination)
        print(str(path))
        return 0

    if args.command == "backup":
        objects = store.list_objects(args.prefix)
        if not objects:
            raise SystemExit("No objects found for that prefix.")
        stamp = backup_key(args.prefix, datetime.now(timezone.utc))
        for item in objects:
            target = f"{stamp}/{item.key[len(args.prefix):].lstrip('/')}"
            store.copy(item.key, target)
        print(
            json.dumps(
                {
                    "provider": store.provider,
                    "source_prefix": args.prefix,
                    "backup_prefix": stamp,
                    "objects": len(objects),
                    "bytes": sum(item.size_bytes for item in objects),
                },
                indent=2,
            )
        )
        return 0

    if args.command == "restore":
        path = store.get_file(args.backup_key, args.destination)
        print(str(path))
        return 0

    if args.command == "retention":
        days = args.days if args.days is not None else config.dataset_retention_days
        objects = store.list_objects(args.prefix)
        expired = expired_objects(objects, args.prefix, datetime.now(timezone.utc), days)
        payload = {
            "provider": store.provider,
            "prefix": args.prefix,
            "retention_days": days,
            "expired_objects": len(expired),
            "expired_bytes": sum(item.size_bytes for item in expired),
            "applied": bool(args.apply),
            "keys": [item.key for item in expired],
        }
        if args.apply:
            for item in expired:
                store.delete(item.key)
        args.json_out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(payload, indent=2))
        return 0

    return 1


if __name__ == "__main__":
    raise SystemExit(main())

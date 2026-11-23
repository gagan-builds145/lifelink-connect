"""Prepare anonymised AI datasets as Parquet with deterministic splits.

Requires pyarrow (requirements-storage.txt). The script refuses obvious direct
identifiers, drops them explicitly where configured, and records stage/version
metadata. It does not upload data; use ai_storage_cli.py afterwards.

Example:
    python scripts/prepare_dataset.py data/demand_history.csv \
        --dataset-id demand --version v1 --stage raw \
        --output data/processed/demand-v1.parquet
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import random
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.ai_storage import dataset_manifest  # noqa: E402

PHI_COLUMNS = {
    "name",
    "first_name",
    "last_name",
    "email",
    "phone",
    "mobile",
    "address",
    "date_of_birth",
    "dob",
    "patient_name",
    "patient_id",
    "mrn",
    "donor_name",
    "donor_email",
    "donor_phone",
    "ssn",
    "national_id",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("--dataset-id", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--stage", default="raw")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--allowlist", help="Comma-separated columns to keep.")
    parser.add_argument("--drop", default="", help="Comma-separated columns to drop.")
    parser.add_argument("--synthetic", action="store_true")
    parser.add_argument("--train", type=float, default=0.7)
    parser.add_argument("--validation", type=float, default=0.15)
    parser.add_argument("--seed", type=int, default=7)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if abs(args.train + args.validation) >= 1:
        raise SystemExit("train + validation must be below 1.0; the rest is testing.")
    if args.train <= 0 or args.validation < 0:
        raise SystemExit("Split fractions are invalid.")
    try:
        import pyarrow as pa  # type: ignore
        import pyarrow.parquet as pq  # type: ignore
    except ImportError:
        raise SystemExit(
            "pyarrow is required. Install requirements-storage.txt in a capable environment."
        )

    with args.source.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        rows = list(reader)
        columns = list(reader.fieldnames or [])
    if not rows or not columns:
        raise SystemExit("Source CSV is empty.")

    allow = {item.strip() for item in args.allowlist.split(",") if item.strip()} if args.allowlist else set(columns)
    drop = {item.strip() for item in args.drop.split(",") if item.strip()}
    forbidden = (allow & PHI_COLUMNS) - drop
    if forbidden:
        raise SystemExit(f"Refusing direct identifiers: {sorted(forbidden)}")
    selected = [column for column in columns if column in allow and column not in drop]
    if not selected:
        raise SystemExit("No columns selected.")

    rng = random.Random(args.seed)
    rng.shuffle(rows)
    train_end = int(len(rows) * args.train)
    validation_end = train_end + int(len(rows) * args.validation)
    splits = {
        "training": rows[:train_end],
        "validation": rows[train_end:validation_end],
        "testing": rows[validation_end:],
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    outputs: dict[str, str] = {}
    manifests = []
    for stage, split_rows in splits.items():
        if not split_rows:
            continue
        destination = args.output.with_name(f"{args.output.stem}-{stage}.parquet")
        table = pa.Table.from_pylist(
            [{column: row.get(column) for column in selected} for row in split_rows]
        )
        pq.write_table(table, destination, compression="zstd")
        outputs[stage] = str(destination)
        manifest = dataset_manifest(
            dataset_id=args.dataset_id,
            version=f"{args.version}.{stage}",
            stage=stage,
            source=str(args.source),
            synthetic=args.synthetic,
            row_count=len(split_rows),
            local_path=destination,
            schema={column: str(table.schema.field(column).type) for column in selected},
        )
        manifest["parent_version"] = args.version
        manifests.append(manifest)

    report = {
        "dataset_id": args.dataset_id,
        "version": args.version,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_sha256": hashlib.sha256(args.source.read_bytes()).hexdigest(),
        "columns": selected,
        "splits": outputs,
        "manifests": manifests,
        "note": "Manifests record checksums and stage lineage; no PHI columns are permitted.",
    }
    report_path = args.output.with_suffix(".manifest.json")
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

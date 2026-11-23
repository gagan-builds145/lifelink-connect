"""Bounded storage scalability test.

This exercises the configured object store with small synthetic objects. It is a
regression/capacity smoke test, not proof that LifeLink supports one million or
ten million users. Results must name the backend, object sizes, concurrency and
duration.

Run:
    python scripts/storage_load_test.py --objects 16 --size-kb 256 --concurrency 4
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.ai_storage import (  # noqa: E402
    StorageConfig,
    dataset_key,
    make_store,
    usage_report,
)


def percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round((pct / 100) * (len(ordered) - 1))))
    return round(ordered[index], 2)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--objects", type=int, default=16)
    parser.add_argument("--size-kb", type=int, default=256)
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument("--output", type=Path, default=Path("artifacts/storage-load-report.json"))
    parser.add_argument("--cleanup", action="store_true")
    args = parser.parse_args()
    if min(args.objects, args.size_kb, args.concurrency) < 1:
        raise SystemExit("Objects, size and concurrency must be positive.")
    if args.objects > 200 or args.size_kb > 4096:
        raise SystemExit("Bounded test limit: 200 objects and 4 MB each.")

    config = StorageConfig.from_env()
    store = make_store(config)
    started = time.perf_counter()
    upload_latencies: list[float] = []
    download_latencies: list[float] = []
    keys: list[str] = []

    with tempfile.TemporaryDirectory() as raw:
        root = Path(raw)
        payload = root / "payload.parquet"
        payload.write_bytes(os.urandom(args.size_kb * 1024))

        def upload(index: int) -> tuple[str, float]:
            key = dataset_key(
                "training",
                "load-test",
                f"v-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}",
                f"part-{index:04d}.parquet",
            )
            start = time.perf_counter()
            store.put_file(payload, key, "application/octet-stream")
            return key, time.perf_counter() - start

        with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
            for key, elapsed in pool.map(upload, range(args.objects)):
                keys.append(key)
                upload_latencies.append(elapsed)

        def download(item: tuple[int, str]) -> float:
            index, key = item
            destination = root / f"down-{index:04d}.parquet"
            start = time.perf_counter()
            store.get_file(key, destination)
            elapsed = time.perf_counter() - start
            if destination.stat().st_size != args.size_kb * 1024:
                raise RuntimeError("Restored object size did not match.")
            return elapsed

        with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
            download_latencies = list(pool.map(download, enumerate(keys)))

        list_start = time.perf_counter()
        listed = store.list_objects("datasets/training/load-test")
        list_seconds = time.perf_counter() - list_start

        backup_start = time.perf_counter()
        backup_prefix = f"backups/load-test-{int(time.time())}/sample.parquet"
        store.copy(keys[0], backup_prefix)
        restored = root / "restored.parquet"
        store.get_file(backup_prefix, restored)
        backup_seconds = time.perf_counter() - backup_start
        if restored.stat().st_size != args.size_kb * 1024:
            raise RuntimeError("Backup restoration size did not match.")

        report = usage_report(store, config.capacity_bytes, config.expansion_threshold_pct)
        total_seconds = time.perf_counter() - started
        result = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "scope": (
                "Bounded storage smoke test. NOT a 1M/10M-user load test, and not "
                "evidence of production capacity."
            ),
            "backend": store.provider,
            "warning": (
                "local-dev is a filesystem test backend, not cloud object storage."
                if store.provider == "local-dev"
                else "S3-compatible backend; results reflect only this bounded run."
            ),
            "parameters": {
                "objects": args.objects,
                "object_size_kb": args.size_kb,
                "concurrency": args.concurrency,
                "capacity_gb": config.capacity_gb,
            },
            "results": {
                "total_seconds": round(total_seconds, 3),
                "bytes_written": args.objects * args.size_kb * 1024,
                "upload_p50_ms": percentile(upload_latencies, 50) * 1000,
                "upload_p95_ms": percentile(upload_latencies, 95) * 1000,
                "download_p50_ms": percentile(download_latencies, 50) * 1000,
                "download_p95_ms": percentile(download_latencies, 95) * 1000,
                "list_seconds": round(list_seconds, 3),
                "listed_objects": len(listed),
                "backup_restore_seconds": round(backup_seconds, 3),
                "mean_upload_ms": round(statistics.fmean(upload_latencies) * 1000, 2),
            },
            "usage": report.as_dict(),
            "limitations": [
                "No million-user or ten-million-user concurrency was simulated.",
                "No network, S3 throttling, lifecycle-policy or multi-region latency was exercised.",
                "No TensorFlow model was loaded because TensorFlow is unavailable.",
                "No real patient/donor data was used.",
            ],
        }
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(result, indent=2))

        if args.cleanup:
            for key in keys + [backup_prefix]:
                store.delete(key)

        # Keep the report, remove multi-megabyte local test payloads unless requested.
        if store.provider == "local-dev" and not args.cleanup:
            print("Local test objects retained; pass --cleanup to remove them.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

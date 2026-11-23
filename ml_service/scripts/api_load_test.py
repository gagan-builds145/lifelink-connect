"""Bounded in-process concurrent prediction test.

This measures model prediction and FastAPI validation overhead without network
or database access. It is not a production capacity test.
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.features import synthetic_demand_records  # noqa: E402
from app.main import app  # noqa: E402


def percentile(values: list[float], pct: float) -> float:
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round((pct / 100) * (len(ordered) - 1))))
    return round(ordered[index], 2)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--requests", type=int, default=40)
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument("--output", type=Path, default=Path("artifacts/api-load-report.json"))
    args = parser.parse_args()
    if min(args.requests, args.concurrency) < 1:
        raise SystemExit("Requests and concurrency must be positive.")
    if args.requests > 500 or args.concurrency > 32:
        raise SystemExit("Bounded test limit: 500 requests and 32 workers.")

    records = [
        record
        for record in synthetic_demand_records()
        if record.blood_group == "O+" and record.component == "red_cells"
    ][-70:]
    payload = {
        "blood_group": "O+",
        "component": "red_cells",
        "points": [{"date": record.date, "units": record.units} for record in records],
        "horizon_days": 7,
    }
    client = TestClient(app)
    for _ in range(3):
        assert client.post("/ai/demand/predict", json=payload).status_code == 200

    def request_once(_: int) -> tuple[float, int, int]:
        start = time.perf_counter()
        response = client.post("/ai/demand/predict", json=payload)
        elapsed = (time.perf_counter() - start) * 1000
        return elapsed, response.status_code, len(response.content)

    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        results = list(pool.map(request_once, range(args.requests)))
    total = time.perf_counter() - started
    latencies = [item[0] for item in results]
    errors = sum(1 for item in results if item[1] != 200)
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "scope": (
            "Bounded in-process FastAPI/model test. No network, Convex, S3, "
            "multi-region latency or million-user concurrency."
        ),
        "parameters": {
            "requests": args.requests,
            "concurrency": args.concurrency,
            "endpoint": "/ai/demand/predict",
        },
        "results": {
            "total_seconds": round(total, 3),
            "throughput_requests_per_second": round(args.requests / total, 2),
            "errors": errors,
            "p50_ms": round(statistics.median(latencies), 2),
            "p95_ms": percentile(latencies, 95),
            "max_ms": round(max(latencies), 2),
            "mean_response_bytes": round(statistics.fmean(item[2] for item in results)),
        },
        "limitations": [
            "Runs in the same Python process as the model; no ASGI server/network overhead.",
            "One model endpoint only; no database or object-store calls.",
            "1 CPU, 1.9 GiB RAM test host.",
            "No evidence of 1M or 10M supported users.",
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())

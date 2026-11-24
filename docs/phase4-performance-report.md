# Phase 4 performance and reliability report

Date: 2026-11-24
Host: 1 vCPU, 1.9 GiB RAM, Python 3.10.12, local in-process FastAPI test client.

## FastAPI inference — measured

Command:

```bash
cd ml_service
python3 scripts/api_load_test.py --requests 100 --concurrency 8
```

Endpoint: `POST /ai/demand/predict` (XGBoost demand model).
Report: `ml_service/artifacts/api-load-report.json`.

| Metric | Result |
| --- | --- |
| Requests | 100 |
| Concurrency | 8 |
| Errors | 0 |
| Total time | 0.688 s |
| Throughput | **145.31 requests/s** |
| p50 latency | **53.66 ms** |
| p95 latency | **66.99 ms** |
| Max latency | **79.69 ms** |
| Mean response size | 876 bytes |

This measures validation + model prediction inside the same Python process. It
does **not** include network, ASGI server, Convex, object storage, multi-region
latency or realistic user think time.

## Rate-limit bottleneck — measured

A 120-request/8-worker run hit the configured ML limit
(`ML_RATE_LIMIT_PER_MINUTE=120`) and returned **3 × HTTP 429**. The limiter is
working as designed; it was not raised to make the load test look clean. The
100-request run fits the per-minute budget and returned zero errors.

If higher throughput is required, configure a shared limiter and raise the
per-instance budget deliberately, then rerun under a real network load test.

## Convex and end-to-end load — NOT EXECUTED

No authenticated production session/deployment was available, so the following
were **not** load-tested:

- concurrent authenticated users;
- concurrent blood requests;
- donor matching/allocation query load;
- ambulance booking/provider matching;
- real-time notification subscriptions;
- Guardian document workflows;
- large datasets and pagination;
- Convex query/mutation network performance.

The automated Convex tests prove correctness of atomic reservation, idempotency
and authorization under simulated concurrency, but they are **not** a capacity
benchmark. No million-user or ten-million-user claim is made.

## Storage smoke test (prior measurement, local only)

`ml_service/artifacts/storage-load-report.json` records 16 × 256 KB objects at
concurrency 4: 4 MiB written, sub-millisecond local filesystem uploads/downloads,
16 listed objects, 0.003 s backup/restore. It uses the `local-dev` filesystem
backend, not cloud object storage, and is not production capacity evidence.

## Identified limits

1. In-process ML limiter is per worker; multiple workers/replicas need a shared
   limiter at the edge or in Redis.
2. The measured model is a lightweight XGBoost artifact. Deep models are not
   trained, so their latency is unavailable.
3. No Convex network/load measurements exist for this release.
4. No sustained soak, memory-leak or failover test was performed.

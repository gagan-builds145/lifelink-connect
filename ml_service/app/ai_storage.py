"""AI object-storage layer for datasets, model artifacts and training logs.

Production uses an S3-compatible bucket. A local-directory backend exists for
development and automated tests only; it must not be presented as a cloud
deployment. Capacity is always explicit and finite; this module never assumes
unlimited storage.

Environment:
    AI_S3_BUCKET
    AI_S3_REGION
    AI_S3_ENDPOINT_URL            Optional for AWS, required for compatible stores.
    AI_S3_ACCESS_KEY_ID
    AI_S3_SECRET_ACCESS_KEY
    AI_S3_PREFIX                  Default: lifelink-ai
    AI_S3_SSE                     Default: AES256; empty disables explicit SSE.
    AI_STORAGE_CAPACITY_GB        Default: 500 (initial plan). 5120 at 10M users.
    AI_STORAGE_EXPANSION_PCT      Default: 80.
    AI_LOCAL_STORAGE_DIR          Development/test fallback directory.
    AI_DATASET_RETENTION_DAYS     Default: 365.
    AI_CHECKPOINT_RETENTION_DAYS  Default: 30.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable, Protocol

GIB = 1024**3
DEFAULT_CAPACITY_GB = 500
TARGET_CAPACITY_GB_10M = 5120
DATASET_STAGES = (
    "raw",
    "cleaned",
    "processed",
    "training",
    "validation",
    "testing",
)
MODEL_KINDS = (
    "xgboost_demand",
    "random_forest_donor",
    "isolation_forest",
    "ann_donor",
    "lstm_demand",
    "autoencoder_inventory",
    "cnn_research",
)
ARTIFACT_FORMATS = (".keras", ".joblib", ".json", ".onnx", ".safetensors")


class StorageConfigurationError(RuntimeError):
    pass


class StorageDependencyError(RuntimeError):
    pass


def _env_int(name: str, default: int, minimum: int = 1) -> int:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        value = int(raw)
    except ValueError as error:
        raise StorageConfigurationError(f"{name} must be an integer.") from error
    if value < minimum:
        raise StorageConfigurationError(f"{name} must be at least {minimum}.")
    return value


@dataclass(frozen=True)
class StorageConfig:
    bucket: str | None
    region: str
    endpoint_url: str | None
    prefix: str
    capacity_bytes: int
    expansion_threshold_pct: int
    sse: str | None
    local_dir: Path | None
    dataset_retention_days: int
    checkpoint_retention_days: int

    @property
    def capacity_gb(self) -> float:
        return round(self.capacity_bytes / GIB, 3)

    @property
    def threshold_bytes(self) -> int:
        return int(self.capacity_bytes * self.expansion_threshold_pct / 100)

    @classmethod
    def from_env(cls) -> "StorageConfig":
        capacity_gb = _env_int("AI_STORAGE_CAPACITY_GB", DEFAULT_CAPACITY_GB, 1)
        threshold = _env_int("AI_STORAGE_EXPANSION_PCT", 80, 1)
        if threshold > 100:
            raise StorageConfigurationError("AI_STORAGE_EXPANSION_PCT cannot exceed 100.")
        prefix = (os.environ.get("AI_S3_PREFIX") or "lifelink-ai").strip("/")
        if not prefix:
            raise StorageConfigurationError("AI_S3_PREFIX cannot be empty.")
        local = os.environ.get("AI_LOCAL_STORAGE_DIR")
        return cls(
            bucket=(os.environ.get("AI_S3_BUCKET") or "").strip() or None,
            region=(os.environ.get("AI_S3_REGION") or "us-east-1").strip(),
            endpoint_url=(os.environ.get("AI_S3_ENDPOINT_URL") or "").strip() or None,
            prefix=prefix,
            capacity_bytes=capacity_gb * GIB,
            expansion_threshold_pct=threshold,
            sse=(os.environ.get("AI_S3_SSE", "AES256").strip() or None),
            local_dir=Path(local).expanduser().resolve() if local else None,
            dataset_retention_days=_env_int("AI_DATASET_RETENTION_DAYS", 365, 1),
            checkpoint_retention_days=_env_int("AI_CHECKPOINT_RETENTION_DAYS", 30, 1),
        )


@dataclass(frozen=True)
class ObjectInfo:
    key: str
    size_bytes: int
    last_modified: datetime | None = None


@dataclass(frozen=True)
class UsageReport:
    provider: str
    bucket: str
    capacity_bytes: int
    used_bytes: int
    object_count: int
    expansion_threshold_pct: int
    needs_expansion: bool
    headroom_bytes: int
    by_stage: dict[str, int]

    def as_dict(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "bucket": self.bucket,
            "capacity_bytes": self.capacity_bytes,
            "capacity_gb": round(self.capacity_bytes / GIB, 3),
            "used_bytes": self.used_bytes,
            "used_gb": round(self.used_bytes / GIB, 4),
            "usage_pct": round(self.used_bytes / self.capacity_bytes * 100, 3)
            if self.capacity_bytes
            else None,
            "object_count": self.object_count,
            "expansion_threshold_pct": self.expansion_threshold_pct,
            "needs_expansion": self.needs_expansion,
            "headroom_bytes": self.headroom_bytes,
            "by_stage": self.by_stage,
        }


class ObjectStore(Protocol):
    provider: str

    def put_file(self, local_path: Path, key: str, content_type: str | None = None) -> ObjectInfo: ...
    def get_file(self, key: str, destination: Path) -> Path: ...
    def delete(self, key: str) -> None: ...
    def list_objects(self, prefix: str = "") -> list[ObjectInfo]: ...
    def copy(self, source_key: str, destination_key: str) -> None: ...


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _safe_segment(value: str, label: str) -> str:
    cleaned = value.strip().replace("\\", "/").strip("/")
    if not cleaned or ".." in cleaned.split("/") or any(part == "" for part in cleaned.split("/")):
        raise ValueError(f"Invalid {label}.")
    if len(cleaned) > 180:
        raise ValueError(f"{label} is too long.")
    return cleaned


def dataset_prefix(stage: str, dataset_id: str, version: str) -> str:
    if stage not in DATASET_STAGES:
        raise ValueError(f"Unsupported dataset stage: {stage}")
    return f"datasets/{stage}/{_safe_segment(dataset_id, 'dataset id')}/{_safe_segment(version, 'dataset version')}"


def dataset_key(stage: str, dataset_id: str, version: str, filename: str) -> str:
    name = _safe_segment(filename, "filename")
    if not name.lower().endswith((".parquet", ".csv", ".json")):
        raise ValueError("AI dataset files must be Parquet, CSV or JSON.")
    return f"{dataset_prefix(stage, dataset_id, version)}/{name}"


def model_key(kind: str, version: str, format: str = ".keras") -> str:
    if kind not in MODEL_KINDS:
        raise ValueError(f"Unsupported model kind: {kind}")
    if format not in ARTIFACT_FORMATS:
        raise ValueError(f"Unsupported artifact format: {format}")
    return (
        f"models/{kind}/{_safe_segment(version, 'model version')}/"
        f"artifact{format}"
    )


def preprocessing_key(kind: str, version: str) -> str:
    if kind not in MODEL_KINDS:
        raise ValueError(f"Unsupported model kind: {kind}")
    return f"models/{kind}/{_safe_segment(version, 'model version')}/preprocessing.joblib"


def evaluation_key(kind: str, version: str) -> str:
    return f"evaluations/{kind}/{_safe_segment(version, 'model version')}.json"


def training_log_key(run_id: str) -> str:
    return f"training-logs/{_safe_segment(run_id, 'run id')}.jsonl"


def checkpoint_key(run_id: str, epoch: int, format: str = ".keras") -> str:
    if epoch < 0:
        raise ValueError("Epoch cannot be negative.")
    if format not in ARTIFACT_FORMATS:
        raise ValueError(f"Unsupported checkpoint format: {format}")
    return f"checkpoints/{_safe_segment(run_id, 'run id')}/epoch-{epoch:04d}{format}"


def backup_key(prefix: str, captured_at: datetime) -> str:
    stamp = captured_at.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"backups/{stamp}/{_safe_segment(prefix, 'backup prefix')}"


class LocalObjectStore:
    """Development/test backend. Not a production storage service."""

    provider = "local-dev"

    def __init__(self, root: Path):
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        clean = _safe_segment(key, "object key")
        target = (self.root / clean).resolve()
        if self.root not in target.parents and target != self.root:
            raise ValueError("Object key escapes the storage root.")
        return target

    def put_file(self, local_path: Path, key: str, content_type: str | None = None) -> ObjectInfo:
        target = self._path(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(local_path, target)
        return ObjectInfo(key=key, size_bytes=target.stat().st_size, last_modified=datetime.now(timezone.utc))

    def get_file(self, key: str, destination: Path) -> Path:
        source = self._path(key)
        if not source.exists():
            raise FileNotFoundError(key)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
        return destination

    def delete(self, key: str) -> None:
        path = self._path(key)
        if path.exists():
            path.unlink()

    def list_objects(self, prefix: str = "") -> list[ObjectInfo]:
        base = self.root
        target = self.root / _safe_segment(prefix, "prefix") if prefix else base
        if not target.exists():
            return []
        if target.is_file():
            return [ObjectInfo(prefix, target.stat().st_size, datetime.fromtimestamp(target.stat().st_mtime, timezone.utc))]
        results: list[ObjectInfo] = []
        for path in sorted(target.rglob("*")):
            if path.is_file():
                results.append(
                    ObjectInfo(
                        key=str(path.relative_to(self.root)).replace("\\", "/"),
                        size_bytes=path.stat().st_size,
                        last_modified=datetime.fromtimestamp(path.stat().st_mtime, timezone.utc),
                    )
                )
        return results

    def copy(self, source_key: str, destination_key: str) -> None:
        source = self._path(source_key)
        destination = self._path(destination_key)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)


class S3ObjectStore:
    provider = "s3"

    def __init__(self, config: StorageConfig):
        if not config.bucket:
            raise StorageConfigurationError("AI_S3_BUCKET is required for S3 storage.")
        try:
            import boto3  # type: ignore
        except ImportError as error:  # pragma: no cover - environment dependent
            raise StorageDependencyError(
                "boto3 is not installed. Install ml_service/requirements-storage.txt."
            ) from error
        self.config = config
        self.bucket = config.bucket
        self.client = boto3.client(
            "s3",
            region_name=config.region,
            endpoint_url=config.endpoint_url,
        )

    def _key(self, key: str) -> str:
        return f"{self.config.prefix}/{_safe_segment(key, 'object key')}"

    def _extra(self) -> dict[str, Any]:
        return {"ServerSideEncryption": self.config.sse} if self.config.sse else {}

    def put_file(self, local_path: Path, key: str, content_type: str | None = None) -> ObjectInfo:
        extra = {"ContentType": content_type} if content_type else {}
        extra.update(self._extra())
        kwargs: dict[str, Any] = {"ExtraArgs": extra} if extra else {}
        self.client.upload_file(
            str(local_path),
            self.bucket,
            self._key(key),
            **kwargs,
        )
        return ObjectInfo(key=key, size_bytes=local_path.stat().st_size, last_modified=datetime.now(timezone.utc))

    def get_file(self, key: str, destination: Path) -> Path:
        destination.parent.mkdir(parents=True, exist_ok=True)
        self.client.download_file(self.bucket, self._key(key), str(destination))
        return destination

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=self._key(key))

    def list_objects(self, prefix: str = "") -> list[ObjectInfo]:
        paginator = self.client.get_paginator("list_objects_v2")
        results: list[ObjectInfo] = []
        for page in paginator.paginate(Bucket=self.bucket, Prefix=self._key(prefix) if prefix else self.config.prefix):
            for item in page.get("Contents", []):
                key = item["Key"]
                if key.startswith(f"{self.config.prefix}/"):
                    key = key[len(self.config.prefix) + 1 :]
                results.append(
                    ObjectInfo(
                        key=key,
                        size_bytes=int(item.get("Size", 0)),
                        last_modified=item.get("LastModified"),
                    )
                )
        return results

    def copy(self, source_key: str, destination_key: str) -> None:
        kwargs: dict[str, Any] = {}
        if self.config.sse:
            kwargs["ServerSideEncryption"] = self.config.sse
        self.client.copy_object(
            Bucket=self.bucket,
            CopySource={"Bucket": self.bucket, "Key": self._key(source_key)},
            Key=self._key(destination_key),
            **kwargs,
        )


def make_store(config: StorageConfig | None = None) -> ObjectStore:
    config = config or StorageConfig.from_env()
    if config.bucket:
        return S3ObjectStore(config)
    local = config.local_dir or Path(__file__).resolve().parents[1] / "artifacts" / "local-object-store"
    return LocalObjectStore(local)


def _stage_from_key(key: str) -> str:
    parts = key.split("/")
    if len(parts) >= 2 and parts[0] == "datasets" and parts[1] in DATASET_STAGES:
        return parts[1]
    if key.startswith("models/"):
        return "models"
    if key.startswith("checkpoints/"):
        return "checkpoints"
    if key.startswith("backups/"):
        return "backups"
    if key.startswith("training-logs/"):
        return "training-logs"
    if key.startswith("evaluations/"):
        return "evaluations"
    return "other"


def usage_report(
    store: ObjectStore,
    capacity_bytes: int,
    threshold_pct: int,
    prefix: str = "",
) -> UsageReport:
    if capacity_bytes <= 0:
        raise ValueError("Capacity must be positive.")
    objects = store.list_objects(prefix)
    used = sum(item.size_bytes for item in objects)
    by_stage: dict[str, int] = {}
    for item in objects:
        stage = _stage_from_key(item.key)
        by_stage[stage] = by_stage.get(stage, 0) + item.size_bytes
    return UsageReport(
        provider=store.provider,
        bucket=getattr(store, "bucket", "local-dev"),
        capacity_bytes=capacity_bytes,
        used_bytes=used,
        object_count=len(objects),
        expansion_threshold_pct=threshold_pct,
        needs_expansion=used >= int(capacity_bytes * threshold_pct / 100),
        headroom_bytes=max(0, capacity_bytes - used),
        by_stage=dict(sorted(by_stage.items())),
    )


def expired_objects(
    objects: Iterable[ObjectInfo],
    prefix: str,
    now: datetime,
    retention_days: int,
) -> list[ObjectInfo]:
    if retention_days < 1:
        raise ValueError("Retention must be at least one day.")
    cutoff = now.astimezone(timezone.utc) - timedelta(days=retention_days)
    return [
        item
        for item in objects
        if item.key.startswith(prefix)
        and item.last_modified is not None
        and item.last_modified.astimezone(timezone.utc) < cutoff
    ]


def dataset_manifest(
    *,
    dataset_id: str,
    version: str,
    stage: str,
    source: str,
    synthetic: bool,
    row_count: int,
    local_path: Path,
    schema: dict[str, str],
    contains_phi: bool = False,
) -> dict[str, Any]:
    if stage not in DATASET_STAGES:
        raise ValueError(f"Unsupported dataset stage: {stage}")
    if contains_phi:
        raise ValueError(
            "AI datasets must be minimised/anonymised; contains_phi must be false."
        )
    if row_count < 0:
        raise ValueError("row_count cannot be negative.")
    if not local_path.exists():
        raise FileNotFoundError(local_path)
    return {
        "dataset_id": dataset_id,
        "version": version,
        "stage": stage,
        "source": source,
        "synthetic": synthetic,
        "row_count": row_count,
        "format": local_path.suffix.lower().lstrip("."),
        "size_bytes": local_path.stat().st_size,
        "sha256": sha256_file(local_path),
        "schema": schema,
        "contains_phi": False,
        "object_key": dataset_key(stage, dataset_id, version, local_path.name),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def capacity_plan(capacity_gb: int = DEFAULT_CAPACITY_GB) -> dict[str, Any]:
    return {
        "initial_capacity_gb": capacity_gb,
        "initial_capacity_bytes": capacity_gb * GIB,
        "ten_million_target_gb": TARGET_CAPACITY_GB_10M,
        "ten_million_target_bytes": TARGET_CAPACITY_GB_10M * GIB,
        "note": (
            "Capacity is based on measured dataset/artifact growth, not registered users. "
            "Expand when usage crosses the configured threshold or projected 90-day usage "
            "exceeds remaining headroom."
        ),
    }


def write_usage_report(report: UsageReport, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report.as_dict(), indent=2) + "\n", encoding="utf-8")

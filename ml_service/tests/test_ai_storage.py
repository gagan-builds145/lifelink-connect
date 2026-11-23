from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app.ai_storage import (
    DEFAULT_CAPACITY_GB,
    GIB,
    LocalObjectStore,
    ObjectInfo,
    StorageConfig,
    StorageConfigurationError,
    backup_key,
    capacity_plan,
    checkpoint_key,
    dataset_key,
    dataset_manifest,
    dataset_prefix,
    evaluation_key,
    expired_objects,
    make_store,
    model_key,
    preprocessing_key,
    sha256_file,
    training_log_key,
    usage_report,
    write_usage_report,
)


def config(tmp_path: Path, **overrides) -> StorageConfig:
    values = dict(
        bucket=None,
        region="us-east-1",
        endpoint_url=None,
        prefix="lifelink-ai",
        capacity_bytes=500 * GIB,
        expansion_threshold_pct=80,
        sse="AES256",
        local_dir=tmp_path / "objects",
        dataset_retention_days=365,
        checkpoint_retention_days=30,
    )
    values.update(overrides)
    return StorageConfig(**values)


def test_dataset_keys_are_stage_and_version_scoped():
    key = dataset_key("training", "donor-history", "v3", "rows.parquet")
    assert key == "datasets/training/donor-history/v3/rows.parquet"
    assert dataset_prefix("raw", "inventory", "2026-11-23").startswith("datasets/raw/")
    assert dataset_key("testing", "x", "v1", "x.CSV").endswith(".CSV")


def test_rejects_unknown_stage_and_unsafe_paths():
    with pytest.raises(ValueError):
        dataset_key("production", "x", "v1", "rows.parquet")
    with pytest.raises(ValueError):
        dataset_key("../raw", "x", "v1", "rows.parquet")
    with pytest.raises(ValueError):
        dataset_key("raw", "x", "v1", "payload.exe")
    with pytest.raises(ValueError):
        model_key("unknown", "v1")


def test_model_and_checkpoint_keys_use_keras_and_versions():
    assert model_key("lstm_demand", "2026.11.1") == "models/lstm_demand/2026.11.1/artifact.keras"
    assert checkpoint_key("run-7", 3) == "checkpoints/run-7/epoch-0003.keras"
    assert preprocessing_key("ann_donor", "v2").endswith("preprocessing.joblib")
    assert evaluation_key("ann_donor", "v2").endswith("evaluations/ann_donor/v2.json")
    assert training_log_key("run-7").endswith("training-logs/run-7.jsonl")
    with pytest.raises(ValueError):
        checkpoint_key("run-7", -1)
    with pytest.raises(ValueError):
        model_key("ann_donor", "v1", ".h5")


def test_backup_key_is_utc_timestamped():
    key = backup_key("datasets/training", datetime(2026, 11, 23, 10, 30, tzinfo=timezone.utc))
    assert key == "backups/20261123T103000Z/datasets/training"


def test_checksum_detects_duplicate_payload(tmp_path: Path):
    first = tmp_path / "a.parquet"
    second = tmp_path / "b.parquet"
    first.write_bytes(b"same-content")
    second.write_bytes(b"same-content")
    assert sha256_file(first) == sha256_file(second)


def test_manifest_rejects_phi_and_records_lineage(tmp_path: Path):
    path = tmp_path / "rows.parquet"
    path.write_bytes(b"not-real-parquet")
    manifest = dataset_manifest(
        dataset_id="demand",
        version="v1",
        stage="training",
        source="synthetic generator",
        synthetic=True,
        row_count=12,
        local_path=path,
        schema={"day": "string", "units": "int64"},
    )
    assert manifest["contains_phi"] is False
    assert manifest["sha256"] == sha256_file(path)
    assert manifest["object_key"].startswith("datasets/training/demand/v1/")
    with pytest.raises(ValueError):
        dataset_manifest(
            dataset_id="donors",
            version="v1",
            stage="raw",
            source="hospital",
            synthetic=False,
            row_count=1,
            local_path=path,
            schema={},
            contains_phi=True,
        )


def test_local_store_roundtrip_and_usage(tmp_path: Path):
    store = LocalObjectStore(tmp_path / "objects")
    source = tmp_path / "rows.parquet"
    source.write_bytes(b"x" * 100)
    key = dataset_key("training", "demand", "v1", "rows.parquet")
    store.put_file(source, key)
    assert store.list_objects()[0].size_bytes == 100

    report = usage_report(store, capacity_bytes=1000, threshold_pct=80)
    assert report.used_bytes == 100
    assert report.object_count == 1
    assert report.needs_expansion is False
    assert report.by_stage["training"] == 100

    restored = tmp_path / "restored.parquet"
    store.get_file(key, restored)
    assert restored.read_bytes() == source.read_bytes()
    assert store.list_objects("datasets/training/demand")[0].key == key


def test_capacity_expansion_is_explicit(tmp_path: Path):
    store = LocalObjectStore(tmp_path / "objects")
    (tmp_path / "payload.bin").write_bytes(b"z" * 900)
    store.put_file(tmp_path / "payload.bin", "models/ann_donor/v1/artifact.keras")
    report = usage_report(store, capacity_bytes=1000, threshold_pct=80)
    assert report.needs_expansion is True
    assert report.headroom_bytes == 100
    assert report.as_dict()["usage_pct"] == 90.0


def test_zero_capacity_is_rejected(tmp_path: Path):
    store = LocalObjectStore(tmp_path / "objects")
    with pytest.raises(ValueError):
        usage_report(store, capacity_bytes=0, threshold_pct=80)


def test_retention_selects_only_old_objects_in_prefix():
    now = datetime(2026, 11, 23, tzinfo=timezone.utc)
    objects = [
        ObjectInfo("datasets/raw/a.parquet", 10, now - timedelta(days=400)),
        ObjectInfo("datasets/raw/b.parquet", 10, now - timedelta(days=10)),
        ObjectInfo("datasets/training/c.parquet", 10, now - timedelta(days=400)),
    ]
    expired = expired_objects(objects, "datasets/raw/", now, 365)
    assert [item.key for item in expired] == ["datasets/raw/a.parquet"]
    with pytest.raises(ValueError):
        expired_objects(objects, "datasets/", now, 0)


def test_config_rejects_invalid_capacity_and_threshold(monkeypatch):
    monkeypatch.setenv("AI_STORAGE_CAPACITY_GB", "0")
    with pytest.raises(StorageConfigurationError):
        StorageConfig.from_env()
    monkeypatch.setenv("AI_STORAGE_CAPACITY_GB", "500")
    monkeypatch.setenv("AI_STORAGE_EXPANSION_PCT", "101")
    with pytest.raises(StorageConfigurationError):
        StorageConfig.from_env()


def test_make_store_falls_back_to_local_dev_without_bucket(tmp_path, monkeypatch):
    monkeypatch.delenv("AI_S3_BUCKET", raising=False)
    monkeypatch.setenv("AI_LOCAL_STORAGE_DIR", str(tmp_path / "local"))
    store = make_store()
    assert store.provider == "local-dev"


def test_capacity_plan_has_initial_and_10m_targets():
    plan = capacity_plan()
    assert plan["initial_capacity_gb"] == DEFAULT_CAPACITY_GB == 500
    assert plan["ten_million_target_gb"] == 5120
    assert "not registered users" in plan["note"]


def test_usage_report_written_as_json(tmp_path: Path):
    store = LocalObjectStore(tmp_path / "objects")
    (tmp_path / "payload").write_bytes(b"abc")
    store.put_file(tmp_path / "payload", "backups/2026/a.bin")
    report = usage_report(store, 10 * GIB, 80)
    destination = tmp_path / "reports" / "usage.json"
    write_usage_report(report, destination)
    payload = json.loads(destination.read_text())
    assert payload["used_bytes"] == 3
    assert payload["by_stage"]["backups"] == 3

"""Verify and package the three deep-model artifacts.

This script is intentionally fail-closed. It never creates a placeholder model
and exits non-zero when an artifact, scaler, history, metadata field, checksum or
inference result is missing. Run it in the same TensorFlow environment that
trained the models (for example the Colab notebook):

    python scripts/verify_deep_artifacts.py --package /content/lifelink-deep-artifacts.zip

It writes ``artifacts/deep/deep-artifacts-manifest.json`` with SHA-256 checksums
and the actual TensorFlow/Keras/device information, loads each model, and runs a
deterministic one-row inference. The package contains only the latest verified
files for each model.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np

SERVICE_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ARTIFACTS = SERVICE_ROOT / "artifacts"
DEEP_PREFIXES = {
    "ANN": "ann-donor",
    "LSTM": "lstm-demand",
    "Autoencoder": "autoencoder-inventory",
}
EXPECTED = {
    "ANN": {"model": "ann_donor_response", "input_dim": 4},
    "LSTM": {"model": "lstm_demand", "lookback": 28},
    "Autoencoder": {"model": "autoencoder_inventory", "input_dim": 7},
}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _latest_metadata(deep: Path, prefix: str) -> tuple[Path | None, dict[str, Any] | None]:
    candidates = sorted(deep.glob(f"{prefix}-*.metadata.json"))
    for path in reversed(candidates):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        return path, payload
    return None, None


def _load_tensorflow():
    try:
        import tensorflow as tf  # type: ignore
        from tensorflow import keras  # type: ignore
    except ImportError as error:  # pragma: no cover - environment dependent
        raise RuntimeError(
            "TensorFlow is not installed. Artifact loading and inference cannot "
            "be verified in this environment."
        ) from error
    return tf, keras


def _inference(keras, kind: str, model, scaler, metadata: dict[str, Any]) -> dict[str, Any]:
    if kind == "ANN":
        raw = np.zeros((1, EXPECTED["ANN"]["input_dim"]), dtype=float)
        scaled = scaler.transform(raw)
        prediction = np.asarray(model.predict(scaled, verbose=0)).ravel()
        value = float(prediction[0])
        if not np.isfinite(value) or not 0.0 <= value <= 1.0:
            raise RuntimeError("ANN inference did not return a valid probability.")
        return {"output": round(value, 6), "shape": list(prediction.shape)}
    if kind == "LSTM":
        lookback = int(metadata.get("lookback_days", EXPECTED["LSTM"]["lookback"]))
        raw = np.zeros((1, lookback), dtype=float)
        scaled = scaler.transform(raw.reshape(-1, 1)).reshape(1, lookback, 1)
        prediction = np.asarray(model.predict(scaled, verbose=0)).ravel()
        value = float(prediction[0])
        if not np.isfinite(value):
            raise RuntimeError("LSTM inference returned a non-finite value.")
        return {"output": round(value, 6), "shape": list(prediction.shape)}
    raw = np.zeros((1, EXPECTED["Autoencoder"]["input_dim"]), dtype=float)
    scaled = scaler.transform(raw)
    reconstruction = np.asarray(model.predict(scaled, verbose=0))
    if reconstruction.shape != scaled.shape or not np.isfinite(reconstruction).all():
        raise RuntimeError("Autoencoder reconstruction shape/value is invalid.")
    error = float(np.mean((reconstruction - scaled) ** 2))
    return {"reconstruction_mse": round(error, 6), "shape": list(reconstruction.shape)}


def verify(artifacts_dir: Path, package: Path | None) -> tuple[int, dict[str, Any]]:
    deep = artifacts_dir / "deep"
    report: dict[str, Any] = {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "artifacts_dir": str(deep),
        "models": {},
        "status": "failed",
    }
    missing: list[str] = []
    files: list[Path] = []
    for kind, prefix in DEEP_PREFIXES.items():
        metadata_path, metadata = _latest_metadata(deep, prefix)
        entry: dict[str, Any] = {
            "prefix": prefix,
            "metadata": metadata_path.name if metadata_path else None,
            "ready": False,
        }
        report["models"][kind] = entry
        if metadata_path is None or metadata is None:
            entry["error"] = "No metadata artifact found."
            missing.append(kind)
            continue
        version = metadata.get("version")
        artifact = deep / f"{version}.keras" if version else None
        scaler_path = deep / f"{version}.scaler.joblib" if version else None
        history_path = deep / f"{version}.history.json" if version else None
        absent = False
        for label, path in (
            ("artifact", artifact),
            ("scaler", scaler_path),
            ("history", history_path),
        ):
            if path is None or not path.exists():
                entry["error"] = f"Missing {label} for {version}."
                absent = True
                break
        if absent:
            missing.append(kind)
            continue
        if artifact and scaler_path and history_path:
            checks: list[str] = []
            if metadata.get("model") != EXPECTED[kind]["model"]:
                checks.append(f"metadata model is {metadata.get('model')!r}")
            if metadata.get("synthetic") is not True:
                checks.append("metadata does not mark synthetic data")
            if not metadata.get("environment"):
                checks.append("missing environment/device information")
            if not metadata.get("metrics"):
                checks.append("missing evaluation metrics")
            if not metadata.get("dataset_provenance"):
                checks.append("missing dataset provenance")
            if kind == "Autoencoder" and "threshold" not in (metadata.get("metrics") or {}):
                checks.append("missing anomaly threshold")
            if checks:
                entry["error"] = "Metadata validation failed: " + "; ".join(checks)
                missing.append(kind)
                continue

            entry.update(
                {
                    "version": version,
                    "trained_at": metadata.get("trained_at"),
                    "duration_seconds": metadata.get("duration_seconds"),
                    "environment": metadata.get("environment"),
                    "metrics": metadata.get("metrics"),
                    "files": {
                        label: {
                            "path": str(path.relative_to(artifacts_dir)),
                            "bytes": path.stat().st_size,
                            "sha256": _sha256(path),
                        }
                        for label, path in (
                            ("metadata", metadata_path),
                            ("artifact", artifact),
                            ("scaler", scaler_path),
                            ("history", history_path),
                        )
                    },
                }
            )
            files.extend([metadata_path, artifact, scaler_path, history_path])
            entry["ready"] = True

    if missing:
        report["error"] = "Deep artifacts are incomplete or invalid: " + ", ".join(missing)
        report["missing"] = missing
        return 2, report

    try:
        tf, keras = _load_tensorflow()
        report["runtime"] = {
            "tensorflow": tf.__version__,
            "keras": keras.__version__,
            "gpus": [device.name for device in tf.config.list_physical_devices("GPU")],
        }
        for kind, entry in report["models"].items():
            version = entry["version"]
            artifact = deep / f"{version}.keras"
            scaler_path = deep / f"{version}.scaler.joblib"
            model = keras.models.load_model(artifact, compile=False)
            scaler = joblib.load(scaler_path)
            inference = _inference(keras, kind, model, scaler, entry.get("metadata", {}))
            entry["inference"] = inference
            entry["loaded"] = True
    except Exception as error:  # noqa: BLE001 - report the exact verification failure
        report["error"] = f"Artifact loading or inference failed: {error}"
        return 2, report

    report["status"] = "verified"
    manifest_path = deep / "deep-artifacts-manifest.json"
    manifest_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    report["manifest"] = str(manifest_path)
    if package is not None:
        package.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(package, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for path in [*files, manifest_path]:
                archive.write(path, arcname=f"deep/{path.name}")
        report["package"] = {"path": str(package), "bytes": package.stat().st_size}
    return 0, report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifacts", type=Path, default=DEFAULT_ARTIFACTS)
    parser.add_argument("--package", type=Path, default=None)
    args = parser.parse_args()
    status, report = verify(args.artifacts, args.package)
    print(json.dumps(report, indent=2))
    return status


if __name__ == "__main__":
    raise SystemExit(main())

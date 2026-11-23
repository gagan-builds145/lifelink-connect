"""TensorFlow/Keras training pipelines for the LifeLink deep models.

TensorFlow is an optional dependency. These scripts refuse to run, with a clear
message, when it is not installed; they never fabricate metrics or artifacts.

Run from ``ml_service/`` after installing ``requirements-deep.txt``:
    python scripts/train_ann.py
    python scripts/train_lstm.py
    python scripts/train_autoencoder.py
    python scripts/train_all_deep.py
"""

from __future__ import annotations

import json
import math
import platform
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
from sklearn.metrics import (
    accuracy_score,
    brier_score_loss,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
    roc_curve,
)
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.utils.class_weight import compute_class_weight

SERVICE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_ROOT))

from app.anomaly_model import (  # noqa: E402
    FEATURE_NAMES as ANOMALY_FEATURE_NAMES,
    _feature_vector,
    synthetic_labeled_observations,
)
from app.donor_model import synthetic_donor_samples  # noqa: E402
from app.features import build_training_rows, group_records, synthetic_demand_records  # noqa: E402


class DeepDependencyError(RuntimeError):
    """Raised when TensorFlow is unavailable."""


def require_tensorflow():
    try:
        import tensorflow as tf  # type: ignore
    except ImportError as error:  # pragma: no cover - environment dependent
        raise DeepDependencyError(
            "TensorFlow is not installed. Install ml_service/requirements-deep.txt "
            "in a Python 3.10-3.12 environment before training deep models. "
            "No model artifacts or metrics were produced."
        ) from error
    return tf


def _stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def _deep_dir(artifacts_dir: Path) -> Path:
    path = artifacts_dir / "deep"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _environment(tf) -> dict[str, Any]:
    """Record the actual runtime so a CPU run is never reported as GPU."""
    gpus = [device.name for device in tf.config.list_physical_devices("GPU")]
    try:
        import keras  # type: ignore

        keras_version = keras.__version__
    except Exception:  # pragma: no cover - environment dependent
        keras_version = None
    return {
        "python": platform.python_version(),
        "platform": platform.platform(),
        "tensorflow": tf.__version__,
        "keras": keras_version,
        "numpy": np.__version__,
        "device": "GPU" if gpus else "CPU",
        "gpus": gpus,
        "random_seed": 42,
    }


def _history_payload(history, version: str, deep: Path) -> dict[str, Any]:
    payload = {
        key: [float(value) for value in values]
        for key, values in (history.history or {}).items()
    }
    path = deep / f"{version}.history.json"
    _write_json(path, {"version": version, "epochs": len(payload.get("loss", [])), "history": payload})
    return payload


def _chronological_split(
    count: int, train_ratio: float = 0.70, validation_ratio: float = 0.15
) -> tuple[slice, slice, slice]:
    """Split a sequence chronologically without shuffling or overlap."""
    if count < 3:
        raise ValueError("At least three chronological observations are required.")
    train_end = max(1, int(count * train_ratio))
    validation_end = max(train_end + 1, int(count * (train_ratio + validation_ratio)))
    validation_end = min(validation_end, count - 1)
    return slice(0, train_end), slice(train_end, validation_end), slice(validation_end, count)


def train_ann(artifacts_dir: Path) -> dict[str, Any]:
    tf = require_tensorflow()
    from tensorflow import keras  # type: ignore

    started = time.perf_counter()
    environment = _environment(tf)
    samples = synthetic_donor_samples()
    X = np.asarray([sample.features() for sample in samples], dtype=float)
    y = np.asarray([1 if sample.responded else 0 for sample in samples], dtype=float)

    # Hold out the same 20% stratified test fraction and seed used by the
    # Random Forest so the two models can be compared on the same rows.
    X_train_full, X_test, y_train_full, y_test = train_test_split(
        X, y, test_size=0.20, random_state=42, stratify=y
    )
    X_train, X_val, y_train, y_val = train_test_split(
        X_train_full,
        y_train_full,
        test_size=0.15,
        random_state=42,
        stratify=y_train_full,
    )
    scaler = StandardScaler().fit(X_train)
    X_train_s = scaler.transform(X_train)
    X_val_s = scaler.transform(X_val)
    X_test_s = scaler.transform(X_test)

    deep = _deep_dir(artifacts_dir)
    version = f"ann-donor-{_stamp()}"
    checkpoint = deep / f"{version}.keras"
    model = keras.Sequential(
        [
            keras.layers.Input(shape=(X.shape[1],)),
            keras.layers.Dense(32, activation="relu", kernel_regularizer=keras.regularizers.l2(1e-3)),
            keras.layers.Dropout(0.2),
            keras.layers.Dense(16, activation="relu", kernel_regularizer=keras.regularizers.l2(1e-3)),
            keras.layers.Dropout(0.2),
            keras.layers.Dense(1, activation="sigmoid"),
        ]
    )
    model.compile(optimizer=keras.optimizers.Adam(learning_rate=1e-3), loss="binary_crossentropy", metrics=["accuracy"])
    classes = np.unique(y_train)
    weights = compute_class_weight("balanced", classes=classes, y=y_train)
    class_weight = {int(label): float(weight) for label, weight in zip(classes, weights, strict=True)}
    history = model.fit(
        X_train_s,
        y_train,
        validation_data=(X_val_s, y_val),
        epochs=120,
        batch_size=32,
        class_weight=class_weight,
        verbose=0,
        callbacks=[
            keras.callbacks.EarlyStopping(monitor="val_loss", patience=12, restore_best_weights=True),
            keras.callbacks.ModelCheckpoint(str(checkpoint), monitor="val_loss", save_best_only=True),
        ],
    )
    probability = model.predict(X_test_s, verbose=0).ravel()
    predicted = (probability >= 0.5).astype(int)
    fpr, tpr, _ = roc_curve(y_test, probability)
    metrics = {
        "accuracy": float(accuracy_score(y_test, predicted)),
        "precision": float(precision_score(y_test, predicted, zero_division=0)),
        "recall": float(recall_score(y_test, predicted, zero_division=0)),
        "f1": float(f1_score(y_test, predicted, zero_division=0)),
        "roc_auc": float(roc_auc_score(y_test, probability)) if len(set(y_test)) > 1 else None,
        "brier_score": float(brier_score_loss(y_test, probability)),
        "confusion_matrix": confusion_matrix(y_test, predicted).tolist(),
        "roc_curve_points": len(fpr),
        "train_size": int(len(X_train)),
        "validation_size": int(len(X_val)),
        "test_size": int(len(X_test)),
    }
    joblib.dump(scaler, deep / f"{version}.scaler.joblib")
    training_history = _history_payload(history, version, deep)
    metadata = {
        "model": "ann_donor_response",
        "architecture": "Dense(32,relu)->Dropout(.2)->Dense(16,relu)->Dropout(.2)->Dense(1,sigmoid)",
        "version": version,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "duration_seconds": round(time.perf_counter() - started, 3),
        "environment": environment,
        "synthetic": True,
        "dataset_label": "deterministic synthetic consented donor-response sample",
        "dataset_provenance": "Generated in-process by app.donor_model.synthetic_donor_samples(); no real donor records.",
        "dataset": {
            "samples": len(X),
            "features": 4,
            "train": len(X_train),
            "validation": len(X_val),
            "test": len(X_test),
            "positive_test": int(y_test.sum()),
            "class_weight": class_weight,
        },
        "feature_names": ["distance_km", "days_since_donation", "previous_donations", "prior_response_rate"],
        "metrics": metrics,
        "epochs_completed": len(training_history.get("loss", [])),
        "training_history": training_history,
        "validation_method": "Stratified 64/16/20 train/validation/test split with seed 42; the 20% test rows use the same split seed and fraction as the Random Forest comparison.",
        "constraints": "Consent required. Not used for medical eligibility or clinical compatibility.",
    }
    _write_json(deep / f"{version}.metadata.json", metadata)
    print(json.dumps(metadata, indent=2))
    return metadata


def _demand_sequences() -> tuple[
    np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray, int
]:
    """Build sequence windows and split each series chronologically.

    Splitting the concatenated sequences would let later dates from one series
    leak into validation while earlier dates from another sit in training. Each
    series is therefore split on its own timeline before concatenation.
    """
    records = synthetic_demand_records(days=365)
    series = group_records(records)
    train_x: list[list[float]] = []
    train_y: list[float] = []
    val_x: list[list[float]] = []
    val_y: list[float] = []
    test_x: list[list[float]] = []
    test_y: list[float] = []
    for item in series.values():
        units = [float(value) for value in item.units]
        sequence_x = [units[index - 28 : index] for index in range(28, len(units))]
        sequence_y = [units[index] for index in range(28, len(units))]
        train_slice, val_slice, test_slice = _chronological_split(len(sequence_x))
        train_x.extend(sequence_x[train_slice])
        train_y.extend(sequence_y[train_slice])
        val_x.extend(sequence_x[val_slice])
        val_y.extend(sequence_y[val_slice])
        test_x.extend(sequence_x[test_slice])
        test_y.extend(sequence_y[test_slice])
    return (
        np.asarray(train_x, dtype=float),
        np.asarray(train_y, dtype=float),
        np.asarray(val_x, dtype=float),
        np.asarray(val_y, dtype=float),
        np.asarray(test_x, dtype=float),
        np.asarray(test_y, dtype=float),
        len(series),
    )


def train_lstm(artifacts_dir: Path) -> dict[str, Any]:
    tf = require_tensorflow()
    from tensorflow import keras  # type: ignore

    started = time.perf_counter()
    environment = _environment(tf)
    X_train, y_train, X_val, y_val, X_test, y_test, series_count = _demand_sequences()
    if len(X_train) < 60:
        raise RuntimeError("Not enough demand sequences to train the LSTM.")
    scaler = StandardScaler().fit(X_train.reshape(-1, 1))
    transform = lambda values: scaler.transform(values.reshape(-1, 1)).reshape(values.shape)  # noqa: E731
    X_train_s, X_val_s, X_test_s = transform(X_train), transform(X_val), transform(X_test)

    deep = _deep_dir(artifacts_dir)
    version = f"lstm-demand-{_stamp()}"
    checkpoint = deep / f"{version}.keras"
    model = keras.Sequential(
        [
            keras.layers.Input(shape=(28, 1)),
            keras.layers.LSTM(32, return_sequences=False),
            keras.layers.Dropout(0.2),
            keras.layers.Dense(16, activation="relu"),
            keras.layers.Dense(1),
        ]
    )
    model.compile(optimizer=keras.optimizers.Adam(learning_rate=1e-3), loss="mse", metrics=["mae"])
    history = model.fit(
        X_train_s[..., None],
        y_train,
        validation_data=(X_val_s[..., None], y_val),
        epochs=100,
        batch_size=64,
        verbose=0,
        callbacks=[
            keras.callbacks.EarlyStopping(monitor="val_loss", patience=10, restore_best_weights=True),
            keras.callbacks.ModelCheckpoint(str(checkpoint), monitor="val_loss", save_best_only=True),
        ],
    )
    scaled_prediction = model.predict(X_test_s[..., None], verbose=0).ravel()
    prediction = scaler.inverse_transform(scaled_prediction.reshape(-1, 1)).ravel()
    baseline = X_test[:, -7:].mean(axis=1)
    mae = float(np.mean(np.abs(y_test - prediction)))
    rmse = float(math.sqrt(np.mean((y_test - prediction) ** 2)))
    baseline_mae = float(np.mean(np.abs(y_test - baseline)))
    baseline_rmse = float(math.sqrt(np.mean((y_test - baseline) ** 2)))
    non_zero = y_test != 0
    mape = float(np.mean(np.abs((y_test[non_zero] - prediction[non_zero]) / y_test[non_zero])) * 100) if non_zero.any() else None
    metrics = {
        "mae": mae,
        "rmse": rmse,
        "mape": mape,
        "baseline_mae": baseline_mae,
        "baseline_rmse": baseline_rmse,
        "mae_improvement_pct": round((baseline_mae - mae) / baseline_mae * 100, 2) if baseline_mae > 0 else None,
        "train_size": int(len(X_train)),
        "validation_size": int(len(X_val)),
        "holdout_size": int(len(X_test)),
        "mean_actual": float(np.mean(y_test)),
    }
    joblib.dump(scaler, deep / f"{version}.scaler.joblib")
    training_history = _history_payload(history, version, deep)
    metadata = {
        "model": "lstm_demand",
        "architecture": "LSTM(32)->Dropout(.2)->Dense(16,relu)->Dense(1)",
        "version": version,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "duration_seconds": round(time.perf_counter() - started, 3),
        "environment": environment,
        "synthetic": True,
        "dataset_label": f"deterministic synthetic demand, {series_count} blood-group/component series, 365 days",
        "dataset_provenance": "Generated in-process by app.features.synthetic_demand_records(); no hospital records.",
        "dataset": {
            "series": series_count,
            "lookback_days": 28,
            "train_sequences": int(len(X_train)),
            "validation_sequences": int(len(X_val)),
            "test_sequences": int(len(X_test)),
        },
        "lookback_days": 28,
        "metrics": metrics,
        "epochs_completed": len(training_history.get("loss", [])),
        "training_history": training_history,
        "validation_method": "Per-series chronological 70/15/15 split with no shuffling; scaler fit on training sequences only; rolling 7-day mean baseline.",
    }
    _write_json(deep / f"{version}.metadata.json", metadata)
    print(json.dumps(metadata, indent=2))
    return metadata


def train_autoencoder(artifacts_dir: Path) -> dict[str, Any]:
    tf = require_tensorflow()
    from tensorflow import keras  # type: ignore

    started = time.perf_counter()
    environment = _environment(tf)
    observations = synthetic_labeled_observations()
    values = [float(item.units) for item in observations]
    rows = np.asarray([_feature_vector(values, index) for index in range(len(values))], dtype=float)
    normal = rows[[not item.is_anomaly for item in observations]]
    anomalies = rows[[item.is_anomaly for item in observations]]
    if len(anomalies) == 0:
        raise RuntimeError("No labelled synthetic anomalies are available for evaluation.")

    # Train and choose the threshold on normal observations only. The test split
    # contains held-out normals plus all labelled synthetic anomalies, so the
    # threshold never sees an anomaly.
    train_normal, remaining_normal = train_test_split(
        normal, test_size=0.40, random_state=42
    )
    val_normal, test_normal = train_test_split(
        remaining_normal, test_size=0.50, random_state=42
    )
    test_rows = np.concatenate([test_normal, anomalies], axis=0)
    labels = np.asarray(
        [0] * len(test_normal) + [1] * len(anomalies), dtype=int
    )
    scaler = StandardScaler().fit(train_normal)
    train_s = scaler.transform(train_normal)
    val_s = scaler.transform(val_normal)
    test_s = scaler.transform(test_rows)

    deep = _deep_dir(artifacts_dir)
    version = f"autoencoder-inventory-{_stamp()}"
    checkpoint = deep / f"{version}.keras"
    model = keras.Sequential(
        [
            keras.layers.Input(shape=(rows.shape[1],)),
            keras.layers.Dense(8, activation="relu"),
            keras.layers.Dense(4, activation="relu"),
            keras.layers.Dense(8, activation="relu"),
            keras.layers.Dense(rows.shape[1], activation="linear"),
        ]
    )
    model.compile(optimizer=keras.optimizers.Adam(learning_rate=1e-3), loss="mse")
    history = model.fit(
        train_s,
        train_s,
        validation_data=(val_s, val_s),
        epochs=150,
        batch_size=16,
        verbose=0,
        callbacks=[
            keras.callbacks.EarlyStopping(monitor="val_loss", patience=15, restore_best_weights=True),
            keras.callbacks.ModelCheckpoint(str(checkpoint), monitor="val_loss", save_best_only=True),
        ],
    )
    validation_error = np.mean((model.predict(val_s, verbose=0) - val_s) ** 2, axis=1)
    threshold = float(np.quantile(validation_error, 0.95))
    reconstruction = np.mean((model.predict(test_s, verbose=0) - test_s) ** 2, axis=1)
    predicted = (reconstruction > threshold).astype(int)
    metrics = {
        "precision": float(precision_score(labels, predicted, zero_division=0)),
        "recall": float(recall_score(labels, predicted, zero_division=0)),
        "f1": float(f1_score(labels, predicted, zero_division=0)),
        "false_positive_rate": float(
            np.mean(predicted[labels == 0]) if np.any(labels == 0) else 0.0
        ),
        "threshold": threshold,
        "confusion_matrix": confusion_matrix(labels, predicted).tolist(),
        "holdout_size": int(len(labels)),
        "labelled_anomalies": int(labels.sum()),
        "normal_samples": int((labels == 0).sum()),
    }
    joblib.dump(scaler, deep / f"{version}.scaler.joblib")
    training_history = _history_payload(history, version, deep)
    metadata = {
        "model": "autoencoder_inventory",
        "architecture": f"Dense(8,relu)->Dense(4,relu)->Dense(8,relu)->Dense({rows.shape[1]},linear)",
        "version": version,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "duration_seconds": round(time.perf_counter() - started, 3),
        "environment": environment,
        "synthetic": True,
        "dataset_label": "deterministic synthetic inventory demand with injected labelled spikes/drops",
        "dataset_provenance": "Generated in-process by app.anomaly_model.synthetic_labeled_observations(); anomalies are injected synthetic test patterns, not hospital incidents.",
        "dataset": {
            "normal_observations": int(len(normal)),
            "anomalies": int(len(anomalies)),
            "train": int(len(train_normal)),
            "validation": int(len(val_normal)),
            "test": int(len(test_rows)),
            "test_normals": int(len(test_normal)),
        },
        "feature_names": ANOMALY_FEATURE_NAMES,
        "metrics": metrics,
        "epochs_completed": len(training_history.get("loss", [])),
        "training_history": training_history,
        "threshold_source": "95th percentile of validation reconstruction error on held-out normal observations",
        "validation_method": "Trained only on synthetic normal observations; threshold chosen from held-out normal validation error; scored once against a separate test set of held-out normals plus injected synthetic anomalies.",
        "constraints": "Alerts require human review. The model does not identify a cause or make clinical, inventory or disciplinary decisions.",
    }
    _write_json(deep / f"{version}.metadata.json", metadata)
    print(json.dumps(metadata, indent=2))
    return metadata


def train_all_deep(artifacts_dir: Path) -> dict[str, Any]:
    return {
        "warning": "All metrics are measured on deterministic synthetic data and are not hospital performance.",
        "ann": train_ann(artifacts_dir),
        "lstm": train_lstm(artifacts_dir),
        "autoencoder": train_autoencoder(artifacts_dir),
    }


if __name__ == "__main__":
    try:
        print(json.dumps(train_all_deep(SERVICE_ROOT / "artifacts"), indent=2))
    except DeepDependencyError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)

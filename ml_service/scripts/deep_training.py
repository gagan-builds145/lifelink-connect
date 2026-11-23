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
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
    roc_curve,
)
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler

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


def train_ann(artifacts_dir: Path) -> dict[str, Any]:
    tf = require_tensorflow()
    from tensorflow import keras  # type: ignore

    samples = synthetic_donor_samples()
    X = np.asarray([sample.features() for sample in samples], dtype=float)
    y = np.asarray([1 if sample.responded else 0 for sample in samples], dtype=float)

    X_train, X_temp, y_train, y_temp = train_test_split(
        X, y, test_size=0.30, random_state=42, stratify=y
    )
    X_val, X_test, y_val, y_test = train_test_split(
        X_temp, y_temp, test_size=0.50, random_state=42, stratify=y_temp
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
    history = model.fit(
        X_train_s,
        y_train,
        validation_data=(X_val_s, y_val),
        epochs=120,
        batch_size=32,
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
        "confusion_matrix": confusion_matrix(y_test, predicted).tolist(),
        "roc_curve_points": len(fpr),
        "train_size": int(len(X_train)),
        "validation_size": int(len(X_val)),
        "test_size": int(len(X_test)),
    }
    joblib.dump(scaler, deep / f"{version}.scaler.joblib")
    metadata = {
        "model": "ann_donor_response",
        "architecture": "Dense(32,relu)->Dropout(.2)->Dense(16,relu)->Dropout(.2)->Dense(1,sigmoid)",
        "version": version,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "synthetic": True,
        "dataset_label": "deterministic synthetic consented donor-response sample",
        "feature_names": ["distance_km", "days_since_donation", "previous_donations", "prior_response_rate"],
        "metrics": metrics,
        "epochs_completed": len(history.history.get("loss", [])),
        "training_history": {
            "loss": [float(v) for v in history.history.get("loss", [])],
            "val_loss": [float(v) for v in history.history.get("val_loss", [])],
            "accuracy": [float(v) for v in history.history.get("accuracy", [])],
            "val_accuracy": [float(v) for v in history.history.get("val_accuracy", [])],
        },
        "validation_method": "Stratified 70/15/15 train/validation/test split; metrics from the untouched test split.",
        "constraints": "Consent required. Not used for medical eligibility or clinical compatibility.",
    }
    _write_json(deep / f"{version}.metadata.json", metadata)
    print(json.dumps(metadata, indent=2))
    return metadata


def _demand_sequences() -> tuple[np.ndarray, np.ndarray, list[float]]:
    records = synthetic_demand_records(days=365)
    series = group_records(records)
    X: list[list[float]] = []
    y: list[float] = []
    for item in series.values():
        units = [float(value) for value in item.units]
        for index in range(28, len(units)):
            X.append(units[index - 28 : index])
            y.append(units[index])
    return np.asarray(X, dtype=float), np.asarray(y, dtype=float), [float(item.units[-1]) for item in series.values()]


def train_lstm(artifacts_dir: Path) -> dict[str, Any]:
    tf = require_tensorflow()
    from tensorflow import keras  # type: ignore

    X, y, _ = _demand_sequences()
    if len(X) < 60:
        raise RuntimeError("Not enough demand sequences to train the LSTM.")
    split_train = int(len(X) * 0.70)
    split_val = int(len(X) * 0.85)
    X_train, y_train = X[:split_train], y[:split_train]
    X_val, y_val = X[split_train:split_val], y[split_train:split_val]
    X_test, y_test = X[split_val:], y[split_val:]
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
    metadata = {
        "model": "lstm_demand",
        "architecture": "LSTM(32)->Dropout(.2)->Dense(16,relu)->Dense(1)",
        "version": version,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "synthetic": True,
        "dataset_label": "deterministic synthetic demand, 32 blood-group/component series, 365 days",
        "lookback_days": 28,
        "metrics": metrics,
        "epochs_completed": len(history.history.get("loss", [])),
        "training_history": {
            "loss": [float(v) for v in history.history.get("loss", [])],
            "val_loss": [float(v) for v in history.history.get("val_loss", [])],
            "mae": [float(v) for v in history.history.get("mae", [])],
            "val_mae": [float(v) for v in history.history.get("val_mae", [])],
        },
        "validation_method": "Chronological 70/15/15 split over generated sequences; rolling 7-day mean baseline.",
    }
    _write_json(deep / f"{version}.metadata.json", metadata)
    print(json.dumps(metadata, indent=2))
    return metadata


def train_autoencoder(artifacts_dir: Path) -> dict[str, Any]:
    tf = require_tensorflow()
    from tensorflow import keras  # type: ignore

    observations = synthetic_labeled_observations()
    values = [float(item.units) for item in observations]
    rows = np.asarray([_feature_vector(values, index) for index in range(len(values))], dtype=float)
    normal = rows[[not item.is_anomaly for item in observations]]
    labelled = rows
    labels = np.asarray([1 if item.is_anomaly else 0 for item in observations], dtype=int)
    train_normal, val_normal = train_test_split(normal, test_size=0.25, random_state=42)
    scaler = StandardScaler().fit(train_normal)
    train_s = scaler.transform(train_normal)
    val_s = scaler.transform(val_normal)
    all_s = scaler.transform(labelled)

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
    train_error = np.mean((model.predict(train_s, verbose=0) - train_s) ** 2, axis=1)
    threshold = float(np.quantile(train_error, 0.95))
    reconstruction = np.mean((model.predict(all_s, verbose=0) - all_s) ** 2, axis=1)
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
    metadata = {
        "model": "autoencoder_inventory",
        "architecture": f"Dense(8,relu)->Dense(4,relu)->Dense(8,relu)->Dense({rows.shape[1]},linear)",
        "version": version,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "synthetic": True,
        "feature_names": ANOMALY_FEATURE_NAMES,
        "metrics": metrics,
        "epochs_completed": len(history.history.get("loss", [])),
        "training_history": {
            "loss": [float(v) for v in history.history.get("loss", [])],
            "val_loss": [float(v) for v in history.history.get("val_loss", [])],
        },
        "validation_method": "Trained only on synthetic normal observations; threshold chosen from training reconstruction error; scored against injected labelled synthetic anomalies.",
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

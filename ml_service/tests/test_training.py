from __future__ import annotations

from pathlib import Path

from app.anomaly_model import AnomalyModel, synthetic_labeled_observations
from app.demand_model import DemandModel
from app.donor_model import DonorModel, synthetic_donor_samples
from app.features import synthetic_demand_records


def test_demand_training_writes_and_reloads_artifacts(tmp_path: Path) -> None:
    records = [
        record
        for record in synthetic_demand_records(days=180)
        if (record.blood_group, record.component)
        in {("O+", "red_cells"), ("A+", "platelets")}
    ]
    model = DemandModel(tmp_path)
    metadata = model.train(records, dataset_label="unit-test synthetic demand")

    assert (tmp_path / "demand_model.json").exists()
    assert metadata["metrics"]["holdout_size"] > 0
    assert metadata["metrics"]["mae"] >= 0
    assert metadata["chronological_split"]["cutoff"]
    assert metadata["warnings"] == [] or isinstance(metadata["warnings"], list)

    reloaded = DemandModel(tmp_path)
    assert reloaded.ready is True
    assert reloaded.metadata["version"] == metadata["version"]


def test_donor_training_writes_reloadable_classifier(tmp_path: Path) -> None:
    model = DonorModel(tmp_path)
    metadata = model.train(
        synthetic_donor_samples(count=240),
        dataset_label="unit-test synthetic consented donors",
    )
    assert (tmp_path / "donor_response.joblib").exists()
    assert 0.0 <= metadata["metrics"]["roc_auc"] <= 1.0
    assert DonorModel(tmp_path).ready is True


def test_anomaly_training_writes_reloadable_pipeline(tmp_path: Path) -> None:
    model = AnomalyModel(tmp_path)
    metadata = model.train(synthetic_labeled_observations(days=160))
    assert (tmp_path / "inventory_anomaly.joblib").exists()
    assert metadata["metrics"]["holdout_size"] > 0
    assert 0.0 <= metadata["metrics"]["precision"] <= 1.0
    assert AnomalyModel(tmp_path).ready is True

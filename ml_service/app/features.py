"""Feature engineering shared by training and inference.

The demand model is deliberately a tabular, lag-based regressor. It never
decides blood compatibility or allocation; those remain deterministic rules in
the LifeLink domain engine.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
import math
from typing import Iterable, Mapping, Sequence

BLOOD_GROUPS = ("A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-")
COMPONENTS = ("whole_blood", "red_cells", "platelets", "plasma")
GROUP_CODE = {value: index for index, value in enumerate(BLOOD_GROUPS)}
COMPONENT_CODE = {value: index for index, value in enumerate(COMPONENTS)}

LOOKBACK_DAYS = 28
MIN_HISTORY_DAYS = LOOKBACK_DAYS + 1
MIN_TRAINING_DAYS = 60


@dataclass(frozen=True)
class DemandRecord:
    date: str
    blood_group: str
    component: str
    units: float
    is_synthetic: bool = False


@dataclass(frozen=True)
class DemandPoint:
    date: str
    units: float


@dataclass
class Series:
    blood_group: str
    component: str
    dates: list[date]
    units: list[float]
    is_synthetic: bool

    @property
    def key(self) -> str:
        return f"{self.blood_group}:{self.component}"


def _parse_date(value: str) -> date:
    try:
        return date.fromisoformat(value[:10])
    except (TypeError, ValueError) as error:
        raise ValueError(f"Invalid ISO date: {value!r}") from error


def _validate_group_component(blood_group: str, component: str) -> None:
    if blood_group not in GROUP_CODE:
        raise ValueError(f"Unsupported blood group: {blood_group}")
    if component not in COMPONENT_CODE:
        raise ValueError(f"Unsupported component: {component}")


def group_records(records: Iterable[DemandRecord]) -> dict[tuple[str, str], Series]:
    """Aggregate duplicate rows and fill absent days with zero demand.

    Filling missing dates is necessary because lag features refer to calendar
    days. A missing day is zero recorded demand, not an invented value.
    """

    buckets: dict[tuple[str, str], dict[date, float]] = {}
    synthetic: dict[tuple[str, str], bool] = {}
    for record in records:
        _validate_group_component(record.blood_group, record.component)
        units = float(record.units)
        if units < 0 or units != units or units in (float("inf"), float("-inf")):
            raise ValueError("Demand units must be a finite, non-negative number.")
        key = (record.blood_group, record.component)
        day = _parse_date(record.date)
        bucket = buckets.setdefault(key, {})
        bucket[day] = bucket.get(day, 0.0) + units
        synthetic[key] = synthetic.get(key, True) and record.is_synthetic

    result: dict[tuple[str, str], Series] = {}
    for key, bucket in buckets.items():
        if not bucket:
            continue
        start, end = min(bucket), max(bucket)
        days = (end - start).days + 1
        dates = [start + timedelta(days=index) for index in range(days)]
        result[key] = Series(
            blood_group=key[0],
            component=key[1],
            dates=dates,
            units=[round(bucket.get(day, 0.0), 4) for day in dates],
            is_synthetic=synthetic.get(key, True),
        )
    return result


def normalize_points(
    points: Sequence[DemandPoint], blood_group: str, component: str
) -> Series:
    _validate_group_component(blood_group, component)
    records = [
        DemandRecord(
            date=point.date,
            blood_group=blood_group,
            component=component,
            units=point.units,
            is_synthetic=False,
        )
        for point in points
    ]
    series = group_records(records).get((blood_group, component))
    if series is None:
        raise ValueError("No demand points were supplied.")
    return series


def _calendar_features(day: date) -> list[float]:
    day_of_year = day.timetuple().tm_yday
    angle = 2.0 * 3.141592653589793 * day_of_year / 365.25
    return [
        float(day.weekday()),
        float(day.month),
        float(day_of_year),
        math.sin(angle),
        math.cos(angle),
        1.0 if day.weekday() >= 5 else 0.0,
    ]


def feature_row(
    history: Sequence[float],
    day: date,
    blood_group: str,
    component: str,
) -> list[float]:
    """Build one row from the 28 days strictly before ``day``."""

    _validate_group_component(blood_group, component)
    if len(history) < LOOKBACK_DAYS:
        raise ValueError(
            f"At least {LOOKBACK_DAYS} preceding demand days are required; got {len(history)}."
        )

    values = [float(value) for value in history[-LOOKBACK_DAYS:]]
    rolling_7 = sum(values[-7:]) / 7.0
    rolling_14 = sum(values[-14:]) / 14.0
    rolling_28 = sum(values[-28:]) / 28.0
    return [
        values[-1],
        values[-7],
        values[-14],
        values[-28],
        rolling_7,
        rolling_14,
        rolling_28,
        sum(values[-7:]),
        sum(values[-28:]),
        *_calendar_features(day),
        float(GROUP_CODE[blood_group]),
        float(COMPONENT_CODE[component]),
    ]


FEATURE_NAMES = [
    "lag_1",
    "lag_7",
    "lag_14",
    "lag_28",
    "rolling_mean_7",
    "rolling_mean_14",
    "rolling_mean_28",
    "rolling_total_7",
    "rolling_total_28",
    "day_of_week",
    "month",
    "day_of_year",
    "day_of_year_sin",
    "day_of_year_cos",
    "is_weekend",
    "blood_group_code",
    "component_code",
]


def build_training_rows(
    records: Iterable[DemandRecord],
) -> tuple[list[list[float]], list[float], list[date], dict[str, int], bool, list[str]]:
    """Return X, y, row dates, per-series counts, synthetic flag and warnings."""

    series_map = group_records(records)
    matrix: list[list[float]] = []
    targets: list[float] = []
    row_dates: list[date] = []
    counts: dict[str, int] = {}
    warnings: list[str] = []
    synthetic = True

    for key, series in sorted(series_map.items()):
        synthetic = synthetic and series.is_synthetic
        if len(series.units) < MIN_TRAINING_DAYS:
            warnings.append(
                f"{series.blood_group} {series.component}: {len(series.units)} days "
                f"(minimum {MIN_TRAINING_DAYS}); excluded."
            )
            continue
        counts[series.key] = len(series.units)
        for index in range(LOOKBACK_DAYS, len(series.units)):
            matrix.append(
                feature_row(
                    series.units[:index],
                    series.dates[index],
                    series.blood_group,
                    series.component,
                )
            )
            targets.append(series.units[index])
            row_dates.append(series.dates[index])

    if not matrix:
        raise ValueError(
            "No series has enough history to train. Provide at least "
            f"{MIN_TRAINING_DAYS} continuous days per blood group and component."
        )
    if len(counts) < 2:
        warnings.append(
            "Only one group/component series was trainable; the model cannot learn "
            "cross-series patterns and will report limited confidence."
        )
    return matrix, targets, row_dates, counts, synthetic, warnings


def future_row(
    history: Sequence[float],
    day: date,
    blood_group: str,
    component: str,
) -> list[float]:
    return feature_row(history, day, blood_group, component)


def next_day(day: date) -> date:
    return day + timedelta(days=1)


def synthetic_demand_records(seed: int = 42, days: int = 365) -> list[DemandRecord]:
    """Deterministic, clearly-labelled synthetic demand for development only.

    The pattern includes weekday effects, annual seasonality, group/component
    baselines and seeded noise. It is not presented as hospital data.
    """

    import random

    start = date(2025, 10, 1)
    generator = random.Random(seed)
    group_factor: Mapping[str, float] = {
        "A+": 10.0,
        "A-": 3.2,
        "B+": 7.5,
        "B-": 2.1,
        "AB+": 3.0,
        "AB-": 0.9,
        "O+": 13.0,
        "O-": 4.5,
    }
    component_factor: Mapping[str, float] = {
        "whole_blood": 0.7,
        "red_cells": 1.4,
        "platelets": 0.8,
        "plasma": 0.9,
    }
    records: list[DemandRecord] = []
    for group in BLOOD_GROUPS:
        for component in COMPONENTS:
            base = group_factor[group] * component_factor[component]
            level = base
            for index in range(days):
                current = start + timedelta(days=index)
                weekday = current.weekday()
                weekly = 1.18 if weekday in (0, 1, 2) else 0.82 if weekday >= 5 else 1.0
                yearly = 1.0 + 0.15 * math.sin(
                    2.0 * math.pi * (current.timetuple().tm_yday - 35) / 365.25
                )
                # Autoregressive persistence plus independent noise.
                target = max(0.0, base * weekly * yearly + 0.35 * level)
                noise = generator.gauss(0.0, max(0.35, target * 0.09))
                level = max(0.0, target * 0.65 + max(0.0, target + noise) * 0.35)
                units = round(level * 4.0) / 4.0
                records.append(
                    DemandRecord(
                        date=current.isoformat(),
                        blood_group=group,
                        component=component,
                        units=units,
                        is_synthetic=True,
                    )
                )
    return records

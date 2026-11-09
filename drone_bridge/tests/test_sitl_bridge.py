from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sitl_bridge import MissionValidationError, validate_mission  # noqa: E402


def mission(**overrides):
    payload = {
        "schema": "lifelink.sitl.mission.v1",
        "simulated": True,
        "missionCode": "DRM-TEST-1",
        "flightController": "px4",
        "payload": {"massKg": 2.8, "units": 4},
        "authorization": {"routeAuthorized": True, "simulated": True},
        "route": [
            {"latitude_deg": 18.5, "longitude_deg": 73.8},
            {"latitude_deg": 18.6, "longitude_deg": 73.9},
        ],
    }
    payload.update(overrides)
    return payload


def test_accepts_valid_simulated_loopback_mission() -> None:
    warnings = validate_mission(mission(), "udp://:14540")
    assert warnings
    assert "SITL-only" in warnings[0]


def test_refuses_non_simulated_mission() -> None:
    with pytest.raises(MissionValidationError, match="simulated"):
        validate_mission(mission(simulated=False), "udp://:14540")


def test_refuses_real_network_connection() -> None:
    with pytest.raises(MissionValidationError, match="loopback"):
        validate_mission(mission(), "udp://192.168.1.10:14540")


def test_refuses_unauthorized_route() -> None:
    with pytest.raises(MissionValidationError, match="not authorized"):
        validate_mission(
            mission(authorization={"routeAuthorized": False, "simulated": True}),
            "udp://:14540",
        )


def test_refuses_short_route() -> None:
    with pytest.raises(MissionValidationError, match="two route waypoints"):
        validate_mission(mission(route=[{"latitude_deg": 18.5, "longitude_deg": 73.8}]), "udp://:14540")


def test_dry_run_does_not_import_mavsdk(tmp_path: Path, capsys) -> None:
    from sitl_bridge import main

    path = tmp_path / "mission.json"
    path.write_text(json.dumps(mission()), encoding="utf-8")
    exit_code = main([str(path), "--dry-run"])
    assert exit_code == 0
    assert "DRM-TEST-1" in capsys.readouterr().out

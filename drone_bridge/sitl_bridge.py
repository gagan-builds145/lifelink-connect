#!/usr/bin/env python3
"""Upload a LifeLink *simulated* mission to PX4/ArduPilot SITL.

This bridge is intentionally not a production flight-control service:

* it accepts only `lifelink.sitl.mission.v1` exports marked `simulated: true`;
* it accepts only loopback/unspecified UDP SITL connections;
* it requires an explicit `--confirm SITL` before arming;
* it does not implement BVLOS, detect-and-avoid, airspace authorization or
  payload-release commands for real aircraft.

MAVSDK is optional and only imported after dry-run validation. A real
deployment requires aviation approval, a validated operator, a real aircraft
adapter and operational safety procedures. Do not point this at real hardware.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
from pathlib import Path
from typing import Any


class MissionValidationError(ValueError):
    pass


def load_mission(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except OSError as error:
        raise MissionValidationError(f"Cannot read mission file: {error}") from error
    except json.JSONDecodeError as error:
        raise MissionValidationError(f"Mission is not valid JSON: {error}") from error
    if not isinstance(payload, dict):
        raise MissionValidationError("Mission root must be an object.")
    return payload


def validate_mission(payload: dict[str, Any], connection: str) -> list[str]:
    warnings: list[str] = []
    if payload.get("schema") != "lifelink.sitl.mission.v1":
        raise MissionValidationError("Unsupported mission schema.")
    if payload.get("simulated") is not True:
        raise MissionValidationError(
            "Refusing a mission that is not explicitly marked simulated. This bridge is SITL-only."
        )
    if not str(payload.get("missionCode") or "").strip():
        raise MissionValidationError("Mission code is required.")
    route = payload.get("route")
    if not isinstance(route, list) or len(route) < 2:
        raise MissionValidationError("At least two route waypoints are required.")
    for index, point in enumerate(route):
        if not isinstance(point, dict):
            raise MissionValidationError(f"Waypoint {index} is not an object.")
        lat = point.get("latitude_deg")
        lng = point.get("longitude_deg")
        if not isinstance(lat, (int, float)) or not -90 <= lat <= 90:
            raise MissionValidationError(f"Waypoint {index} has an invalid latitude.")
        if not isinstance(lng, (int, float)) or not -180 <= lng <= 180:
            raise MissionValidationError(f"Waypoint {index} has an invalid longitude.")
    payload_spec = payload.get("payload")
    if not isinstance(payload_spec, dict):
        raise MissionValidationError("Payload metadata is required.")
    if not isinstance(payload_spec.get("massKg"), (int, float)) or payload_spec["massKg"] <= 0:
        raise MissionValidationError("Payload mass must be positive.")
    authorization = payload.get("authorization")
    if not isinstance(authorization, dict):
        raise MissionValidationError("Authorization metadata is required.")
    if authorization.get("routeAuthorized") is not True:
        raise MissionValidationError(
            "The route is not authorized for this simulation. Resolve preflight before exporting."
        )
    if authorization.get("simulated") is not True:
        raise MissionValidationError("The authorization record must be explicitly simulated.")
    if not re.match(r"^udp://(?:localhost|127\.0\.0\.1)?(?::\d+)?/?$", connection):
        raise MissionValidationError(
            "Only loopback/unspecified UDP SITL connections are accepted by this bridge."
        )
    if not payload.get("flightController") in {"px4", "ardupilot"}:
        raise MissionValidationError("flightController must be px4 or ardupilot.")
    warnings.append(
        "SITL-only validation. This does not establish airworthiness, regulatory approval or clinical payload safety."
    )
    return warnings


async def upload_to_sitl(payload: dict[str, Any], connection: str) -> None:
    try:
        from mavsdk import System
        from mavsdk.mission import MissionItem, MissionPlan
    except ImportError as error:
        raise RuntimeError(
            "MAVSDK is not installed. Install drone_bridge/requirements-sitl.txt and "
            "start PX4/ArduPilot SITL before using --confirm SITL."
        ) from error

    drone = System()
    await drone.connect(system_address=connection)
    print(f"Connecting to SITL at {connection}…")
    async for state in drone.core.connection_state():
        if state.is_connected:
            print("SITL connected. Uploading mission…")
            break

    items = []
    for point in payload["route"]:
        items.append(
            MissionItem(
                latitude_deg=float(point["latitude_deg"]),
                longitude_deg=float(point["longitude_deg"]),
                relative_altitude_m=30.0,
                speed_m_s=8.0,
                is_fly_through=True,
                gimbal_pitch_deg=0.0,
                gimbal_yaw_deg=0.0,
                camera_action=MissionItem.CameraAction.NONE,
                loiter_time_s=0.0,
                camera_photo_interval_s=0.0,
                acceptance_radius_m=2.0,
                yaw_deg=0.0,
                camera_photo_distance_m=0.0,
            )
        )
    await drone.mission.upload_mission(MissionPlan(items))
    print("Mission uploaded. Arming only after explicit --confirm SITL was supplied.")
    await drone.action.arm()
    await drone.action.takeoff()
    await drone.mission.start_mission()
    print("SITL mission started. Monitor telemetry in the PX4/ArduPilot console.")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mission", type=Path)
    parser.add_argument("--connection", default="udp://:14540")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate and print the high-level mission without importing MAVSDK.",
    )
    parser.add_argument(
        "--confirm",
        choices=["SITL"],
        help="Required to upload to a loopback SITL instance.",
    )
    args = parser.parse_args(argv)

    try:
        payload = load_mission(args.mission)
        warnings = validate_mission(payload, args.connection)
    except MissionValidationError as error:
        print(f"REFUSED: {error}", file=sys.stderr)
        return 2

    route = payload["route"]
    print(
        json.dumps(
            {
                "mission": payload["missionCode"],
                "flight_controller": payload["flightController"],
                "simulated": True,
                "connection": args.connection,
                "waypoints": len(route),
                "payload_kg": payload["payload"]["massKg"],
                "warnings": warnings,
            },
            indent=2,
        )
    )
    if args.dry_run:
        return 0
    if args.confirm != "SITL":
        print(
            "REFUSED: real upload requires --confirm SITL. This bridge never targets real aircraft.",
            file=sys.stderr,
        )
        return 2
    try:
        asyncio.run(upload_to_sitl(payload, args.connection))
    except Exception as error:
        print(f"SITL upload failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

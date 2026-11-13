#!/usr/bin/env python3
"""Upload a LifeLink *simulated* mission to PX4/ArduPilot SITL.

This bridge is intentionally not a production flight-control service:

* it accepts only `lifelink.sitl.mission.v1` exports marked `simulated: true`;
* it accepts only loopback/unspecified UDP SITL connections;
* it requires an explicit `--confirm SITL` before arming;
* it enforces a geometric fence, payload/altitude bounds and mission freshness;
* it refuses to replay a mission code that was already uploaded (state ledger);
* it writes an append-only command audit log without patient/donor data;
* it does not implement BVLOS, detect-and-avoid, airspace authorization or
  payload-release commands for real aircraft.

MAVSDK is optional and only imported after dry-run validation. A real
deployment requires aviation approval, a validated operator, a real aircraft
adapter and operational safety procedures. Do not point this at real hardware.
"""

from __future__ import annotations

import argparse
import asyncio
import hmac
import json
import math
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCHEMA = "lifelink.sitl.mission.v1"
MAX_WAYPOINTS = 64
MAX_PAYLOAD_KG = 25.0
MAX_PAYLOAD_UNITS = 20
MIN_ALTITUDE_M = 5.0
MAX_ALTITUDE_M = 120.0
DEFAULT_MAX_RADIUS_KM = 60.0
DEFAULT_MAX_AGE_MINUTES = 60.0


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


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    radius = 6371.0
    d_lat = math.radians(lat2 - lat1)
    d_lng = math.radians(lng2 - lng1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(d_lng / 2) ** 2
    )
    return 2 * radius * math.asin(min(1.0, math.sqrt(a)))


def _max_radius_km() -> float:
    try:
        value = float(os.environ.get("DRONE_MAX_RADIUS_KM", DEFAULT_MAX_RADIUS_KM))
    except ValueError:
        value = DEFAULT_MAX_RADIUS_KM
    return max(1.0, min(500.0, value))


def _max_age_minutes() -> float:
    try:
        value = float(os.environ.get("DRONE_MAX_MISSION_AGE_MINUTES", DEFAULT_MAX_AGE_MINUTES))
    except ValueError:
        value = DEFAULT_MAX_AGE_MINUTES
    return max(1.0, min(24 * 60.0, value))


def validate_mission(
    payload: dict[str, Any],
    connection: str,
    *,
    now: datetime | None = None,
) -> list[str]:
    warnings: list[str] = [
        "SITL-only validation. This does not establish airworthiness, regulatory approval or clinical payload safety."
    ]
    if payload.get("schema") != SCHEMA:
        raise MissionValidationError("Unsupported mission schema.")
    if payload.get("simulated") is not True:
        raise MissionValidationError(
            "Refusing a mission that is not explicitly marked simulated. This bridge is SITL-only."
        )
    mission_code = str(payload.get("missionCode") or "").strip()
    if not mission_code:
        raise MissionValidationError("Mission code is required.")
    if len(mission_code) > 64 or not re.match(r"^[A-Za-z0-9._:-]+$", mission_code):
        raise MissionValidationError("Mission code contains unsupported characters.")

    route = payload.get("route")
    if not isinstance(route, list) or len(route) < 2:
        raise MissionValidationError("At least two route waypoints are required.")
    if len(route) > MAX_WAYPOINTS:
        raise MissionValidationError(f"Routes are limited to {MAX_WAYPOINTS} waypoints.")
    coords: list[tuple[float, float]] = []
    for index, point in enumerate(route):
        if not isinstance(point, dict):
            raise MissionValidationError(f"Waypoint {index} is not an object.")
        lat = point.get("latitude_deg")
        lng = point.get("longitude_deg")
        if not isinstance(lat, (int, float)) or not -90 <= lat <= 90:
            raise MissionValidationError(f"Waypoint {index} has an invalid latitude.")
        if not isinstance(lng, (int, float)) or not -180 <= lng <= 180:
            raise MissionValidationError(f"Waypoint {index} has an invalid longitude.")
        altitude = point.get("relative_altitude_m")
        if altitude is not None and (
            not isinstance(altitude, (int, float))
            or not MIN_ALTITUDE_M <= altitude <= MAX_ALTITUDE_M
        ):
            raise MissionValidationError(
                f"Waypoint {index} altitude must be between {MIN_ALTITUDE_M:.0f} and "
                f"{MAX_ALTITUDE_M:.0f} m for this simulation."
            )
        coords.append((float(lat), float(lng)))

    origin = coords[0]
    max_radius = _max_radius_km()
    for index, (lat, lng) in enumerate(coords):
        distance = _haversine_km(origin[0], origin[1], lat, lng)
        if distance > max_radius:
            raise MissionValidationError(
                f"Waypoint {index} is {distance:.1f} km from the first waypoint, "
                f"outside the {max_radius:.0f} km simulation fence."
            )

    payload_spec = payload.get("payload")
    if not isinstance(payload_spec, dict):
        raise MissionValidationError("Payload metadata is required.")
    mass = payload_spec.get("massKg")
    if not isinstance(mass, (int, float)) or mass <= 0:
        raise MissionValidationError("Payload mass must be positive.")
    if mass > MAX_PAYLOAD_KG:
        raise MissionValidationError(
            f"Payload mass {mass} kg exceeds the {MAX_PAYLOAD_KG:.0f} kg simulation limit."
        )
    units = payload_spec.get("units")
    if units is not None and (
        not isinstance(units, int) or not 1 <= units <= MAX_PAYLOAD_UNITS
    ):
        raise MissionValidationError(
            f"Payload units must be a whole number between 1 and {MAX_PAYLOAD_UNITS}."
        )

    authorization = payload.get("authorization")
    if not isinstance(authorization, dict):
        raise MissionValidationError("Authorization metadata is required.")
    if authorization.get("routeAuthorized") is not True:
        raise MissionValidationError(
            "The route is not authorized for this simulation. Resolve preflight before exporting."
        )
    if authorization.get("simulated") is not True:
        raise MissionValidationError("The authorization record must be explicitly simulated.")

    issued_at = payload.get("issuedAt")
    if issued_at is not None:
        try:
            issued = datetime.fromisoformat(str(issued_at).replace("Z", "+00:00"))
        except ValueError as error:
            raise MissionValidationError("issuedAt must be an ISO-8601 timestamp.") from error
        if issued.tzinfo is None:
            issued = issued.replace(tzinfo=timezone.utc)
        reference = now or datetime.now(timezone.utc)
        age_minutes = (reference - issued).total_seconds() / 60.0
        if age_minutes > _max_age_minutes() or age_minutes < -5:
            raise MissionValidationError(
                "This mission export is stale or not yet valid. Export it again before uploading."
            )
    else:
        warnings.append(
            "Mission export has no issuedAt timestamp, so replay freshness cannot be enforced by age."
        )

    if not re.match(r"^udp://(?:localhost|127\.0\.0\.1)?(?::\d+)?/?$", connection):
        raise MissionValidationError(
            "Only loopback/unspecified UDP SITL connections are accepted by this bridge."
        )
    if not payload.get("flightController") in {"px4", "ardupilot"}:
        raise MissionValidationError("flightController must be px4 or ardupilot.")
    return warnings


# ---------------------------------------------------------------------------
# Replay ledger and command audit log
# ---------------------------------------------------------------------------


def state_dir() -> Path:
    configured = os.environ.get("DRONE_BRIDGE_STATE_DIR")
    directory = Path(configured) if configured else Path.home() / ".lifelink-sitl"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _ledger_path() -> Path:
    return state_dir() / "consumed-missions.json"


def _read_ledger() -> dict[str, str]:
    path = _ledger_path()
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def is_replayed(mission_code: str) -> bool:
    return str(mission_code) in _read_ledger()


def record_consumed(mission_code: str, connection: str) -> None:
    ledger = _read_ledger()
    ledger[str(mission_code)] = datetime.now(timezone.utc).isoformat()
    path = _ledger_path()
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(ledger, indent=2, sort_keys=True), encoding="utf-8")
    temporary.replace(path)
    audit("uploaded", mission_code, connection)


def audit(decision: str, mission_code: str, connection: str) -> None:
    """Append an identifier-free command audit record."""
    record = {
        "at": datetime.now(timezone.utc).isoformat(),
        "decision": decision,
        "mission_code": mission_code,
        "connection": connection,
    }
    try:
        with (state_dir() / "sitl-audit.log").open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, sort_keys=True) + "\n")
    except OSError:
        # Auditing must not silently disable the safety refusal path.
        print("WARNING: could not write the SITL audit log.", file=sys.stderr)


def require_bridge_token(token: str | None) -> None:
    expected = os.environ.get("DRONE_BRIDGE_TOKEN")
    if not expected:
        return
    if not token or not hmac.compare_digest(token, expected):
        raise MissionValidationError(
            "DRONE_BRIDGE_TOKEN is configured; supply the matching --token value to upload."
        )


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
                relative_altitude_m=float(point.get("relative_altitude_m", 30.0)),
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
        "--force",
        action="store_true",
        help="Allow re-uploading a mission code already recorded in the local ledger (simulation only).",
    )
    parser.add_argument(
        "--token",
        default=None,
        help="Bridge token; required only when DRONE_BRIDGE_TOKEN is set.",
    )
    parser.add_argument(
        "--confirm",
        choices=["SITL"],
        help="Required to upload to a loopback SITL instance.",
    )
    args = parser.parse_args(argv)

    mission_code = "unknown"
    try:
        payload = load_mission(args.mission)
        mission_code = str(payload.get("missionCode") or "unknown")[:64]
        warnings = validate_mission(payload, args.connection)
    except MissionValidationError as error:
        print(f"REFUSED: {error}", file=sys.stderr)
        audit("rejected", mission_code, args.connection)
        return 2

    mission_code = str(payload["missionCode"])
    replay = is_replayed(mission_code)
    if replay and not args.force:
        print(
            f"REFUSED: mission {mission_code} was already uploaded. Exports are single-use; "
            "re-export the mission or pass --force for a deliberate simulation retry.",
            file=sys.stderr,
        )
        audit("refused_replay", mission_code, args.connection)
        return 2

    route = payload["route"]
    print(
        json.dumps(
            {
                "mission": mission_code,
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
        audit("dry_run_ok", mission_code, args.connection)
        return 0
    if args.confirm != "SITL":
        print(
            "REFUSED: real upload requires --confirm SITL. This bridge never targets real aircraft.",
            file=sys.stderr,
        )
        audit("refused_no_confirm", mission_code, args.connection)
        return 2
    try:
        require_bridge_token(args.token)
    except MissionValidationError as error:
        print(f"REFUSED: {error}", file=sys.stderr)
        audit("refused_token", mission_code, args.connection)
        return 2
    try:
        asyncio.run(upload_to_sitl(payload, args.connection))
    except Exception as error:
        print(f"SITL upload failed: {error}", file=sys.stderr)
        audit("upload_failed", mission_code, args.connection)
        return 1
    record_consumed(mission_code, args.connection)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

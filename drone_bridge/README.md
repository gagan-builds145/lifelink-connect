# LifeLink SITL drone bridge

This directory contains the optional **PX4/ArduPilot Software-in-the-Loop**
adapter for missions planned and exported by LifeLink's Drone Operations UI.

It is deliberately separate from the web app and is **not** a real aircraft
command path. The app's mission telemetry stays simulated unless this bridge is
run explicitly against a local SITL instance. No SITL process is installed or
executed in this repository's verification environment, so the upload path is
**unverified** and no SITL result is claimed.

## Export a mission

1. Open `/drones` as an administrator or drone operator.
2. Select a mission.
3. Use **SITL JSON** to download `DRM-xxxx-sitl-mission.json`.

The export contains the route, payload metadata, flight controller and the
explicit simulated authorization record. It does not contain a real aviation
authorization.

## Validate without connecting anything

```powershell
python drone_bridge/sitl_bridge.py path\to\DRM-0001-sitl-mission.json --dry-run
```

Validation rejects:

- missions not marked `simulated: true`;
- routes with fewer than two waypoints;
- unauthorized routes;
- non-loopback connections;
- unsupported schemas.

## Run against local SITL only

Prerequisites:

- PX4-Autopilot or ArduPilot SITL installed and running locally;
- MAVSDK Python installed (`pip install -r drone_bridge/requirements-sitl.txt`);
- a simulator vehicle on `udp://:14540` (adjust with `--connection` if needed).

```powershell
# Terminal 1: start the simulator yourself using the PX4/ArduPilot instructions.
# Example PX4 command (run inside a PX4-Autopilot checkout):
# make px4_sitl gz_x500

# Terminal 2:
python drone_bridge/sitl_bridge.py path\to\DRM-0001-sitl-mission.json --confirm SITL
```

The bridge uploads the waypoint mission, arms, takes off and starts the
mission. It never commands a payload release and never writes delivery
confirmation back into LifeLink; receipt must still be confirmed by the
receiving facility in the app.

## Safety boundary

Do **not** modify this bridge to target real aircraft without:

- aviation-authority approvals and airspace authorization;
- a validated operator, aircraft and remote pilot;
- validated cold-chain payload handling;
- geofencing, detect-and-avoid, return-to-home and emergency procedures;
- independent safety review and incident response.

This software is not certified aviation or medical software.

# Sample Datasets

> **Synthetic test data.** Nothing below represents live inventory, a real hospital commitment or a real donor. The seeded application data is marked `isDemo: true` and labelled in the UI.

## 1. Facilities (3 hospitals, 5 supply facilities)

```json
[
  { "orgId": "DEMO-HOSP-001", "name": "Sassoon General Hospital (Synthetic)", "type": "hospital", "city": "Pune", "latitude": 18.5204, "longitude": 73.8567, "status": "verified", "transferAuthorized": true, "autoAllocate": true, "protectedReserveDefault": 2 },
  { "orgId": "DEMO-HOSP-002", "name": "KEM Hospital (Synthetic)", "type": "hospital", "city": "Pune", "latitude": 18.5018, "longitude": 73.8636, "status": "verified", "transferAuthorized": true, "autoAllocate": true, "protectedReserveDefault": 2 },
  { "orgId": "DEMO-HOSP-003", "name": "Mumbai Central Hospital (Synthetic)", "type": "hospital", "city": "Mumbai", "latitude": 19.076, "longitude": 72.8777, "status": "verified", "transferAuthorized": true, "autoAllocate": false, "protectedReserveDefault": 3 },
  { "orgId": "DEMO-BB-001", "name": "Sahyadri Blood Bank (Synthetic)", "type": "blood_bank", "city": "Pune", "latitude": 18.5158, "longitude": 73.8798, "status": "verified", "transferAuthorized": true, "autoAllocate": true, "protectedReserveDefault": 1 },
  { "orgId": "DEMO-BB-002", "name": "Deccan Blood Centre (Synthetic)", "type": "blood_bank", "city": "Pune", "latitude": 18.5089, "longitude": 73.8407, "status": "verified", "transferAuthorized": true, "autoAllocate": true, "protectedReserveDefault": 1 },
  { "orgId": "DEMO-RC-001", "name": "Red Cross Society — Pune Branch (Synthetic)", "type": "red_cross", "city": "Pune", "latitude": 18.5314, "longitude": 73.8446, "status": "verified", "transferAuthorized": true, "autoAllocate": true, "protectedReserveDefault": 1 },
  { "orgId": "DEMO-RC-002", "name": "Red Cross Society — Mumbai Branch (Synthetic)", "type": "red_cross", "city": "Mumbai", "latitude": 19.0176, "longitude": 72.8562, "status": "verified", "transferAuthorized": true, "autoAllocate": true, "protectedReserveDefault": 1 },
  { "orgId": "DEMO-BB-003", "name": "Nashik Regional Blood Bank (Synthetic)", "type": "blood_bank", "city": "Nashik", "latitude": 19.9975, "longitude": 73.7898, "status": "verified", "transferAuthorized": true, "autoAllocate": false, "protectedReserveDefault": 2 }
]
```

## 2. Inventory batches

```json
[
  { "batchRef": "DEMO-B-1001", "organizationId": "DEMO-BB-001", "bloodGroup": "O-", "component": "red_cells", "unitsAvailable": 8, "unitsReserved": 0, "protectedReserve": 2, "collectionDate": "2026-10-18", "expiryDate": "2026-12-10", "storageLocation": "Cold room A", "storageTempC": 4, "verified": true, "screened": true, "released": true, "isDemo": true },
  { "batchRef": "DEMO-B-1002", "organizationId": "DEMO-BB-001", "bloodGroup": "O+", "component": "red_cells", "unitsAvailable": 12, "unitsReserved": 2, "protectedReserve": 2, "collectionDate": "2026-10-20", "expiryDate": "2026-12-12", "storageLocation": "Cold room A", "storageTempC": 4, "verified": true, "screened": true, "released": true, "isDemo": true },
  { "batchRef": "DEMO-B-1003", "organizationId": "DEMO-BB-002", "bloodGroup": "A+", "component": "red_cells", "unitsAvailable": 4, "unitsReserved": 0, "protectedReserve": 1, "collectionDate": "2026-10-25", "expiryDate": "2026-11-10", "storageLocation": "Fridge 2", "storageTempC": 3, "verified": true, "screened": true, "released": true, "isDemo": true },
  { "batchRef": "DEMO-B-1004", "organizationId": "DEMO-RC-001", "bloodGroup": "AB+", "component": "plasma", "unitsAvailable": 6, "unitsReserved": 0, "protectedReserve": 1, "collectionDate": "2026-09-30", "expiryDate": "2027-03-30", "storageLocation": "Plasma freezer", "storageTempC": -30, "verified": true, "screened": true, "released": true, "isDemo": true },
  { "batchRef": "DEMO-B-1005", "organizationId": "DEMO-RC-002", "bloodGroup": "B+", "component": "platelets", "unitsAvailable": 5, "unitsReserved": 1, "protectedReserve": 1, "collectionDate": "2026-11-06", "expiryDate": "2026-11-11", "storageLocation": "Agitator 1", "storageTempC": 22, "verified": true, "screened": true, "released": true, "isDemo": true },
  { "batchRef": "DEMO-B-1006", "organizationId": "DEMO-BB-003", "bloodGroup": "O-", "component": "red_cells", "unitsAvailable": 10, "unitsReserved": 0, "protectedReserve": 4, "collectionDate": "2026-10-01", "expiryDate": "2026-12-20", "storageLocation": "Cold room B", "storageTempC": 5, "verified": true, "screened": true, "released": true, "isDemo": true },
  { "batchRef": "DEMO-B-1007", "organizationId": "DEMO-BB-002", "bloodGroup": "O+", "component": "red_cells", "unitsAvailable": 3, "unitsReserved": 0, "protectedReserve": 0, "collectionDate": "2026-10-02", "expiryDate": "2026-10-30", "storageLocation": "Fridge 1", "storageTempC": 4, "verified": true, "screened": true, "released": true, "isDemo": true },
  { "batchRef": "DEMO-B-1008", "organizationId": "DEMO-RC-001", "bloodGroup": "A-", "component": "red_cells", "unitsAvailable": 2, "unitsReserved": 0, "protectedReserve": 0, "collectionDate": "2026-10-12", "expiryDate": "2026-11-14", "storageLocation": "Cold room A", "storageTempC": 4, "verified": true, "screened": false, "released": false, "isDemo": true }
]
```

Expected behaviours:

- `DEMO-B-1007` is expired relative to 2026-11-08 and must never allocate.
- `DEMO-B-1008` is unreleased and must never allocate.
- `DEMO-B-1003` should be prioritised for an A+ red-cell need (near expiry, but eligible).
- `DEMO-B-1001` has only 6 allocatable units after its protected reserve.
- `DEMO-B-1006` is outside Pune and should fail a routine city search; it can appear only under an emergency scope.

## 3. Drone fixture

```json
{
  "base": { "name": "Sahyadri drone base (Synthetic)", "city": "Pune", "latitude": 18.5158, "longitude": 73.8798, "organizationId": "DEMO-BB-001" },
  "drones": [
    { "droneId": "DEMO-DRN-01", "model": "AeroMed S2 (Simulated)", "maxPayloadKg": 4, "batteryCapacityWh": 850, "maxRangeKm": 32, "cruiseSpeedKmh": 54, "batteryPct": 94, "flightController": "px4", "maintenanceStatus": "ok" },
    { "droneId": "DEMO-DRN-02", "model": "AeroMed S2 (Simulated)", "maxPayloadKg": 4, "batteryCapacityWh": 850, "maxRangeKm": 32, "cruiseSpeedKmh": 54, "batteryPct": 61, "flightController": "ardupilot", "maintenanceStatus": "due" }
  ],
  "restrictedZone": { "name": "Pune airfield control area (Synthetic)", "centerLat": 18.582, "centerLng": 73.919, "radiusKm": 2.4, "source": "simulated" }
}
```

No aircraft exists. These records exercise payload, energy, preflight and restricted-zone rules only.

## 4. Donor fixture

```json
[
  { "donorId": "DEMO-D-001", "city": "Pune", "bloodGroup": "O-", "available": true, "lastDonationDate": null, "shareLocationConsent": true, "consentHours": 24 },
  { "donorId": "DEMO-D-002", "city": "Pune", "bloodGroup": "O+", "available": true, "lastDonationDate": "2026-10-30", "shareLocationConsent": true, "consentHours": 24 },
  { "donorId": "DEMO-D-003", "city": "Mumbai", "bloodGroup": "A-", "available": false, "lastDonationDate": "2026-06-01", "shareLocationConsent": false }
]
```

`DEMO-D-002` fails the 90-day interval guidance. `DEMO-D-003` fails availability, consent and routine city scope. A donor is never inventory.

## 5. Loading the real demo seed

```bash
bunx convex run demo:seed
```

Seeded records are synthetic, idempotent and labelled `Demo` in the interface.

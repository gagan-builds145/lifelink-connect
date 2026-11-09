# Backup and recovery plan

This is a production runbook template. No production backup or restore drill has
been executed in this workspace.

## Recovery objectives

Set these with the clinical and operations owners before go-live:

| System | Suggested RPO | Suggested RTO | Notes |
| --- | --- | --- | --- |
| Convex database | 15 minutes or better | 4 hours | Requests, inventory, reservations, audit logs |
| ML artifacts and metadata | 24 hours | 4 hours | Rebuildable from training data if a versioned copy is retained |
| Convex environment/secrets | On every change | 1 hour | Store encrypted in a secret manager, never Git |
| Frontend build | Every release | 1 hour | Static host rollback to the previous artifact |
| SITL bridge configuration | Every change | 4 hours | Not a production flight system |

## What must be backed up

1. Convex production database, including `inventory`, `inventoryReservations`,
   `transfers`, `bloodRequests`, `donorInvitations`, `auditLogs`,
   `notificationJobs`, `demandForecasts` and `anomalyEvents`.
2. ML artifact directory: `demand_model.json`, donor/Anomaly joblib files,
   metadata, `versions/` and `training-summary.json`.
3. The exact ML image digest and Python requirements lock/commit.
4. Environment variable **names** and encrypted values for Convex, ML, Resend,
   Twilio and facility adapters.
5. The last known-good frontend build and its `VITE_CONVEX_URL`.

## Convex backup procedure

Use the backup/export capability available in the production Convex plan. The
exact command depends on the selected plan; confirm it in the Convex dashboard
before go-live.

- Take a full backup before every schema deployment and before bulk imports.
- Export audit logs separately if the plan's retention is shorter than policy.
- Store backups encrypted, in a separate account/project, with access logging.
- Record the deployment name, schema commit and export timestamp.

## ML backup and rollback

- Copy the complete `artifacts/` directory after every approved training run.
- Keep at least the current and previous promoted versions.
- Roll back by restoring the artifact directory and restarting the ML container;
  do not hand-edit metadata.
- The Convex `mlModels` registry is the record of approved versions. A model file
  without matching metadata is not approved for use.
- If artifacts are lost, retrain from the approved dataset and re-run evaluation
  before promotion. Do not substitute different metrics.

## Restore drill

Run this before go-live and at least quarterly:

1. Restore a backup into a non-production Convex deployment.
2. Verify counts for inventory batches, active reservations, requests, transfers,
   invitations and audit rows.
3. Verify no held/reserved unit is double-counted and every active reservation
   points to a valid request.
4. Restore ML artifacts and confirm `/health` reports all three models ready.
5. Run the smoke flow: sign in, mock inventory sync, request, allocate, dispatch,
   receive, donor invitation, notification fallback, simulated mission.
6. Record elapsed time, data loss window, failures and corrective actions.

## Failure handling

- **Database restore:** freeze writes, notify operations, restore to a clean
  deployment, reconcile reservations before reopening allocation.
- **ML loss:** keep allocation and reservations running; donor invitations use
  distance-only fallback until `/health` and model metadata are restored.
- **Notification provider loss:** in-app notifications remain; jobs record
  failures/skips and can be replayed after credentials are fixed.
- **Hospital connector loss:** stop the integration schedule, mark it failed and
  do not import partial inventory. Reconcile through audited adjustments.

No restore operation should delete or rewrite ledger history.

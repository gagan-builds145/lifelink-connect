# LifeLink — Smart Blood Donation Management & Emergency Blood Matching System

> **Donate Blood, Save Lives. Every Second Matters.**

LifeLink connects blood donors, requestors, authorized Red Cross Society branches, participating blood banks and hospitals through one shared, verified workflow: request → document review → compatibility-aware matching → stock reservation → dispatch → receipt.

This repository is a **working buildathon application**, not a set of screenshots. Four role-specific dashboards read and write the same Convex database.

---

## 1. What is implemented

| Area | Status |
| --- | --- |
| Public homepage (hero, emergency, search, workflow, services, awareness, impact, about, contact, footer) | ✅ |
| Email verification login / signup / recovery flow | ✅ passwordless OTP |
| Four-role selection with server-assigned roles | ✅ |
| Donor registration, unique Donor ID, availability, privacy, history, camps, nearby requests, offers | ✅ |
| Requestor registration, request form, document upload, unique Request ID, timeline, cancellation | ✅ |
| Red Cross request verification, inventory, transactions, alerts, camps, donors, analytics, audit trail | ✅ |
| Hospital requests, dispatch → receipt confirmation, partner availability | ✅ |
| Shared request/inventory records across dashboards | ✅ |
| Transactional stock reservation, dispatch and receipt | ✅ Convex mutations |
| Rules-based matching with visible reasons + "ML not connected" label | ✅ |
| In-app notifications | ✅ |
| Document storage with server-side permission checks | ✅ Convex file storage |
| Demo Data | ✅ labelled and idempotent |
| Privacy / Terms / 404 / protected request detail | ✅ |
| Blood-domain rule checks | ✅ `bun run check:blood` |
| Automated browser/end-to-end suite | ❌ not included (see limitations) |

---

## 2. Stack and deliberate deviations from the brief

The build environment for this project is a **Freebuff/Vly React + Vite + Convex** workspace. It does not support running a separate Next.js/Flask server. The brief allows "React" as the frontend framework and offers implementation choices where practical. The following substitutions were made deliberately and are enforced consistently:

| Brief | Implemented | Why / notes |
| --- | --- | --- |
| Next.js App Router + Flask REST API | **React 19 + Vite + React Router 7 + Convex functions** | Convex is the managed backend/database already provisioned for this workspace. All authorization and business logic run server-side in `src/convex/`, not in the browser. |
| MySQL or Firebase | **Convex database** | Single primary database. Relational-style tables, indexes, atomic mutations. No second database is used. |
| Email + password, password hash, reset link | **Passwordless email OTP with server-validated sessions** | More secure than a prototype password flow: no password hash to leak, no reset-token flow. Recovery uses a fresh OTP. A successful registration keeps the verified session and redirects to the role dashboard instead of sending the user back to login. No password-strength UI is shown because no password is collected. |
| Flask/Next API routes | **Convex query/mutation API** | Every protected endpoint checks the signed-in user, role and organization. Public-safe queries are explicitly separated. |
| Uploaded prescriptions | **Convex private file storage + metadata table** | File type/size validated against the stored object; signed URLs generated only after permission checks. |
| Trained ML model | **Deterministic rules baseline** | The UI explicitly says "ML model not connected". No fake predictions are generated. The scoring module is isolated in `src/lib/blood.ts` for a later model. |
| Email/SMS notifications | **In-app notifications** | Outbound email/SMS is not configured. OTP emails depend on the Freebuff integrations gateway. The contact form states that no outbound copy is sent. |
| Animated auth background video | **Bundled generated loop + configurable override + CSS fallback** | A 10-second, 54 KB procedurally generated abstract loop is bundled at `public/media/auth-bg.mp4`; replace it or set `VITE_AUTH_BG_VIDEO_URL`. The dark overlay and CSS fallback always render if the video cannot load. |

---

## 3. Architecture

```
src/
  lib/
    blood.ts          # Shared constants, ABO/Rh component rules, scoring, guidance
    roles.ts          # Role labels + dashboard destinations
  convex/             # Server-side backend (the source of truth)
    schema.ts         # All tables + indexes
    validators.ts     # Shared Convex validators
    lib/helpers.ts    # requireUser / requireRole / organization checks, IDs, rate limits, notifications, audit
    profiles.ts       # Registration, server-assigned roles, profile queries
    requests.ts       # Request lifecycle, verification, reservation, dispatch, receipt, donor offers
    inventory.ts      # Stock, transactional movements, alerts, public-safe search
    donors.ts         # Donor directory, donation recording, history
    camps.ts          # Camps, registrations, camp donation recording
    matching.ts       # Explainable rules-based candidate ranking
    documents.ts      # Upload URLs, metadata validation, signed access
    notifications.ts  # In-app notification inbox
    stats.ts          # Public impact metrics + staff analytics + audit trail
    demo.ts           # Idempotent, labelled Demo Data
    contact.ts        # Validated, rate-limited contact messages
  components/         # Design system, auth shell, dashboard shell, forms
  pages/              # Public pages, auth/signup, four dashboards, request detail
```

### Shared data model highlights

- `users` — auth identity + **server-assigned** role (`donor`, `requestor`, `red_cross`, `hospital`, `admin`).
- `donorProfiles`, `requestorProfiles` — unique IDs generated with an atomic counter (`LL-D-0001`, `LL-P-0001`).
- `organizations` — Red Cross, hospital and blood-bank profiles with verification state.
- `inventory` + `inventoryTransactions` — batch stock and an attributed movement ledger (reserve, release, dispatch, receipt, adjustment, expiry).
- `inventoryReservations` — per-request allocation of held units against a specific batch, so dispatch consumes the exact units reserved for that request and release returns them cleanly.
- `bloodRequests` + `requestStatusHistory` — one shared request record with full timeline.
- `donorOffers`, `donations`, `bloodCamps`, `campRegistrations`.
- `documentMetadata` — private storage metadata.
- `notifications`, `auditLogs`, `contactMessages`, `counters`, `rateLimits`.

### Consistency guarantees

- **Convex mutations are serializable transactions.** Reservation checks free units and increments `unitsReserved` in the same mutation, so two staff members cannot oversell one batch.
- Reservation writes an `inventoryReservations` row for the exact batch. Dispatch consumes those allocations (oldest first), decrements both `unitsAvailable` and `unitsReserved`, writes one `dispatch` transaction per batch, and updates the request and notifications in the same mutation. A batch fully reserved by several requests can therefore still be dispatched correctly.
- Authorized staff can release a reservation before dispatch; the units return to `unitsAvailable` availability (the batch's `unitsReserved` is decremented) and a `release` ledger row is written.
- Receipt is restricted to the hospital that owns the request (`hospitalOrgId`) and is only possible after dispatch.
- Negative inventory is rejected at the mutation boundary.
- Every stock and status change writes an audit event with actor role and timestamp.

### Authorization model

- Roles are assigned **only** by server mutations:
  - Donor and requestor registration are self-service.
  - Red Cross / hospital registration is self-service: `profiles.registerOrganization` links the verified account to a new organization and assigns the staff role. The selected browser role is never trusted.
  - There is no mutation that lets a user change their own role.
- Role and organization are re-checked on every protected query/mutation (`requireUser`, `requireRole`, `requireOrganization`).
- Hospitals see only their own or assigned requests. Requestors see only their own requests. Donors see masked compatible requests.
- Donor contact details are shared with Red Cross staff only when the donor opts in. Hospitals never receive donor contacts.
- Documents are accessible only to the uploader, authorized Red Cross staff, or the hospital involved in the request.

---

## 4. Demo Data and demo access

### Demo Data

Demo records are inserted by `convex/demo.ts`, marked `isDemo: true`, and labelled **Demo Data** everywhere they appear. They are idempotent and never presented as live inventory.

Load them from:
- the homepage search section,
- `/blood-search` → **Load demo network**,
- `/donation-camps` → **Load demo camps**,
- or the CLI: `bunx convex run demo:seed`.

The seed currently includes verified demo branches/hospitals, batches for multiple groups/components, near-expiry and low-stock examples, emergency/urgent/routine requests in several states, and upcoming camps. Demo **donor profiles are intentionally not seeded**, because donor profiles require real authenticated accounts; register a donor to test donor matching.

### Signing in

1. Open `/signup` and choose a role, or `/login`.
2. Enter an email and request the 6-digit code. OTP delivery uses the configured Freebuff email gateway.
3. If email delivery is unavailable in your environment, use **Continue as demo guest**. This creates a real anonymous Convex Auth account; you can then complete a donor/requestor profile or register an organization.
4. Red Cross and hospital sign-up need no organization code — the role form links the organization to your verified account on the server.

---

## 5. Windows 11 local setup

### Prerequisites

- Windows 11 with PowerShell or Windows Terminal
- [Git for Windows](https://git-scm.com/download/win)
- [Node.js 20+](https://nodejs.org/) (LTS) and [Bun](https://bun.sh/docs/installation)
- [VS Code](https://code.visualstudio.com/)
- A Convex account (the project already has a development deployment in the Freebuff workspace)

### Steps

```powershell
# 1. Clone the project (or open the existing folder in VS Code)
git clone <your-repository-url> lifelink
cd lifelink

# 2. Install dependencies
bun install

# 3. Create local environment values from the template
Copy-Item .env.example .env.local
notepad .env.local
```

A complete variable reference with placeholders is in [`docs/environment.md`](docs/environment.md). Fill in `.env.local` with the values from your Convex deployment:

```ini
VITE_CONVEX_URL=https://<your-deployment>.convex.cloud
CONVEX_DEPLOYMENT=dev:<your-deployment>
CONVEX_SITE_URL=https://<your-deployment>.convex.site
```

> Use the exact deployment URLs Convex prints. `CONVEX_SITE_URL` is the HTTP-actions URL (`.convex.site`), **not** the dashboard URL and not the Vite dev URL. Convex Auth also needs its generated `JWT_PRIVATE_KEY`, `JWKS` and `SITE_URL` values on the deployment; these are normally created by the Convex Auth setup already present in this project.

### Start locally

Run Convex and Vite in two terminals:

```powershell
# Terminal 1 — Convex backend + codegen
bunx convex dev

# Terminal 2 — Vite frontend
bun run dev
```

Open <http://localhost:5173>. In the Freebuff managed environment the dev server and Convex process are already running; do not start them again.

### Production build (optional, not used by the managed preview)

```powershell
bunx convex deploy
bun run build
```

Deploy only after reviewing the privacy/security limitations below.

---

## 6. Verification and testing

### Mandatory project checks

```powershell
bunx convex dev --once
bunx tsc -b --noEmit
bun run check:blood
```

`bunx convex dev --once` regenerates `src/convex/_generated` and pushes functions. Do not edit generated files by hand.

### Schema changes

Convex is the schema owner (`src/convex/schema.ts`) and applies it automatically in development; `bunx convex deploy` applies it to production. There are no SQL migration files to run. Add tables or indexes in the schema, then run `bunx convex dev --once` and `bun tsc -b --noEmit`. See [`docs/environment.md`](docs/environment.md) for the full variable inventory.

### Manual end-to-end acceptance test

Use three browser profiles (or sign out between roles):

1. **Red Cross**: `/signup/red-cross`, use the server code → Red Cross dashboard shows the branch.
2. **Hospital**: `/signup/hospital`, use the code → submit a hospital request with a PDF under 5 MB. Note the `LL-REQ-####`.
3. **Red Cross**: open the request from the verification queue → start review → approve → reserve matching batch units → dispatch. Check the movement ledger and audit trail.
4. **Hospital**: open the request → **Confirm receipt**. Status becomes `received`; the requestor and Red Cross are notified. The hospital cannot confirm receipt before dispatch, and another hospital cannot confirm it.
5. **Requestor**: create a request, cancel a pending one, upload a document and verify the timeline updates when staff verify/approve.
6. **Donor**: register, toggle availability, open a compatible request, offer to help, withdraw. Check that the donor's contact is hidden from hospitals and only visible to Red Cross if sharing is enabled.
7. **Inventory**: add a batch with a near expiry date and low threshold, verify low-stock/expiry alerts and the audit log. Try to reserve more units than are free; it must fail.
8. **Access control**: while signed in as a donor, open `/red-cross/dashboard` and `/hospital/dashboard` — you must see the role block, and direct protected calls are also rejected server-side.

### Example backend calls

Public functions can be invoked from the CLI:

```powershell
bunx convex run demo:seed
bunx convex run stats:publicOverview
bunx convex run inventory:publicStock '{"city":"Pune"}'
bunx convex run matching:compatibilityMatrix '{"component":"plasma"}'
bunx convex run camps:listPublic
```

Authenticated functions are called through the Convex client, which attaches the validated session:

```ts
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const profile = useQuery(api.profiles.me);
const createRequest = useMutation(api.requests.create);

await createRequest({
  source: "hospital",
  requestorName: "Hospital Coordinator",
  requestorType: "representative",
  requesterPhone: "02026128000",
  patientName: "Patient A",
  patientRef: "IPD-1042",
  hospitalName: "Verified Hospital",
  city: "Pune",
  bloodGroup: "O-",
  component: "red_cells",
  units: 2,
  requiredBy: Date.now() + 6 * 60 * 60 * 1000,
  urgency: "emergency",
  reason: "Post-operative haemorrhage; cross-matched units requested.",
  consent: true,
});
```

A REST-style API is not exposed. If you need one, add Convex HTTP actions in `src/convex/http.ts` and reuse the same authorization helpers; do not bypass them.

### What is not automated

The only automated code-level check is `bun run check:blood`, which asserts the red-cell and plasma ABO/Rh tables, rejection of incompatible directions, and the ranking baseline. There is no browser/end-to-end suite. The remaining checks are typechecking, Convex deployment validation, public-function CLI smoke tests, and the manual acceptance flow. Add Vitest/Playwright plus a seeded test deployment before production.

---

## 7. Security, privacy and safety

- Email OTP sessions are handled by Convex Auth; no password hashes are stored by LifeLink.
- Server-side RBAC on every mutation; role changes are impossible through profile edits.
- Security-sensitive endpoints use a database-backed rate limiter (`requests.create`, `offers`, uploads, contact form).
- Documents: PDF/JPEG/PNG only, ≤ 5 MB, storage metadata checked against the uploaded object, signed URL generated only after an access check.
- Inputs are validated on both client and server (phone, units, required date, age, expiry dates, capacity, etc.).
- Patient identity, prescriptions, donor contacts and precise addresses are never exposed in public search.
- Inventory changes and request status changes are audit logged.
- Demo Data is always labelled.
- **Medical safety:** LifeLink is advisory. ABO/Rh component rules do not guarantee compatibility. Screening, cross-matching, eligibility and final issue belong to qualified medical professionals. The UI repeats this wherever matching or eligibility is shown.

### Known limitations / incomplete integrations

1. **No outbound email/SMS notification service.** In-app notifications work. The contact form is stored but not emailed. OTP email depends on the Freebuff gateway.
2. **No trained ML model.** Matching is a deterministic baseline; the UI says so. Demand forecasting and shortage prediction are not implemented.
3. **No admin approval dashboard.** Staff registration is self-service and bound to a verified email. A production deployment should add an administrator approval workflow for staff organizations.
4. **No automated retention/deletion job.** Define legal retention schedules and implement them before production.
5. **Bundled background video is a generated abstract loop**, not licensed stock footage. Replace it with your own licensed MP4 if desired; the CSS fallback is always available.
6. **Photos/illustrations are CSS/SVG only.** No externally hosted medical images are required, avoiding broken remote assets.
7. **Single-region prototype.** Convex handles concurrency, but load, disaster recovery, backups and healthcare compliance were not load-tested.
8. **No automated test suite.** See the manual acceptance path above.

### Configuration checklist before production

- [ ] Configure a monitored contact email/phone.
- [ ] Review privacy policy, terms and retention with legal/clinical governance.
- [ ] Connect an email/SMS provider if outbound notifications are required.
- [ ] Add an administrator approval workflow for staff organizations.
- [ ] Add Playwright/Vitest coverage and a staging deployment.
- [ ] Have the blood compatibility rules reviewed and signed off by a transfusion specialist.
- [ ] Remove or explicitly gate demo data in the production deployment.

---

## 8. Required external services

| Service | Required? | Purpose |
| --- | --- | --- |
| Convex deployment | **Yes** | Database, backend functions, file storage, auth sessions |
| Convex Auth email OTP gateway (`VLY_INTEGRATION_KEY`) | **Yes for email sign-in** | Sends 6-digit codes. Guest demo access works without receiving email. |
| Background video | Optional | A generated abstract loop ships at `public/media/auth-bg.mp4`; replace it with licensed footage if preferred. CSS fallback is built in. |
| Email/SMS provider | Optional | Outbound notifications beyond the in-app inbox. Not configured. |
| Maps/geocoding provider | Optional | Distance uses seeded city coordinates, not live geocoding. |

No payment, analytics or advertising SDK is included.

---

## 9. Tech stack

React 19 · Vite 7 · TypeScript · React Router 7 · Tailwind CSS v4 · shadcn/ui · Lucide React · Framer Motion · Recharts · Convex + Convex Auth · Sonner.

All UI is responsive and uses a single medical theme: warm white surfaces, crimson `oklch(0.525 0.205 24)` accents, deep navy text, teal verification cues, rounded cards and borders (no heavy shadows), accessible status labels and reduced-motion support.

# LifeLink browser verification plan

> **Status:** not executed on the current host. No browser binary is installed,
> the Playwright cache contains only link metadata, and the disk has less than
> 10 MB free. Release archives, model artifacts, datasets and source were not
> deleted. This document is the exact procedure for a host with a browser.

## 1. Host requirements

- Node/Bun project dependencies installed (`bun install`).
- At least 1 GB free disk for Chromium and temporary screenshots.
- The real Vite app running against the real Convex development deployment.
- A reachable mail inbox for the passwordless email code, or seeded test
  accounts with known sign-in access.

```bash
cd /path/to/lifelink
bun install
bunx playwright install chromium
```

Do not install browsers into this host's full filesystem. Use a machine or
container with free space.

## 2. Start and confirm the real app

Use the project's normal managed dev server or:

```bash
bun run dev
```

Confirm the preview URL responds, then use that URL as `BASE_URL` in the tests
below. Do not mock Convex or the auth provider: the walkthrough must use the real
backend and a real browser session.

## 3. Viewports

| Device | Width × height |
| --- | --- |
| Desktop | 1440 × 900 |
| Tablet | 834 × 1112 |
| Mobile | 390 × 844 |

Capture full-page screenshots at desktop and mobile for each role dashboard,
the landing page, the logout dialog, and the one-tap ambulance tracking screen.

## 4. Authentication matrix

For each role, record the email used, the resolved URL, the dashboard heading,
refresh result and logo-click result.

| Role | Expected `/` destination |
| --- | --- |
| Donor | `/community/dashboard` |
| Requestor | `/community/dashboard` |
| Hospital | `/hospital/dashboard` |
| Red Cross | `/red-cross/dashboard` |
| Admin | `/admin/dashboard` |
| Guardian | `/guardian/dashboard` |
| Drone operations | `/drones` |
| Signed out | Public landing page |

Checks:

1. Sign in, open `/` directly, confirm the role dashboard without a landing
   flash.
2. Refresh on the dashboard; confirm the session and destination persist.
3. Click the LifeLink logo in the header, mobile menu and footer; confirm the
   role dashboard, not `/`.
4. Navigate between dashboard sections; confirm `/` is never rendered.
5. Sign out; open `/`; confirm the public landing page.
6. Open each protected dashboard while signed out; confirm redirect to `/auth`
   or `/login` with a safe `returnTo`.

## 5. Shared logout dialog

Available from the dashboard account menu, sidebar avatar, community Settings
and any other account action. The dialog must show exactly:

> Are you sure you want to log out of your LifeLink account? You will need to sign in again to access your dashboard.

Buttons: **Cancel** and **Yes, Log Out**.

For desktop and mobile:

1. Open the dialog.
2. Click Cancel — dialog closes, session remains, page state remains.
3. Reopen and press Escape — dialog closes, session remains.
4. Reopen, double-click **Yes, Log Out** — secure signout runs once, redirect
   to `/login`, protected routes reject the session.
5. Simulate signout failure (offline or stub) — an error is shown and the user
   is not falsely reported as signed out.
6. Repeat from each role's shared dashboard header.

## 6. Ambulance/GPS checks

Use an authenticated donor with no active ambulance booking.

Test with browser geolocation permissions:

- granted, Pune coordinates (simulated test data);
- denied;
- timeout;
- inaccurate fix (accuracy worse than 2 km);
- invalid coordinates via a test override.

For a granted fix:

1. Donor dashboard: **Book Ambulance** immediately below **New Blood Request**,
   with **Donate blood** after it.
2. Click it; no destination, hospital, patient or extra form appears.
3. Booking is submitted automatically and a real `AMB-` reference appears.
4. Refresh/re-click; the same active booking is reused and no duplicate exists.
5. If no approved ambulance is available, the status is honestly `searching`.
6. After a real provider becomes available, confirm re-matching and assignment
   only after provider acceptance.
7. Cancel the request and confirm it cannot be matched later.
8. Check desktop/mobile animation, reduced-motion mode, overflow and console
   errors.

The database contains no fake provider created by this verification. Re-matching
tests use the existing approved provider data only.

## 7. Visual and accessibility checks

- Landing, blood search and donation camps are reachable signed out.
- Main headings have no unnecessary description underneath; forms, validation,
  safety text and GPS instructions remain.
- Community sidebar has no Identity Verification / Blood Group section.
- Donor profile still shows the blood group; matching/compatibility screens work.
- Mobile navigation opens, closes and does not overflow.
- Keyboard: Tab through dialog, Enter activates, Escape cancels, focus returns.
- Console: record every error/warning; no blank screens or unhandled exceptions.

## 8. Evidence format

For each run record:

```text
Browser: Chromium <version>
Viewport: 1440x900 / 390x844
URL:
Role:
Pass/Fail:
Observed URL after action:
Console errors:
Network failures:
Screenshot path:
```

Store screenshots under `browser-screenshots/phase5-final/`. Do not commit
credentials, OTPs or real personal/health data.

# LifeLink browser verification

> **Status (24 Nov 2026):** Partially executed against the real Vite app and Convex
> dev deployment on this host. Public routes and protected-route redirects were
> exercised in headless Chromium; authenticated role dashboards and live
> ambulance tracking still require a real sign-in session and approved provider
> GPS feed. No mocked data was used for the checks that did run.

## Executed on this host

Environment:

- Chromium headless shell installed with `bunx playwright install --only-shell chromium`
  (full Chromium download failed with `ENOSPC`).
- Managed Vite app at `http://127.0.0.1:5173` backed by the project's Convex dev
  deployment.
- Script: `scripts/browser-public-check.mjs`.

| Check | Result |
| --- | --- |
| Landing page loads at `/` | Pass — HTTP 200, LifeLink hero heading rendered |
| Landing desktop layout, 1440×900 | Pass — no horizontal page overflow |
| Landing mobile layout, 390×844 | Pass — no horizontal page overflow |
| `/community/dashboard` signed out | Pass — redirected to `/auth?returnTo=%2Fcommunity%2Fdashboard`, sign-in form visible |
| `/ambulance` signed out, mobile | Pass — redirected to `/auth?returnTo=%2Fambulance` |
| Public `/blood-search`, mobile | Pass — page rendered |
| Landing and protected redirect screenshots | Captured under `browser-screenshots/phase5-final/` |

Screenshots:

- `landing-desktop.png` (1440×7174 full page)
- `landing-mobile.png` (390×14383 full page)
- `protected-community-redirect.png`
- `protected-ambulance-redirect-mobile.png`
- `public-blood-search-mobile.png`

### Console and network observations

- One console error is caused by the host-injected Vly toolbar trying to load
  `https://cdn.jsdelivr.net/npm/html2canvas-pro@2.0.4/dist/html2canvas-pro.min.js`,
  which the app's CSP blocks (`script-src 'self' 'unsafe-inline'
  https://*.convex.cloud https://*.convex.site`). This is a host tooling script,
  not LifeLink code. The CSP was not weakened to allow it.
- Map tile requests from Carto were reported as aborted when navigating away;
  no app-level network failure was observed.
- Screenshots were captured but could not be visually reviewed in this session.
  Layout was checked through live DOM measurements and overflow/text assertions,
  not by looking at rendered images.

## Not executed — requires a real session or provider

These could not be honestly verified here because no sign-in code or approved
provider GPS feed was available:

- Donor/requestor/hospital/Red Cross/admin/Guardian dashboard walkthroughs.
- Sidebar scrolling with a real authenticated account at short viewport heights.
- Profile editing and saving from Settings.
- Notification bell records, unread counts and privacy between real users.
- Location consent, browser permission grant/denial and later re-enable in a
  signed-in session.
- Nearby ambulance discovery against a live approved provider.
- One-tap booking, provider acceptance, live GPS movement, stale-feed handling
  and terminal cleanup with a real provider account.

Do not create demo provider records solely to make these checks pass. Use an
approved provider that is online, available and publishing real GPS updates.

## Remaining procedure

1. Sign in with a real account for each role.
2. At 1440×900, 834×1112 and 390×844, confirm the sidebar scrolls independently,
   the header/account controls stay reachable and the mobile drawer still opens.
3. Open Settings → Profile, edit permitted fields, save, reload and confirm the
   existing record was updated rather than duplicated.
4. Open the header bell; confirm real notifications, categories, timestamps,
   unread count, mark-one and mark-all, and that another user cannot see them.
5. Choose **Not Now** for location, confirm the dashboard remains usable and the
   native prompt does not appear. Then enable location later from the account
   menu; grant/deny at the browser level and record the result.
6. Signed in as the approved provider, go online, press **Share GPS** on an
   available vehicle and keep this page open. On `/ambulance`, grant a real fix
   and compare the displayed nearby count with approved online/available/fresh
   provider records. Confirm offline, busy, unapproved and stale vehicles are
   absent, and that Stop GPS removes the vehicle once its fix expires.
7. Book with one tap; confirm no destination/patient fields appear. A requested
   provider must remain distinct from an accepted provider.
8. After provider acceptance, confirm the assigned ambulance marker updates only
   from provider GPS writes, shows last-updated time, and changes to
   “Live location temporarily unavailable” when updates stop.
9. Cancel or complete the booking; confirm tracking access and coordinates are
   cleared and the provider/customer can no longer subscribe to the old booking.

## Evidence format

```text
Browser: Chromium <version>
Viewport: 1440x900 / 834x1112 / 390x844
URL:
Role:
Pass/Fail:
Observed URL after action:
Console errors:
Network failures:
Screenshot path:
```

Store new screenshots under `browser-screenshots/phase5-final/`. Do not commit
credentials, OTPs, or real personal/health data.

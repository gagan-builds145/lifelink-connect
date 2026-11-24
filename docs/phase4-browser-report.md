# Phase 4 browser verification report

Date: 2026-11-24
Browser: Playwright Chromium headless shell 1254 (installed on this host)
Base URL: `http://127.0.0.1:5173`
Script: `scripts/browser-public-check.mjs`
Evidence: `browser-screenshots/phase4-browser-report.json` and
`browser-screenshots/phase4-final/*.png`

## Executed checks

| Check | Viewport | Result |
| --- | --- | --- |
| Landing page renders, hero visible, no horizontal overflow | 1440×900 | **PASS** |
| Landing page renders, heading visible, no horizontal overflow | 390×844 | **PASS** |
| Signed-out `/community/dashboard` redirects to `/auth?returnTo=%2Fcommunity%2Fdashboard`, OTP form visible | 1440×900 | **PASS** |
| Signed-out `/ambulance` redirects to auth with return path, no horizontal overflow | 390×844 | **PASS** |
| Public blood search renders and has no horizontal overflow | 390×844 | **PASS** |

Screenshots captured:

- `landing-desktop.png`
- `landing-mobile.png`
- `protected-community-redirect.png`
- `protected-ambulance-redirect-mobile.png`
- `public-blood-search-mobile.png`

No page exceptions (`pageerror`) occurred. The auth redirects preserve the
requested path, which is the behaviour required after sign-in.

## Console and network findings

1. **CSP blocks the Vly preview screenshot library** on every inspected page:
   `https://cdn.jsdelivr.net/npm/html2canvas-pro@2.0.4/...` is rejected by
   `script-src 'self' ...`. This script is injected by the Vly preview runtime,
   not by the LifeLink application. Allowing a third-party CDN script would
   weaken the application CSP, so it was deliberately **not** changed. The app
   itself rendered and passed every functional assertion.
2. The mobile blood-search page logged aborted CARTO tile requests
   (`net::ERR_ABORTED`) because the test closes the page while map tiles are
   still loading. No application error was recorded. Tile availability also
   depends on the configured map provider/network.

## Not executed — authenticated workflows

The following required scenarios were **not executed** in a real browser because
this host has no usable authenticated OTP session or approved Guardian/provider
account:

- donor registration, login, profile and dashboard;
- Guardian registration, Donor-ID linking and onboarding;
- Guardian document upload/scan/review;
- admin approval/rejection/resubmission;
- multi-role switching;
- blood request/donor invitation workflows;
- ambulance booking, matching, cancellation and expiry;
- Guardian ambulance notifications;
- notification bell and unread counts;
- authenticated maps/Locate Me;
- authenticated mobile layouts.

Their backend authorization and lifecycle behaviour is covered by passing Convex
tests, but **that is not a browser pass**. Do not treat the automated suite as a
substitute for the list above.

## Verdict

Public desktop/mobile rendering, auth redirects and public blood search are
verified. Authenticated browser and mobile walkthroughs remain **not executed**
and are reported as blocked, not passed.

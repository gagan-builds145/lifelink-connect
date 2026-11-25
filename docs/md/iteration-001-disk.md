# disk iteration 1 — 2026-11-24

summary: 502 upstream proxy error was caused by disk exhaustion, not application code.

## chain of events

1. root filesystem hit 100% used, 0 bytes free
2. Daytona daemon failed to create session configs for the managed processes
3. managed `bun dev` and `bunx convex dev` could not start or restart cleanly
4. port 5173 had no process
5. Daytona proxy returned `502 proxy upstream error` with upstream refused

logs (relevant):
- `mkdir /root/.daytona/sessions/dev: no space left on device`
- `dial tcp 127.0.0.1:5173: connect: connection refused`

## restoration

- removed purely generated files in `/tmp` that were not project deliverables:
  - `/tmp/node-compile-cache`
  - `/tmp/*.png`
  - other stale scratch files in `/tmp`
- after that, `75M` free
- then a managed dev session needless restart after the guard, actually the existing managed sessions were already running
- after restart, services returned to health

## why space was tight

primary piles:
- `/usr/lib/node_modules` (many AI/assistant tools installed here)
- `/usr/lib/x86_64-linux-gnu`
- `/home/daytona/.bun/install/cache`
- `/home/daytona/.cache/ms-playwright/chromium_headless_shell-1254`
- `node_modules` (413M)
- `.git` (116M)
- `ml_service` (19M)

collaborative: normal sandbox process, plus installed assistant tooling and playwright chromium. this is large given a 4G boot disk.

## what we did not touch

- project source
- `lifelink-connect-2.0-final.zip`
- phase2, phase3, phase4, phase5 archives
- `node_modules`
- `.git`
- `.bun/install/cache` (kept in place; deleting it would likely trigger huge restores)
- `ms-playwright` chromium cache (kept in place; deleting it would force a costly redownload and is not a routine fix on this host)
- ml artifact dirs under `ml_service/artifacts`
- screenshot/report deliverables under `browser-screenshots`

## what we did touch

- `/tmp`: removed stray scratch files, `*.png`, `node-compile-cache`
- added `scripts/setup-disk-guard.sh` as a reusable pre-build guard
- added no application code

## current state after restoration

- Vite listening on 5173, ready
- convex dev running, functions ready
- proxy health on 5173 for all tested routes: 200

## remaining risk

- disk is still ~98% full, with ~75MB free after cleanup and ~15MB hard margin buffer in the guard script
- anything that grows logs, caches, temp, or downloads can re-trigger the same failure
- the host has many installed developer tools that were not part of this app
- a permanent fix is a larger volume or an automated cache clearing policy, not more one-off deletions

## recommendation to the user

if you want a durable fix, ask to increase the sandbox volume. without that, the simplest maintenance options are:

- clear `/tmp` on boot
- keep `.git`, `node_modules`, bun cache, playwright cache, ml artifacts, and screenshots untouched
- run `scripts/setup-disk-guard.sh --reserve-mb=150` before every build/test cycle and in CI
- if `ENOSPC` reappears, first retry only after freeing a temp pile like `/tmp`

## computed guard result now

```
$ bash scripts/setup-disk-guard.sh --reserve-mb=150
BLOCKED: storage at 98% on /dev/vda (0MB available, 150MB reserved); builds, Vite and Convex/TSC runs may fail with ENOSPC; free space or enlarge the sandbox volume first.
```

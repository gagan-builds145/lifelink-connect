#!/usr/bin/env bash
set -euo pipefail

RESERVE_MB="${RESERVE_MB:-180}"
CUT_PCT="${CUT_PCT:-95}"

usage() {
  cat <<USAGE
$(basename "$0") -- pre-build disk safety gate.

Reads the boot disk usage, prints OK/CAUTION/BLOCKED, and lists the largest
rooted piles under the workspace.

Tunables:
  RESERVE_MB  minimum bytes to keep free (default 180)
  CUT_PCT     reject when used% >= this (default 95)

USAGE
  exit 0
}

while [[ "${1:-}" != "" ]]; do
  case "$1" in
    --reserve-mb=*) RESERVE_MB="${1#*=}"; shift ;;
    --cut-pct=*) CUT_PCT="${1#*=}"; shift ;;
    --help|-h|--usage) usage ;;
    *) echo "Unknown option: $1"; exit 2 ;;
  esac
done

DISK="/dev/vda"
if ! df -P "$DISK" >/dev/null 2>&1; then
  DISK="$(df -Pk . | sed -n '2p' | awk '{print $1}')"
fi

DI_BYTES=$(df -Pk "$DISK" | sed -n '2p' | awk '{print $2}')
DF_BYTES=$(df -Pk "$DISK" | sed -n '2p' | awk '{print $4}')

PCT=$(( DI_BYTES - DF_BYTES ))
PCT=$(( PCT * 100 / DI_BYTES ))
FREE_MB=$(( DF_BYTES / 1024 / 1024 ))

if [[ "$PCT" -ge "$CUT_PCT" ]]; then
  echo "BLOCKED: storage at ${PCT}% on ${DISK}" \
       "(${FREE_MB}MB available, ${RESERVE_MB}MB reserved);" \
       "builds, Vite and Convex/TSC runs may fail with ENOSPC;" \
       "free space or enlarge the sandbox volume first." >&2
  exit 2
fi

if [[ "$FREE_MB" -lt "$RESERVE_MB" ]]; then
  echo "CAUTION: storage at ${PCT}% on ${DISK} (${FREE_MB}MB free, reserve ${RESERVE_MB}MB)." >&2
  exit 1
fi

echo "OK: disk ${PCT}% used, ${FREE_MB}MB available, guard reserves ${RESERVE_MB}MB"
echo
echo "Largest rooted piles under the workspace:"
du -x -h --max-depth=1 . 2>/dev/null | sort -hr | sed -n '1,12p'
echo
echo "Make rebuild-vs-storage safe when:"
echo "  - node_modules stays installed"
echo "  - node_modules/.vite can be written/cleaned"
echo "  - Vite + node deps stay cached by bun"
echo "  - Convex + TSC can run without ENOSPC"
EOF
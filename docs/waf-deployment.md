# WAF deployment instructions

Two supported paths. Pick one and verify it; **do not** report the WAF as active
until the verification section passes against the deployed hostname.

- **A. Self-hosted edge** — nginx + ModSecurity + OWASP CRS (`deploy/nginx`,
  `deploy/modsecurity`). Full control, no vendor dependency.
- **B. Cloudflare** — managed WAF with the same rule intent, plus bot management.

The app is a static SPA plus Convex Cloud (or self-hosted Convex). The WAF must
sit in front of **both** the site hostname (`app.example.org`) and the API/auth
hostname (`api.example.org`). WAF rules on the SPA alone protect nothing: every
real mutation goes to the API.

---

## A. nginx + ModSecurity + OWASP CRS

### Prerequisites

```bash
# Debian/Ubuntu example
sudo apt-get update
sudo apt-get install -y nginx libmodsecurity3 modsecurity-crs
# modsecurity-nginx connector must match the nginx build:
nginx -V 2>&1 | tr ' ' '\n' | grep -E '^--with-compat$'   # required
```

### Install the rules

```bash
sudo mkdir -p /etc/nginx/modsec/crs-rules
sudo cp deploy/nginx/lifelink.conf /etc/nginx/conf.d/lifelink.conf
sudo cp deploy/modsecurity/lifelink-custom.conf /etc/nginx/modsec/
sudo ln -sf /usr/share/modsecurity-crs/crs-setup.conf /etc/nginx/modsec/crs-setup.conf
sudo ln -sf /usr/share/modsecurity-crs/rules/*.conf /etc/nginx/modsec/crs-rules/
```

`/etc/nginx/modsec/main.conf`:

```apache
Include /etc/nginx/modsec/modsecurity.conf
Include /etc/nginx/modsec/crs-setup.conf
Include /etc/nginx/modsec/lifelink-custom.conf
Include /etc/nginx/modsec/crs-rules/*.conf
```

Edit hostnames, upstream ports and certificate paths in
`/etc/nginx/conf.d/lifelink.conf`, then:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### Staged rollout (required)

1. Keep `SecRuleEngine DetectionOnly` (default in `lifelink-custom.conf`).
2. Send real hospital/donor traffic for at least 72 hours.
3. Review `/var/log/modsec_audit.log` for false positives on clinical free text.
4. Add narrow exclusions (path + parameter) in `lifelink-custom.conf`.
5. Switch to `SecRuleEngine On`, reload, and re-run verification.

### Verify (all must pass)

```bash
BASE=https://app.example.org

# Headers present
curl -sSI $BASE/ | grep -Ei 'strict-transport-security|content-security-policy|x-frame-options|x-content-type-options|referrer-policy|permissions-policy'

# Basic SQLi / XSS blocked (expect 403)
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/?q=1%27%20OR%201%3D1--"
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/?q=%3Cscript%3Ealert(1)%3C/script%3E"

# Oversized body rejected (expect 413)
head -c 7000000 /dev/zero | curl -s -o /dev/null -w '%{http_code}\n' -X POST --data-binary @- $BASE/

# Auth/OTP rate limits (expect some 429 after the burst)
for i in $(seq 1 15); do curl -s -o /dev/null -w '%{http_code} ' -X POST -H 'content-type: application/json' -d '{"email":"probe@example.org"}' https://api.example.org/otp-gate; done; echo

# Legitimate large-ish clinical text is NOT blocked (expect 200 from the app)
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/blood-search"
```

Record the actual outputs in the deployment change ticket. Do not mark the WAF
deployed if any check fails.

---

## B. Cloudflare

1. Add the zone, set nameservers, enable **Full (strict)** TLS and Always Use
   HTTPS.
2. **WAF → Managed rules**: enable Cloudflare Managed Ruleset and OWASP Core
   Ruleset (paranoia level 1 first).
3. **WAF → Custom rules** (block, log first):

   | Name | Expression |
   | --- | --- |
   | Block SQLi probes | `(http.request.uri.query contains "union select") or (http.request.uri.query contains "' or 1=1")` |
   | Block XSS probes | `(http.request.uri.query contains "<script") or (http.request.uri.query contains "onerror=")` |
   | Block traversal | `(http.request.uri.path contains "../") or (http.request.uri.path contains "/etc/passwd")` |
   | Allow health | `http.request.uri.path eq "/livez"` (skip remaining WAF) |

4. **Security → Rate limiting**:

   | Path | Limit | Action |
   | --- | --- | --- |
   | `/otp-gate` | 5 requests / 10 min per IP | block 10 min |
   | `/api/auth*` | 10 requests / min per IP | managed challenge |
   | `POST /api/storage*` | 10 / min per IP | block |
   | everything else | 300 / min per IP | managed challenge |

5. **Bots**: enable Bot Fight Mode (or verified-bot allow list for hospital
   integrations).
6. **Transform rules → response headers**: add HSTS, CSP, nosniff, DENY,
   Referrer-Policy, Permissions-Policy (or keep nginx origin headers and use
   Cloudflare only for WAF).
7. **Body size**: set the plan's max upload to 6 MB; Convex enforces 5 MB per
   document.

### Verify on Cloudflare

Run the same curl checks as path A against the Cloudflare-proxied hostname, and
confirm in **Security → Events** that your probe requests are logged as blocked
by the intended rule IDs.

---

## Protecting legitimate hospital operations

- Keep emergency and read-only endpoints (`/livez`, public stock search) out of
  the strictest rules.
- Exclude only specific clinical fields from generic SQLi/XSS rules, never whole
  `/api` paths.
- Prefer rate-limit *challenge* over hard block for general traffic, but hard
  block for `/otp-gate` and repeated auth failures.
- Monitor 403/413/429 rates per facility; a sudden spike for one verified
  hospital usually means a client bug, not an attack.
- Maintain an allow list for verified hospital integration IPs if they batch
  uploads.

---

## Operations

- Alert on 5xx after WAF changes and on a spike in blocked hospital traffic.
- Keep rule sets and CRS versions pinned; review changes before upgrading.
- Back up `lifelink-custom.conf` with change notes.
- Re-run verification after every WAF/header change and after certificate
  renewals.

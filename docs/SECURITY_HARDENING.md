# Security hardening checklist

Operational security notes for KeepItBased production. Code changes live in git; DNS/SES items require console access.

## Applied in code (2026-06-09)

| Control | Detail |
|---------|--------|
| **Quant sidecar** | Public nginx `/quant-sidecar/` returns **403**. Browsers use **`GET/POST /api/quant-agi/sidecar/*`** with JWT + allowlist. |
| **Internal bind** | Node `:3001`, Python stock `:5001`, Quant sidecar `:8844`, Next `:3010` bind **`127.0.0.1`** only (nginx reverse proxy). |
| **`.env` permissions** | `chmod 600 backend/.env python-service/.env` (owner read/write only). |
| **Smoke** | `cd backend && npm run smoke:quant-agi-rank` — rank strategies + security checks. |

## Email / DNS (manual — Namecheap + AWS)

See [`docs/DELIVERABILITY_DNS.md`](docs/DELIVERABILITY_DNS.md).

```bash
cd backend && npm run email:check-dns
```

| Item | Status | Action |
|------|--------|--------|
| SES production access | Sandbox | AWS Support case (us-east-1) |
| SPF | Open | Add `include:amazonses.com` to TXT |
| DMARC | Open | Add `_dmarc` TXT policy |
| DKIM | Verify | SES CNAMEs in Namecheap |
| Bounce/complaint SNS | Open | Point to `POST /api/webhooks/ses-delivery` + `SES_WEBHOOK_SECRET` |

## Edge / host (verify periodically)

```bash
pm2 status
curl -sf http://127.0.0.1:3001/api/health
curl -4 -I --max-time 10 https://app.keepitbased.com/api/health
ss -tlnp | grep -E ':(3001|5001|8844|3010)\s'
```

- **Hetzner firewall:** TCP **22** from admin IP only; **80/443** from anywhere (see `todo.md` outage notes).
- **SSH:** key-only (`PasswordAuthentication no`, `PermitRootLogin no`); **fail2ban** active.
- **JWT:** 7-day expiry; stored in browser `localStorage` (XSS is the main token theft vector — keep CSP strict).

## If `/quant-sidecar/` returns 200 again

Nginx config drift — reload from repo:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Symlink should point at `config/nginx/sites-available/app.keepitbased-https.conf`.

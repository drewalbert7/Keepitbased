#!/usr/bin/env bash
# Quick DNS checks for keepitbased.com email authentication.
set -euo pipefail

DOMAIN="${EMAIL_DNS_DOMAIN:-keepitbased.com}"
DMARC_HOST="_dmarc.${DOMAIN}"

echo "=== SPF (apex TXT) ==="
dig +short TXT "$DOMAIN" | tr -d '"' | grep -i spf || echo "(no SPF TXT found)"

echo ""
echo "=== DMARC ==="
dig +short TXT "$DMARC_HOST" | tr -d '"' || echo "(no DMARC record — add _dmarc TXT)"

echo ""
echo "=== DKIM (SES selectors — set DKIM_SELECTORS env, space-separated) ==="
if [[ -n "${DKIM_SELECTORS:-}" ]]; then
  for sel in $DKIM_SELECTORS; do
    host="${sel}._domainkey.${DOMAIN}"
    echo -n "$host → "
    dig +short CNAME "$host" || echo "(missing)"
  done
else
  echo "Set DKIM_SELECTORS from SES console (e.g. export DKIM_SELECTORS='abc123 def456')"
  echo "Example: dig +short CNAME <selector>._domainkey.${DOMAIN}"
fi

echo ""
echo "=== MX (informational) ==="
dig +short MX "$DOMAIN" || true

echo ""
echo "Done. See docs/DELIVERABILITY_DNS.md for required records."

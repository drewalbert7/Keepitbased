# Email deliverability — DNS & AWS SES (KeepItBased)

Do these in **AWS SES (us-east-1)** and **Namecheap DNS** for `keepitbased.com`. Code already sends `List-Unsubscribe`, **RFC 8058 one-click** (`POST /api/email/unsubscribe`), and suppresses bounces/complaints when the webhook is wired.

## 1. DKIM (required)

1. AWS Console → **SES** → **Verified identities** → `keepitbased.com`
2. **Authentication** → **DKIM** → **Publish DNS records**
3. Add each **CNAME** at Namecheap (Advanced DNS)
4. Wait until SES shows identity **Verified** and DKIM status **Success**

Verify:

```bash
npm run email:check-dns
```

## 2. SPF (one TXT record at apex)

You must have **only one** SPF TXT on `keepitbased.com`. Merge existing includes with SES:

```txt
v=spf1 include:spf.efwd.registrar-servers.com include:amazonses.com ~all
```

If you use a custom MAIL FROM subdomain later, follow [SES SPF guidance](https://docs.aws.amazon.com/ses/latest/dg/send-email-authentication-spf.html).

## 3. DMARC (monitoring first)

Add TXT on host `_dmarc.keepitbased.com`:

```txt
v=DMARC1; p=none; adkim=r; aspf=r; rua=mailto:dmarc-reports@keepitbased.com; pct=100
```

Use a mailbox you read for `rua`. After 2–4 weeks of clean reports, consider `p=quarantine` then `p=reject`.

## 4. Application env (server `backend/.env`)

| Variable | Purpose |
|----------|---------|
| `SMTP_HOST` | `email-smtp.us-east-1.amazonaws.com` (same region as SES identity) |
| `SMTP_FROM` | `noreply@keepitbased.com` (verified in SES) |
| `FRONTEND_URL` | `https://keepitbased.com` or `https://app.keepitbased.com` — must be HTTPS for one-click unsubscribe |
| `SES_WEBHOOK_SECRET` | Random 32+ char secret for bounce/complaint webhook |

## 5. SES production access

Sandbox limits hurt reputation testing. In SES → **Account dashboard** → request **production access** (us-east-1). Describe: opt-in watchlist alerts, one-click unsubscribe, low volume.

## 6. Bounce & complaint webhook (SNS)

1. SES → **Configuration sets** (or identity) → **Event destinations** → Bounce + Complaint → **SNS topic**
2. SNS subscription: **HTTPS** is optional; simpler path:
   - SNS topic → subscribe **HTTPS** endpoint  
     `https://keepitbased.com/api/webhooks/ses-delivery`  
     (or `https://app.keepitbased.com/api/webhooks/ses-delivery` if that is your API host)
3. Because SNS cannot send your Bearer token by default, use either:
   - **Lambda** between SNS and API that adds `Authorization: Bearer <SES_WEBHOOK_SECRET>`, or
   - **SNS → HTTPS** with a query param (less ideal), or
   - Manual forwarding during setup; the API **auto-confirms** `SubscriptionConfirmation` when the POST reaches the server with valid auth.

**Authenticated POST** (required for events):

```http
POST /api/webhooks/ses-delivery
Authorization: Bearer <SES_WEBHOOK_SECRET>
Content-Type: application/json
```

Body: SNS `Notification` wrapper or raw SES bounce/complaint JSON.

On bounce/complaint, the app sets `users.email_ses_suppressed_at` and stops marketing mail to that address.

## 7. Smoke tests

```bash
npm run email:verify-smtp
npm run email:check-dns

# Send test opportunity mail (sandbox: recipient must be verified in SES)
TEST_USER_EMAIL=you@example.com npm run email:test-opportunity
```

In Gmail: **Show original** → look for `spf=pass`, `dkim=pass`, `dmarc=pass`.

## 8. What the app already enforces

- Per-user and global send budgets (avoid SES 454 / reputation hits)
- `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
- Opt-in footer copy on marketing templates
- 6-month engagement sunset for optional marketing mail
- Hard suppress after SES bounce/complaint (when webhook is live)

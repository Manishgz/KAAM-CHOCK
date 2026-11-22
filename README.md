# Kaam Chowk — labour marketplace

Node.js backend (no npm packages) + frontend. Mobile-number accounts, OTP login, forgot password,
labour dashboard, employer dashboard and admin dashboard.

## Run

```
node server.js            # http://localhost:3000
npm test                  # 11 API tests
```

First start prints the **admin login** (mobile `9000000000` and a random password, shown once).
Set your own with `ADMIN_PHONE` and `ADMIN_PASSWORD` before the first start.

## Roles

| Role | Can do |
|---|---|
| Kaam dene wala (employer) | post / edit / cancel jobs, see the labour who took a job (with phone), mark done + rate, reveal labour phone numbers |
| Labour | edit profile, toggle availability, claim jobs (max 3 active), release a job, see employer phone after claiming |
| Admin | stats, search users, verify labour, block/unblock, delete users, cancel/delete jobs, activity log, remove demo data |

Phone numbers are never public: a job's owner number is shown only to the labour who took it,
a labour's number only to employers (rate limited).

## OTP / SMS — important

No real SMS is sent until you connect a provider. Until then (non-production) the OTP is printed in the
server console **and returned in the API response**, and the website shows it in a yellow "Test mode" box.

To send real SMS, set `SMS_WEBHOOK_URL` to any HTTPS endpoint that accepts
`POST {"to":"+919876543210","message":"..."}` (a small proxy in front of MSG91, Fast2SMS, Twilio, etc.).
Optional `SMS_WEBHOOK_AUTH` is sent as the `Authorization` header. When the webhook is set, OTPs are
never returned to the browser. With `NODE_ENV=production` and no webhook, OTPs are not exposed at all
(users could not log in) — configure SMS before going live.

## Environment variables

| Var | Default | Meaning |
|---|---|---|
| `PORT` | 3000 | |
| `DATA_DIR` | `./data` | database folder (`db.json`) — keep on persistent disk |
| `ADMIN_PHONE`, `ADMIN_PASSWORD` | 9000000000 / random | admin created if none exists |
| `SMS_WEBHOOK_URL`, `SMS_WEBHOOK_AUTH` | — | real SMS delivery |
| `NODE_ENV` | — | `production` disables dev OTP exposure |
| `TRUST_PROXY=1` | off | behind nginx/Caddy: use `X-Forwarded-For` / `-Proto` |
| `COOKIE_SECURE=1` | off | force `Secure` cookies (set when served over HTTPS) |
| `SEED_DEMO=0` | on | do not create demo jobs/labour on first start |

## Security built in

- Passwords hashed with scrypt; sessions are random tokens in `HttpOnly; SameSite=Lax` cookies (hash stored server-side, 30 days)
- OTP: 6 digits, HMAC-hashed in memory, 5 minutes, 5 attempts, 30 s resend gap, 6 per number per hour
- Login lockout (5 wrong passwords → 15 min), per-IP rate limits, same reply for known/unknown numbers on OTP requests
- Password reset kills all sessions; blocking a user kills their sessions immediately
- Role checks on every route; admin actions are written to an audit log
- CSRF: JSON-only bodies + Origin check; CSP header (no inline scripts), input length caps, XSS-safe rendering

## Files

```
server.js            API + static server
public/index.html    page shell
public/app.css       styles
public/app.js        UI: auth modals, dashboards, admin
test/api.test.js     API tests
data/db.json         database (auto-created; copy it to back up)
```

## Before real users

1. Connect SMS (above) and run behind HTTPS (`TRUST_PROXY=1`, `COOKIE_SECURE=1`).
2. Admin → Overview → **Demo data hatao** (the sample jobs/labour use fake names and numbers).
3. A JSON file is fine for one area. For heavy traffic move to SQLite/Postgres (all data access is in `server.js`).
4. Not included: payments, in-app chat, photo/ID verification, push/WhatsApp notifications, Hindi (Devanagari) UI.

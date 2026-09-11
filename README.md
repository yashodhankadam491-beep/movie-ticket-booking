# IBOX x CVR's — Backend + Database

This version keeps the existing movie/seat UI and adds production-oriented backend hardening without changing the booking flow.

## Included

- Login + Register tabs.
- User name, email and password.
- Country selection and automatic country → currency mapping.
- Currency symbol/code throughout booking.
- SQLite database for users, sessions, movies, seats and bookings.
- Password hashing with Node.js `crypto.scryptSync` using a stronger work factor.
- Server-side seat locking to prevent double booking.
- Hashed session tokens and HTTP-only, SameSite session cookies.
- Secure cookies in production (`Secure`).
- CSRF protection using `Origin`/`Referer` + Fetch Metadata validation.
- Security response headers and HSTS in production.
- Request-body size limit.
- Login, registration and booking rate limits.
- Stronger password policy: 12-128 characters and common-password rejection.
- Environment-based production secret management.
- HTTPS support directly in Node or through a trusted HTTPS reverse proxy.
- SQLite WAL mode and busy timeout for safer concurrent booking operations.
- Consistent SQLite backup command using `VACUUM INTO`.
- Existing QR demo payment, receipt and movie/seat UI remain intact.

## Requirements

Use Node.js 22.5+ because the project uses the built-in `node:sqlite` module.

```bash
node -v
npm install
```

## Development

Copy `.env.example` to `.env` and set a local `SESSION_SECRET` if desired. Do not commit `.env`.

```bash
npm start
```

Then open:

```text
http://localhost:3000
```

Do not open `index.html` directly with `file://`; the frontend calls the backend API.

## Production HTTPS

Production startup requires HTTPS. Choose one:

### Option A — trusted reverse proxy

Put Nginx, Caddy, Cloudflare, or another trusted TLS terminator in front of Node and set:

```text
NODE_ENV=production
PUBLIC_ORIGIN=https://your-domain.com
TRUST_PROXY=true
SESSION_SECRET=<long-random-secret>
```

The proxy should forward requests to the Node application over the private network and set the correct `X-Forwarded-Proto` and client IP headers.

### Option B — direct Node HTTPS

Set:

```text
NODE_ENV=production
PUBLIC_ORIGIN=https://your-domain.com
SESSION_SECRET=<long-random-secret>
TLS_CERT_FILE=/absolute/path/fullchain.pem
TLS_KEY_FILE=/absolute/path/private-key.pem
```

Never commit certificate/private-key files.

## Rate limiting

The application includes an in-process limiter for login, registration and booking endpoints. This is suitable for a single Node instance. For a multi-instance production deployment, put rate limiting at the reverse proxy/WAF or replace the in-process limiter with a shared store such as Redis.

## Database and backups

The current application intentionally keeps SQLite so the existing project remains compatible and easy to run. SQLite is not automatically converted into PostgreSQL by this update.

Create a consistent backup with:

```bash
npm run backup
```

Backups are written to `backups/` and that directory is ignored by Git. In production, copy encrypted backups to separate durable storage and keep multiple retention points. For a larger multi-instance booking service, migrate the data layer to a managed PostgreSQL/MySQL service with automated backups and point-in-time recovery.

## Currency rates

The included rates are demo/default rates stored in the `currencies` table. They are NOT guaranteed live market rates. For production, use a trusted exchange-rate provider and update the database on a scheduled job.

## Security deployment checklist

Before going live:

1. Use HTTPS everywhere.
2. Generate a unique 32+ character `SESSION_SECRET` and store it in the hosting provider's secret manager.
3. Do not commit `.env`, private keys, certificates, database backups or other secrets.
4. Use a trusted reverse proxy/WAF for multi-instance deployments.
5. Run `npm audit` and keep Node/dependencies updated.
6. Schedule `npm run backup` and copy backups off the application server.
7. Test restoring a backup before relying on it.
8. For higher traffic or multiple application instances, migrate the database and rate limiter to managed/shared services.
9. Replace the demo payment flow with a real payment provider before accepting real money.

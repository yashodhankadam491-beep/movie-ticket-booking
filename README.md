# IBOX x CVR's — Maharashtra Movie Ticket Booking

The project keeps the existing booking UI while connecting the booking flow to a database-driven Maharashtra cinema/show catalogue.

## Current architecture

```text
Maharashtra
  ↓
District → City → Cinema Hall
  ↓
Screen 1 / Screen 2 / Screen 3 / ...
  ↓
Movie → Date → Show Time
  ↓
Show-specific Seats
  ↓
10-minute temporary seat hold
  ↓
Razorpay Checkout
  ↓
Server signature + captured-payment verification
  ↓
Booking + Receipt + My Bookings

Admin
  ↓
/admin.html
  ↓
Movies / Cinemas / Screens / Shows / Bookings
```

## Included

- Login + Register.
- Country → currency mapping.
- Maharashtra district/city/cinema directory.
- Database-backed `cinemas`, `screens`, `shows` and `show_seats` tables.
- Cinema → screen → date → show-time → movie filtering through `/api/catalog`.
- Screen-specific seat capacity; existing cinemas are bootstrapped with `Screen 1`.
- New cinemas created from the admin dashboard automatically receive `Screen 1` with 32 seats.
- Show-specific seats and temporary 10-minute locks during checkout.
- User booking history at `My Bookings`.
- Admin dashboard at `/admin.html`.
- Admin movie add/edit/delete management.
- Admin cinema creation.
- Admin screen add/edit/activate/deactivate/delete management.
- Admin show add/edit/activate/deactivate/delete management with Cinema + Screen validation.
- Admin booking view and summary counts.
- Razorpay Standard Checkout with server-side order creation.
- Server-side Razorpay HMAC signature verification and captured-payment verification.
- SQLite WAL mode, hashed sessions, CSRF/origin checks, rate limits and security headers.
- Existing movie poster URLs are kept unchanged for now.

## Requirements

Node.js 22.5+ is required because the project uses the built-in `node:sqlite` module.

```bash
npm install
```

## Local setup

Copy `.env.example` to `.env` and set:

```text
SESSION_SECRET=use-a-long-random-secret
RAZORPAY_KEY_ID=rzp_test_your_key_id
RAZORPAY_KEY_SECRET=your_test_key_secret
PAYMENT_USD_TO_INR=83.5
ADMIN_EMAILS=your-email@example.com
```

Never commit `.env` or a Razorpay secret.

Start the server:

```bash
npm start
```

Open `http://localhost:3000`.

The cinema directory is seeded from `MAHARASHTRA_CINEMAS.json`. On startup the server creates future shows for the seeded movies and cinema halls so the UI has a database-backed catalogue immediately. These seeded shows are application/demo schedule data, not a claim of live cinema availability; replace them with verified theatre schedules before production use.

## Admin

After logging in with an email listed in `ADMIN_EMAILS`, open `/admin.html`.

The dashboard provides:

1. **Movies** — add, edit and delete unused movies.
2. **Cinemas** — add Maharashtra cinema halls; every new cinema gets `Screen 1` automatically.
3. **Screens** — add multiple screens per cinema, set seat capacity (1–500), rename, activate/deactivate and delete unused screens.
4. **Shows** — select Cinema → Screen → Movie → Date → Time → INR price. The selected screen's capacity creates the show seats.
5. **Show management** — edit date/time/price, activate/deactivate and delete shows that have no bookings.
6. **Bookings** — view customer, movie, cinema, date/time, seats and paid amount.

A screen with existing shows or bookings should be deactivated rather than deleted. A movie/cinema/show with historical booking dependencies is protected from destructive deletion where applicable.

## Razorpay payment

The project uses Razorpay Standard Checkout. The server creates a Razorpay order before checkout, the browser receives only the Key ID, and the server verifies the returned payment signature and payment status before confirming seats.

Use Razorpay **Test Mode** first. Test payments do not move real money. After end-to-end testing, replace the test credentials with Live Mode credentials and complete the provider's go-live requirements before accepting actual payments.

## Backups

```bash
npm run backup
```

Backups are written to `backups/`, which is ignored by Git.

## Production

Use HTTPS. Either terminate TLS at a trusted reverse proxy with `TRUST_PROXY=true`, or provide `TLS_CERT_FILE` and `TLS_KEY_FILE` directly to Node. Use a strong production `SESSION_SECRET`, keep secrets in the hosting provider's secret manager, and move SQLite/rate limiting to shared managed infrastructure when scaling to multiple application instances.

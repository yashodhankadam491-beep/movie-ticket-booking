# IBOX x CVR's — Maharashtra Movie Ticket Booking

The project keeps the existing booking UI while connecting the booking flow to a database-driven Maharashtra cinema/show catalogue.

## Current architecture

```text
User
  ↓
Login / Register
  ↓
District → City → Cinema Hall
  ↓
Date → Show Time → Movie
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
Movies / Cinemas / Shows / Bookings
```

## Included

- Login + Register.
- Country → currency mapping.
- Maharashtra district/city/cinema directory.
- Database-backed `cinemas`, `shows` and `show_seats` tables.
- Cinema → date → show-time → movie filtering through `/api/catalog`.
- Show-specific seats and temporary 10-minute locks during checkout.
- User booking history at `My Bookings`.
- Admin dashboard at `/admin.html`.
- Admin movie/cinema/show management and booking view.
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

The dashboard can:

- Add movies.
- Add cinema halls.
- Add shows with date, time and INR price.
- View recent bookings.
- View catalogue/booking summary counts.

For production, admin authentication should be upgraded to a dedicated role/permission system rather than relying only on an environment email allow-list.

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

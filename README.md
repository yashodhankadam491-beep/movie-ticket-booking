# IBOX x CVR's — Backend + Database

This version keeps the existing movie/seat UI and adds:

- Login + Register tabs.
- User name, email and password.
- Country selection during registration.
- Automatic country → currency mapping.
- Currency symbol and currency code shown throughout booking.
- Prices converted from the movie's USD base price.
- SQLite database for users, sessions, movies, seats and bookings.
- Password hashing with Node.js `crypto.scryptSync`.
- Server-side seat locking to prevent double booking.
- HTTP-only session cookie.

## Requirements

Use Node.js 22.5+ because the project uses the built-in `node:sqlite` module.

Check:

```bash
node -v
```

## Run

```bash
npm start
```

Then open:

```text
http://localhost:3000
```

Do not open `public/index.html` directly with `file://`; the frontend calls the backend API.

## Database

The server automatically creates:

```text
ibox_booking.sqlite
```

The database contains:

- `users`
- `countries`
- `currencies`
- `sessions`
- `movies`
- `seats`
- `bookings`

## Currency rates

The included rates are demo/default rates stored in the `currencies` table. They are NOT guaranteed live market rates.

For a production project, replace them with a trusted exchange-rate provider and update the database on a scheduled job.

## Security notes

For a real production deployment, additionally use HTTPS, secure cookies, CSRF protection, rate limiting, email verification, stronger password policy, secret management and a production-grade database/backup strategy.

# IBOX x CVR's Movie Ticket Booking — Error Audit

## Audit status

Repository-wide static audit performed on the application source files.

## Issues identified

1. **Password validation mismatch** — the registration UI and frontend JavaScript previously described/accepted passwords from 6 characters, while the server requires 12–128 characters. The client should match the server so users get immediate, consistent validation.
2. **Demo payment must remain clearly labelled** — the payment flow is a simulation and does not process real money.
3. **Currency rates are fixed demo rates** — displayed conversions are not live foreign-exchange rates.
4. **External movie poster dependency** — posters are loaded from TMDB image URLs with a placeholder fallback.
5. **Node runtime requirement** — the project uses Node's built-in `node:sqlite`, so Node.js 22.5+ is required.

## Corrected validation rule

Registration passwords should be 12–128 characters, matching the server-side security rule.

## Scope

This audit intentionally does not claim a live browser/server test because the connected repository tooling does not execute the application process. Runtime behavior should still be tested locally with `npm start` and the booking flow.

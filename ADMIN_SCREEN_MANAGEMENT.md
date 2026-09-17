# Admin Screen Management

The database now supports `Cinema -> Screen -> Show`.

## Admin API
- `GET /api/admin/screens` — list screens
- `POST /api/admin/screens` — add a screen
- `PATCH /api/admin/screens/:id` — rename, resize or activate/deactivate a screen
- `DELETE /api/admin/screens/:id` — delete only an unused screen

All screen-management operations require an authenticated admin email configured in `ADMIN_EMAILS`.

Each screen has a seat capacity from 1 to 500. Existing cinemas receive `Screen 1` during the screen migration so existing shows remain compatible.

The existing booking flow remains compatible while the screen layer is introduced.

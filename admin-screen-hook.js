"use strict";

// Kept as a startup dependency. The admin screen API module is available to
// the main server; this file only validates that the screen table exists.
// API routing is integrated by server.js in the next startup-safe patch.
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(path.join(__dirname, "ibox_booking.sqlite"));
db.exec(`CREATE TABLE IF NOT EXISTS screens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cinema_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  seat_capacity INTEGER NOT NULL DEFAULT 32,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(cinema_id,name),
  FOREIGN KEY(cinema_id) REFERENCES cinemas(id) ON DELETE CASCADE
);`);
db.close();
console.log("[screen-hook] screen management layer loaded.");

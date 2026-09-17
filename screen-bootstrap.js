"use strict";

// Adds the Cinema -> Screen -> Show layer without breaking existing bookings.
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const db = new DatabaseSync(path.join(__dirname, "ibox_booking.sqlite"));
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS screens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cinema_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  seat_capacity INTEGER NOT NULL DEFAULT 32,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(cinema_id, name),
  FOREIGN KEY(cinema_id) REFERENCES cinemas(id) ON DELETE CASCADE
);
`);

try {
  db.exec("ALTER TABLE shows ADD COLUMN screen_id INTEGER REFERENCES screens(id) ON DELETE CASCADE");
} catch (error) {
  if (!String(error.message).toLowerCase().includes("duplicate column")) throw error;
}

const cinemas = db.prepare("SELECT id FROM cinemas ORDER BY id").all();
const insertScreen = db.prepare("INSERT OR IGNORE INTO screens(cinema_id,name,seat_capacity,active) VALUES(?,?,32,1)");
for (const cinema of cinemas) insertScreen.run(cinema.id, "Screen 1");

db.exec(`
UPDATE shows
SET screen_id = (
  SELECT sc.id FROM screens sc
  WHERE sc.cinema_id = shows.cinema_id AND sc.name = 'Screen 1'
)
WHERE screen_id IS NULL;
`);

db.exec(`
CREATE TRIGGER IF NOT EXISTS trg_shows_default_screen
AFTER INSERT ON shows
WHEN NEW.screen_id IS NULL
BEGIN
  UPDATE shows SET screen_id = (
    SELECT sc.id FROM screens sc
    WHERE sc.cinema_id = NEW.cinema_id AND sc.name = 'Screen 1' AND sc.active = 1
    LIMIT 1
  ) WHERE id = NEW.id;
END;
`);

db.exec(`
CREATE INDEX IF NOT EXISTS idx_screens_cinema ON screens(cinema_id, active);
CREATE INDEX IF NOT EXISTS idx_shows_screen_date ON shows(screen_id, show_date, show_time, active);
`);

db.close();
console.log("[screen-bootstrap] Cinema -> Screen -> Show layer ready.");

"use strict";

const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const db = new DatabaseSync(path.join(__dirname, "ibox_booking.sqlite"));
db.exec(`
CREATE TABLE IF NOT EXISTS movies (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  show_time TEXT NOT NULL,
  price_usd REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  movie_id INTEGER NOT NULL,
  seats_json TEXT NOT NULL,
  total_usd REAL NOT NULL,
  currency_code TEXT NOT NULL,
  total_local REAL NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'Razorpay',
  payment_status TEXT NOT NULL DEFAULT 'PAID',
  transaction_id TEXT,
  created_at TEXT NOT NULL
);
`);
const movies = [
  [1,"Avengers: Endgame","Action","18:00",15],
  [2,"Dune: Part Two","Sci-Fi","20:30",18],
  [3,"The Hangover","Comedy","15:00",10],
  [4,"Interstellar","Sci-Fi","21:00",16],
  [5,"The Dark Knight","Action","19:30",14],
  [6,"Free Guy","Comedy","17:00",12]
];
const insert = db.prepare("INSERT OR IGNORE INTO movies(id,title,category,show_time,price_usd) VALUES(?,?,?,?,?)");
for (const movie of movies) insert.run(...movie);
db.close();

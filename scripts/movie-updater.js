"use strict";

const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const ROOT = path.join(__dirname, "..");
const DB_FILE = path.join(ROOT, "ibox_booking.sqlite");
const TMDB_TOKEN = process.env.TMDB_ACCESS_TOKEN || "";
const TMDB_API_KEY = process.env.TMDB_API_KEY || "";
const INR_PER_USD = Number(process.env.PAYMENT_USD_TO_INR || 83.5);
const db = new DatabaseSync(DB_FILE);

function isoDate(date) { return date.toISOString().slice(0, 10); }
function addDays(date, days) { const copy = new Date(date); copy.setUTCDate(copy.getUTCDate() + days); return copy; }

async function tmdb(pathname, params = {}) {
    const url = new URL(`https://api.themoviedb.org/3${pathname}`);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
    const headers = { Accept: "application/json" };
    if (TMDB_TOKEN) headers.Authorization = `Bearer ${TMDB_TOKEN}`;
    else if (TMDB_API_KEY) url.searchParams.set("api_key", TMDB_API_KEY);
    else throw new Error("TMDB_ACCESS_TOKEN or TMDB_API_KEY is required.");
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`TMDB request failed: ${response.status}`);
    return response.json();
}

function ensureMovieColumns() {
    for (const statement of [
        "ALTER TABLE movies ADD COLUMN tmdb_id INTEGER",
        "ALTER TABLE movies ADD COLUMN poster_path TEXT",
        "ALTER TABLE movies ADD COLUMN overview TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE movies ADD COLUMN release_date TEXT",
        "ALTER TABLE movies ADD COLUMN status TEXT NOT NULL DEFAULT 'NOW_SHOWING'",
        "ALTER TABLE movies ADD COLUMN updated_at TEXT"
    ]) {
        try { db.exec(statement); } catch (error) {
            if (!String(error.message).toLowerCase().includes("duplicate column")) throw error;
        }
    }
}

function seedFutureShows(movieIds) {
    const cinemas = db.prepare("SELECT id FROM cinemas WHERE active=1").all();
    if (!cinemas.length) return 0;
    const movies = db.prepare(`SELECT id,show_time,price_usd FROM movies WHERE id IN (${movieIds.map(() => "?").join(",")}) AND status<>'ARCHIVED'`).all(...movieIds);
    const insertShow = db.prepare(`INSERT OR IGNORE INTO shows(cinema_id,movie_id,show_date,show_time,price_inr,active) VALUES(?,?,?,?,?,1)`);
    const insertSeat = db.prepare(`INSERT OR IGNORE INTO show_seats(show_id,seat_number) VALUES(?,?)`);
    let added = 0;
    for (const cinema of cinemas) {
        for (const movie of movies) {
            for (let i = 0; i < 14; i++) {
                const date = isoDate(addDays(new Date(), i));
                const price = Math.max(50, Math.round(Number(movie.price_usd || 10) * INR_PER_USD));
                const result = insertShow.run(cinema.id, movie.id, date, movie.show_time || "18:00", price);
                if (Number(result.changes) === 1) {
                    const showId = Number(result.lastInsertRowid);
                    for (let seat = 1; seat <= 32; seat++) insertSeat.run(showId, seat);
                    added++;
                }
            }
        }
    }
    return added;
}

async function updateMovies() {
    ensureMovieColumns();
    const today = new Date();
    const start = isoDate(addDays(today, -7));
    const end = isoDate(addDays(today, 45));
    const data = await tmdb("/discover/movie", {
        language: "en-US", region: "IN", include_adult: false, include_video: false,
        sort_by: "primary_release_date.asc", "primary_release_date.gte": start,
        "primary_release_date.lte": end, with_release_type: "3|2", page: 1
    });

    const now = new Date().toISOString();
    const upsert = db.prepare(`
        INSERT INTO movies(id,title,category,show_time,price_usd,tmdb_id,poster_path,overview,release_date,status,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
            title=excluded.title, category=excluded.category, poster_path=excluded.poster_path,
            overview=excluded.overview, release_date=excluded.release_date, status=excluded.status, updated_at=excluded.updated_at
    `);
    let synced = 0;
    const ids = [];
    for (const movie of data.results || []) {
        if (!movie.id || !movie.title) continue;
        const releaseDate = movie.release_date || null;
        const status = releaseDate && releaseDate <= isoDate(today) ? "NOW_SHOWING" : "UPCOMING";
        const category = movie.genre_ids?.includes(28) ? "Action" : movie.genre_ids?.includes(35) ? "Comedy" : movie.genre_ids?.includes(878) ? "Sci-Fi" : "Movie";
        const id = 1000000 + Number(movie.id);
        upsert.run(id, movie.title, category, "18:00", 10, movie.id, movie.poster_path || null, movie.overview || "", releaseDate, status, now);
        ids.push(id);
        synced++;
    }

    db.prepare(`UPDATE movies SET status='ARCHIVED',updated_at=? WHERE release_date IS NOT NULL AND release_date < ? AND updated_at IS NOT NULL`).run(now, start);
    db.prepare(`UPDATE shows SET active=0 WHERE movie_id IN (SELECT id FROM movies WHERE status='ARCHIVED') AND show_date>=date('now')`).run();
    const showsAdded = seedFutureShows(ids);
    console.log(`[movie-updater] ${new Date().toISOString()} synced ${synced} TMDb movies and added ${showsAdded} future shows.`);
}

updateMovies().catch(error => { console.error("[movie-updater] failed:", error.message); process.exitCode = 1; }).finally(() => db.close());

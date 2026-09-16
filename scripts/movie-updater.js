"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const ROOT = path.join(__dirname, "..");
const DB_FILE = path.join(ROOT, "ibox_booking.sqlite");
const TMDB_TOKEN = process.env.TMDB_ACCESS_TOKEN || "";
const TMDB_API_KEY = process.env.TMDB_API_KEY || "";
const db = new DatabaseSync(DB_FILE);

function isoDate(date) {
    return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
    const copy = new Date(date);
    copy.setUTCDate(copy.getUTCDate() + days);
    return copy;
}

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

async function updateMovies() {
    const today = new Date();
    const start = isoDate(addDays(today, -7));
    const end = isoDate(addDays(today, 45));
    const data = await tmdb("/discover/movie", {
        language: "en-US",
        region: "IN",
        include_adult: false,
        include_video: false,
        sort_by: "primary_release_date.asc",
        "primary_release_date.gte": start,
        "primary_release_date.lte": end,
        with_release_type: "3|2",
        page: 1
    });

    db.exec(`
        CREATE TABLE IF NOT EXISTS movie_catalog (
            id INTEGER PRIMARY KEY,
            tmdb_id INTEGER UNIQUE,
            title TEXT NOT NULL,
            category TEXT NOT NULL,
            show_time TEXT NOT NULL DEFAULT '18:00',
            price_usd REAL NOT NULL DEFAULT 10,
            poster_path TEXT,
            overview TEXT,
            release_date TEXT,
            status TEXT NOT NULL DEFAULT 'UPCOMING',
            updated_at TEXT NOT NULL
        );
    `);

    const now = new Date().toISOString();
    const upsert = db.prepare(`
        INSERT INTO movie_catalog
            (tmdb_id,title,category,show_time,price_usd,poster_path,overview,release_date,status,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(tmdb_id) DO UPDATE SET
            title=excluded.title,
            poster_path=excluded.poster_path,
            overview=excluded.overview,
            release_date=excluded.release_date,
            status=excluded.status,
            updated_at=excluded.updated_at
    `);

    let insertedOrUpdated = 0;
    for (const movie of data.results || []) {
        if (!movie.id || !movie.title) continue;
        const releaseDate = movie.release_date || null;
        const status = releaseDate && releaseDate <= isoDate(today) ? "NOW_SHOWING" : "UPCOMING";
        const category = movie.genre_ids?.includes(28) ? "Action" : movie.genre_ids?.includes(35) ? "Comedy" : movie.genre_ids?.includes(878) ? "Sci-Fi" : "Movie";
        upsert.run(movie.id, movie.title, category, "18:00", 10, movie.poster_path || null, movie.overview || "", releaseDate, status, now);
        insertedOrUpdated++;
    }

    db.prepare(`UPDATE movie_catalog SET status='ARCHIVED', updated_at=? WHERE release_date IS NOT NULL AND release_date < ? AND updated_at < ?`).run(now, start, now);
    console.log(`[movie-updater] ${new Date().toISOString()} updated ${insertedOrUpdated} TMDB movies.`);
}

updateMovies()
    .catch(error => {
        console.error("[movie-updater] failed:", error.message);
        process.exitCode = 1;
    })
    .finally(() => db.close());

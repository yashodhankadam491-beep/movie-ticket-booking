"use strict";

const cron = require("node-cron");
const { spawn } = require("node:child_process");
const path = require("node:path");

let running = false;

function runMovieUpdate() {
    if (running) {
        console.warn("[movie-cron] previous update is still running; skipping overlap.");
        return;
    }
    running = true;
    const child = spawn(process.execPath, [path.join(__dirname, "movie-updater.js")], {
        cwd: path.join(__dirname, ".."),
        env: process.env,
        stdio: "inherit"
    });
    child.on("close", code => {
        running = false;
        if (code !== 0) console.error(`[movie-cron] updater exited with code ${code}`);
    });
    child.on("error", error => {
        running = false;
        console.error("[movie-cron] failed to start updater:", error.message);
    });
}

// Every Thursday at 23:00 Asia/Kolkata. Set MOVIE_CRON_DISABLED=true to disable.
if (process.env.MOVIE_CRON_DISABLED !== "true") {
    cron.schedule(process.env.MOVIE_CRON_SCHEDULE || "0 23 * * 4", runMovieUpdate, {
        timezone: "Asia/Kolkata",
        noOverlap: true,
        name: "ibox-movie-catalog-update"
    });
    console.log("[movie-cron] scheduled: Thursday 23:00 Asia/Kolkata");
}

module.exports = { runMovieUpdate };

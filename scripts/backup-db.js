"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const root = path.join(__dirname, "..");
const source = path.join(root, "ibox_booking.sqlite");
const backupDir = path.join(root, "backups");

if (!fs.existsSync(source)) throw new Error(`Database not found: ${source}`);
fs.mkdirSync(backupDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const destination = path.join(backupDir, `ibox_booking-${stamp}.sqlite`);
const db = new DatabaseSync(source);

try {
    // VACUUM INTO creates a consistent SQLite snapshot and safely handles WAL mode.
    const escaped = destination.replace(/'/g, "''");
    db.exec(`VACUUM INTO '${escaped}'`);
    console.log(`Backup created: ${destination}`);
} finally {
    db.close();
}

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DB_FILE = path.join(ROOT, "ib​​ox_booking.sqlite").replace(/\u200b/g, "");

if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });

const db = new DatabaseSync(DB_FILE);

db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS currencies (
        code TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        symbol TEXT NOT NULL,
        rate_from_usd REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS countries (
        code TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        currency_code TEXT NOT NULL,
        FOREIGN KEY(currency_code) REFERENCES currencies(code)
    );

    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        country_code TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(country_code) REFERENCES countries(code)
    );

    CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS movies (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        category TEXT NOT NULL,
        show_time TEXT NOT NULL,
        price_usd REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS seats (
        movie_id INTEGER NOT NULL,
        seat_number INTEGER NOT NULL,
        user_id INTEGER,
        booking_id TEXT,
        booked_at TEXT,
        PRIMARY KEY(movie_id, seat_number),
        FOREIGN KEY(movie_id) REFERENCES movies(id),
        FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS bookings (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        movie_id INTEGER NOT NULL,
        seats_json TEXT NOT NULL,
        total_usd REAL NOT NULL,
        currency_code TEXT NOT NULL,
        total_local REAL NOT NULL,
        payment_method TEXT NOT NULL DEFAULT 'UPI QR (Demo)',
        payment_status TEXT NOT NULL DEFAULT 'PAID (DEMO)',
        transaction_id TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(movie_id) REFERENCES movies(id)
    );
`);

// Safe migrations for databases created by an earlier version.
for (const statement of [
    "ALTER TABLE bookings ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'UPI QR (Demo)'",
    "ALTER TABLE bookings ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'PAID (DEMO)'",
    "ALTER TABLE bookings ADD COLUMN transaction_id TEXT"
]) {
    try { db.exec(statement); } catch (error) {
        if (!String(error.message).toLowerCase().includes("duplicate column")) throw error;
    }
}

const currencies = [
    ["USD", "US Dollar", "$", 1],
    ["INR", "Indian Rupee", "₹", 83.50],
    ["EUR", "Euro", "€", 0.92],
    ["GBP", "British Pound", "£", 0.78],
    ["JPY", "Japanese Yen", "¥", 157.00],
    ["AUD", "Australian Dollar", "A$", 1.52],
    ["CAD", "Canadian Dollar", "C$", 1.36],
    ["SGD", "Singapore Dollar", "S$", 1.30],
    ["AED", "UAE Dirham", "د.إ", 3.6725],
    ["SAR", "Saudi Riyal", "﷼", 3.75],
    ["CHF", "Swiss Franc", "CHF", 0.88],
    ["CNY", "Chinese Yuan", "¥", 7.15],
    ["NZD", "New Zealand Dollar", "NZ$", 1.69],
    ["ZAR", "South African Rand", "R", 17.70]
];

const countries = [
    ["IN", "India", "INR"], ["US", "United States", "USD"],
    ["GB", "United Kingdom", "GBP"], ["DE", "Germany", "EUR"],
    ["FR", "France", "EUR"], ["IT", "Italy", "EUR"],
    ["ES", "Spain", "EUR"], ["JP", "Japan", "JPY"],
    ["AU", "Australia", "AUD"], ["CA", "Canada", "CAD"],
    ["SG", "Singapore", "SGD"], ["AE", "United Arab Emirates", "AED"],
    ["SA", "Saudi Arabia", "SAR"], ["CH", "Switzerland", "CHF"],
    ["CN", "China", "CNY"], ["NZ", "New Zealand", "NZD"],
    ["ZA", "South Africa", "ZAR"]
];

const movies = [
    [1, "Avengers: Endgame", "Action", "18:00", 15],
    [2, "Dune: Part Two", "Sci-Fi", "20:30", 18],
    [3, "The Hangover", "Comedy", "15:00", 10],
    [4, "Interstellar", "Sci-Fi", "21:00", 16],
    [5, "The Dark Knight", "Action", "19:30", 14],
    [6, "Free Guy", "Comedy", "17:00", 12]
];

const insertCurrency = db.prepare(`
    INSERT OR IGNORE INTO currencies(code,name,symbol,rate_from_usd)
    VALUES(?,?,?,?)
`);
currencies.forEach(row => insertCurrency.run(...row));

const insertCountry = db.prepare(`
    INSERT OR IGNORE INTO countries(code,name,currency_code)
    VALUES(?,?,?)
`);
countries.forEach(row => insertCountry.run(...row));

const insertMovie = db.prepare(`
    INSERT OR IGNORE INTO movies(id,title,category,show_time,price_usd)
    VALUES(?,?,?,?,?)
`);
movies.forEach(row => insertMovie.run(...row));

const insertSeat = db.prepare(`
    INSERT OR IGNORE INTO seats(movie_id,seat_number)
    VALUES(?,?)
`);
for (const [movieId] of movies) {
    for (let seat = 1; seat <= 32; seat++) insertSeat.run(movieId, seat);
}

function json(res, status, data) {
    const body = JSON.stringify(data);
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
        "Cache-Control": "no-store"
    });
    res.end(body);
}

function parseCookies(req) {
    const result = {};
    const raw = req.headers.cookie || "";
    raw.split(";").forEach(part => {
        const index = part.indexOf("=");
        if (index < 0) return;
        const key = part.slice(0, index).trim();
        const value = part.slice(index + 1).trim();
        result[key] = decodeURIComponent(value);
    });
    return result;
}

function setCookie(res, name, value, options = {}) {
    let cookie = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax`;
    if (options.maxAge !== undefined) cookie += `; Max-Age=${options.maxAge}`;
    if (options.expires) cookie += `; Expires=${options.expires.toUTCString()}`;
    res.setHeader("Set-Cookie", cookie);
}

function sha256(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
}

function hashPassword(password, salt) {
    return crypto.scryptSync(password, salt, 64).toString("hex");
}

function createSession(userId) {
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = sha256(token);
    const expires = Date.now() + 1000 * 60 * 60 * 24 * 7;

    db.prepare(`
        INSERT INTO sessions(token_hash,user_id,expires_at)
        VALUES(?,?,?)
    `).run(tokenHash, userId, expires);

    return token;
}

function getUser(req) {
    const token = parseCookies(req).ibox_session;
    if (!token) return null;

    const row = db.prepare(`
        SELECT
            u.id, u.name, u.email, u.country_code AS country,
            c.name AS country_name,
            cur.code AS currency_code,
            cur.name AS currency_name,
            cur.symbol AS currency_symbol,
            cur.rate_from_usd AS currency_rate
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        JOIN countries c ON c.code = u.country_code
        JOIN currencies cur ON cur.code = c.currency_code
        WHERE s.token_hash = ? AND s.expires_at > ?
    `).get(sha256(token), Date.now());

    return row || null;
}

async function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = "";
        req.on("data", chunk => {
            body += chunk;
            if (body.length > 1024 * 1024) {
                req.destroy();
                reject(new Error("Request too large."));
            }
        });
        req.on("end", () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch {
                reject(new Error("Invalid JSON."));
            }
        });
        req.on("error", reject);
    });
}

function safeUser(row) {
    return {
        id: row.id,
        name: row.name,
        email: row.email,
        country: row.country,
        countryName: row.country_name,
        currency: {
            code: row.currency_code,
            name: row.currency_name,
            symbol: row.currency_symbol,
            rate: row.currency_rate
        }
    };
}

function validEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function serveStatic(req, res) {
    let requestPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
    if (requestPath === "/") requestPath = "/index.html";

    const filePath = path.normalize(path.join(PUBLIC_DIR, requestPath));

    if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
        return json(res, 403, { message: "Forbidden." });
    }

    fs.stat(filePath, (error, stat) => {
        if (error || !stat.isFile()) {
            return json(res, 404, { message: "Not found." });
        }

        const ext = path.extname(filePath).toLowerCase();
        const types = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".json": "application/json; charset=utf-8",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".svg": "image/svg+xml",
            ".ico": "image/x-icon"
        };

        res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
        fs.createReadStream(filePath).pipe(res);
    });
}

const server = http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const pathname = url.pathname;

        if (req.method === "GET" && pathname === "/api/countries") {
            const rows = db.prepare(`
                SELECT code,name FROM countries ORDER BY name
            `).all();

            return json(res, 200, { countries: rows });
        }

        if (req.method === "GET" && pathname.startsWith("/api/country/") && pathname.endsWith("/currency")) {
            const countryCode = decodeURIComponent(pathname.split("/")[3]).toUpperCase();

            const row = db.prepare(`
                SELECT
                    c.code AS country_code,
                    c.name AS country_name,
                    cur.code, cur.name, cur.symbol, cur.rate_from_usd
                FROM countries c
                JOIN currencies cur ON cur.code = c.currency_code
                WHERE c.code = ?
            `).get(countryCode);

            if (!row) return json(res, 404, { message: "Country not found." });

            return json(res, 200, {
                country: { code: row.country_code, name: row.country_name },
                currency: {
                    code: row.code,
                    name: row.name,
                    symbol: row.symbol,
                    rate: row.rate_from_usd
                }
            });
        }

        if (req.method === "POST" && pathname === "/api/auth/register") {
            const body = await readBody(req);
            const name = String(body.name || "").trim();
            const email = String(body.email || "").trim().toLowerCase();
            const password = String(body.password || "");
            const country = String(body.country || "").trim().toUpperCase();

            if (name.length < 2) return json(res, 400, { message: "Name must contain at least 2 characters." });
            if (!validEmail(email)) return json(res, 400, { message: "Enter a valid email address." });
            if (password.length < 6) return json(res, 400, { message: "Password must contain at least 6 characters." });

            const countryRow = db.prepare(`
                SELECT code FROM countries WHERE code = ?
            `).get(country);

            if (!countryRow) return json(res, 400, { message: "Please select a valid country." });

            const existing = db.prepare(`
                SELECT id FROM users WHERE email = ?
            `).get(email);

            if (existing) return json(res, 409, { message: "An account with this email already exists." });

            const salt = crypto.randomBytes(16).toString("hex");
            const passwordHash = hashPassword(password, salt);

            const result = db.prepare(`
                INSERT INTO users(name,email,password_hash,password_salt,country_code)
                VALUES(?,?,?,?,?)
            `).run(name, email, passwordHash, salt, country);

            const token = createSession(Number(result.lastInsertRowid));
            setCookie(res, "ibox_session", token, { maxAge: 60 * 60 * 24 * 7 });

            const userRow = db.prepare(`
                SELECT
                    u.id, u.name, u.email, u.country_code AS country,
                    c.name AS country_name,
                    cur.code AS currency_code,
                    cur.name AS currency_name,
                    cur.symbol AS currency_symbol,
                    cur.rate_from_usd AS currency_rate
                FROM users u
                JOIN countries c ON c.code = u.country_code
                JOIN currencies cur ON cur.code = c.currency_code
                WHERE u.id = ?
            `).get(Number(result.lastInsertRowid));

            return json(res, 201, { user: safeUser(userRow) });
        }

        if (req.method === "POST" && pathname === "/api/auth/login") {
            const body = await readBody(req);
            const email = String(body.email || "").trim().toLowerCase();
            const password = String(body.password || "");

            const row = db.prepare(`
                SELECT
                    u.*,
                    c.name AS country_name,
                    cur.code AS currency_code,
                    cur.name AS currency_name,
                    cur.symbol AS currency_symbol,
                    cur.rate_from_usd AS currency_rate
                FROM users u
                JOIN countries c ON c.code = u.country_code
                JOIN currencies cur ON cur.code = c.currency_code
                WHERE u.email = ?
            `).get(email);

            if (!row) return json(res, 401, { message: "Invalid email or password." });

            const attemptedHash = hashPassword(password, row.password_salt);

            if (!crypto.timingSafeEqual(
                Buffer.from(attemptedHash, "hex"),
                Buffer.from(row.password_hash, "hex")
            )) {
                return json(res, 401, { message: "Invalid email or password." });
            }

            const token = createSession(row.id);
            setCookie(res, "ibox_session", token, { maxAge: 60 * 60 * 24 * 7 });

            return json(res, 200, { user: safeUser(row) });
        }

        if (req.method === "POST" && pathname === "/api/auth/logout") {
            const token = parseCookies(req).ibox_session;

            if (token) {
                db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(sha256(token));
            }

            setCookie(res, "ibox_session", "", { maxAge: 0 });
            return json(res, 200, { message: "Logged out." });
        }

        if (req.method === "GET" && pathname === "/api/auth/me") {
            const user = getUser(req);

            if (!user) return json(res, 401, { message: "Not logged in." });

            return json(res, 200, { user: safeUser(user) });
        }

        if (req.method === "GET" && /^\/api\/movies\/\d+\/seats$/.test(pathname)) {
            const movieId = Number(pathname.split("/")[3]);

            const movie = db.prepare(`SELECT id FROM movies WHERE id = ?`).get(movieId);
            if (!movie) return json(res, 404, { message: "Movie not found." });

            const rows = db.prepare(`
                SELECT seat_number
                FROM seats
                WHERE movie_id = ? AND booking_id IS NOT NULL
                ORDER BY seat_number
            `).all(movieId);

            return json(res, 200, {
                occupiedSeats: rows.map(row => row.seat_number)
            });
        }

        if (req.method === "POST" && pathname === "/api/bookings") {
            const user = getUser(req);

            if (!user) return json(res, 401, { message: "Please login first." });

            const body = await readBody(req);
            const movieId = Number(body.movieId);
            const seats = Array.isArray(body.seats)
                ? [...new Set(body.seats.map(Number))]
                : [];
            const paymentMethod = String(body.paymentMethod || "UPI QR (Demo)").slice(0, 80);
            const paymentStatus = String(body.paymentStatus || "PAID (DEMO)").slice(0, 30);

            if (!Number.isInteger(movieId)) {
                return json(res, 400, { message: "Invalid movie." });
            }

            if (!seats.length || seats.some(s => !Number.isInteger(s) || s < 1 || s > 32)) {
                return json(res, 400, { message: "Select valid seats." });
            }

            if (paymentStatus !== "PAID (DEMO)" || !paymentMethod.includes("Demo")) {
                return json(res, 400, { message: "Only the built-in demo payment is supported." });
            }

            const movie = db.prepare(`
                SELECT id,title,category,show_time,price_usd
                FROM movies WHERE id = ?
            `).get(movieId);

            if (!movie) return json(res, 404, { message: "Movie not found." });

            const currencyRow = db.prepare(`
                SELECT cur.code,cur.symbol,cur.rate_from_usd
                FROM users u
                JOIN countries c ON c.code = u.country_code
                JOIN currencies cur ON cur.code = c.currency_code
                WHERE u.id = ?
            `).get(user.id);

            const totalUsd = movie.price_usd * seats.length;
            const totalLocal = totalUsd * currencyRow.rate_from_usd;
            const bookingId = "IBOX-" + Date.now().toString().slice(-8);
            const transactionId = "DEMO-" + Date.now().toString().slice(-10);
            const now = new Date().toLocaleString("en-IN");

            db.exec("BEGIN IMMEDIATE");

            try {
                const placeholders = seats.map(() => "?").join(",");
                const occupied = db.prepare(`
                    SELECT seat_number
                    FROM seats
                    WHERE movie_id = ? AND seat_number IN (${placeholders})
                      AND booking_id IS NOT NULL
                `).all(movieId, ...seats);

                if (occupied.length) {
                    db.exec("ROLLBACK");
                    return json(res, 409, {
                        message: `Seat(s) ${occupied.map(x => x.seat_number).join(", ")} were just booked by another user.`
                    });
                }

                db.prepare(`
                    INSERT INTO bookings(
                        id,user_id,movie_id,seats_json,total_usd,
                        currency_code,total_local,payment_method,
                        payment_status,transaction_id,created_at
                    )
                    VALUES(?,?,?,?,?,?,?,?,?,?,?)
                `).run(
                    bookingId,
                    user.id,
                    movieId,
                    JSON.stringify(seats),
                    totalUsd,
                    currencyRow.code,
                    totalLocal,
                    paymentMethod,
                    paymentStatus,
                    transactionId,
                    new Date().toISOString()
                );

                const updateSeat = db.prepare(`
                    UPDATE seats
                    SET user_id = ?, booking_id = ?, booked_at = ?
                    WHERE movie_id = ? AND seat_number = ?
                `);

                seats.forEach(seat => {
                    updateSeat.run(user.id, bookingId, new Date().toISOString(), movieId, seat);
                });

                db.exec("COMMIT");

                return json(res, 201, {
                    booking: {
                        id: bookingId,
                        user: user.name,
                        movie: movie.title,
                        category: movie.category,
                        time: movie.show_time,
                        seats,
                        totalPaid: totalLocal,
                        currencyCode: currencyRow.code,
                        currencySymbol: currencyRow.symbol,
                        paymentMethod,
                        paymentStatus,
                        transactionId,
                        date: now
                    }
                });
            } catch (error) {
                db.exec("ROLLBACK");
                throw error;
            }
        }

        return serveStatic(req, res);
    } catch (error) {
        console.error(error);
        return json(res, 500, { message: "Internal server error." });
    }
});

server.listen(PORT, HOST, () => {
    console.log(`IBOX x CVR's server running at http://localhost:${PORT}`);
    console.log(`Database: ${DB_FILE}`);
});

"use strict";

const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PRODUCTION = NODE_ENV === "production";
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const TRUST_PROXY = process.env.TRUST_PROXY === "true";
const PUBLIC_ORIGIN = String(process.env.PUBLIC_ORIGIN || "").replace(/\/$/, "");
const SESSION_SECRET = process.env.SESSION_SECRET || (!IS_PRODUCTION ? "dev-only-change-me" : "");
const MAX_BODY_BYTES = 1024 * 1024;
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const RATE_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const AUTH_RATE_MAX = Number(process.env.AUTH_RATE_LIMIT_MAX || 10);
const REGISTER_RATE_MAX = Number(process.env.REGISTER_RATE_LIMIT_MAX || 5);
const BOOKING_RATE_MAX = Number(process.env.BOOKING_RATE_LIMIT_MAX || 20);

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error("PORT must be an integer between 1 and 65535.");
if (IS_PRODUCTION && !SESSION_SECRET) throw new Error("SESSION_SECRET is required in production.");
if (IS_PRODUCTION && SESSION_SECRET.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters in production.");
if (IS_PRODUCTION && !PUBLIC_ORIGIN) throw new Error("PUBLIC_ORIGIN is required in production, e.g. https://your-domain.com");

const ROOT = __dirname;
const PUBLIC_DIR = ROOT;
const DB_FILE = path.join(ROOT, "ibox_booking.sqlite");
const TLS_CERT_FILE = process.env.TLS_CERT_FILE || "";
const TLS_KEY_FILE = process.env.TLS_KEY_FILE || "";
const DIRECT_HTTPS = Boolean(TLS_CERT_FILE && TLS_KEY_FILE);

if (IS_PRODUCTION && !DIRECT_HTTPS && !TRUST_PROXY) {
    throw new Error("Production requires HTTPS. Provide TLS_CERT_FILE/TLS_KEY_FILE or set TRUST_PROXY=true when TLS is terminated by a trusted reverse proxy.");
}

const db = new DatabaseSync(DB_FILE);
db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;

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
    ["USD", "US Dollar", "$", 1], ["INR", "Indian Rupee", "₹", 83.50],
    ["EUR", "Euro", "€", 0.92], ["GBP", "British Pound", "£", 0.78],
    ["JPY", "Japanese Yen", "¥", 157.00], ["AUD", "Australian Dollar", "A$", 1.52],
    ["CAD", "Canadian Dollar", "C$", 1.36], ["SGD", "Singapore Dollar", "S$", 1.30],
    ["AED", "UAE Dirham", "د.إ", 3.6725], ["SAR", "Saudi Riyal", "﷼", 3.75],
    ["CHF", "Swiss Franc", "CHF", 0.88], ["CNY", "Chinese Yuan", "¥", 7.15],
    ["NZD", "New Zealand Dollar", "NZ$", 1.69], ["ZAR", "South African Rand", "R", 17.70]
];
const countries = [
    ["IN", "India", "INR"], ["US", "United States", "USD"], ["GB", "United Kingdom", "GBP"],
    ["DE", "Germany", "EUR"], ["FR", "France", "EUR"], ["IT", "Italy", "EUR"],
    ["ES", "Spain", "EUR"], ["JP", "Japan", "JPY"], ["AU", "Australia", "AUD"],
    ["CA", "Canada", "CAD"], ["SG", "Singapore", "SGD"], ["AE", "United Arab Emirates", "AED"],
    ["SA", "Saudi Arabia", "SAR"], ["CH", "Switzerland", "CHF"], ["CN", "China", "CNY"],
    ["NZ", "New Zealand", "NZD"], ["ZA", "South Africa", "ZAR"]
];
const movies = [
    [1, "Avengers: Endgame", "Action", "18:00", 15], [2, "Dune: Part Two", "Sci-Fi", "20:30", 18],
    [3, "The Hangover", "Comedy", "15:00", 10], [4, "Interstellar", "Sci-Fi", "21:00", 16],
    [5, "The Dark Knight", "Action", "19:30", 14], [6, "Free Guy", "Comedy", "17:00", 12]
];

const insertCurrency = db.prepare(`INSERT OR IGNORE INTO currencies(code,name,symbol,rate_from_usd) VALUES(?,?,?,?)`);
currencies.forEach(row => insertCurrency.run(...row));
const insertCountry = db.prepare(`INSERT OR IGNORE INTO countries(code,name,currency_code) VALUES(?,?,?)`);
countries.forEach(row => insertCountry.run(...row));
const insertMovie = db.prepare(`INSERT OR IGNORE INTO movies(id,title,category,show_time,price_usd) VALUES(?,?,?,?,?)`);
movies.forEach(row => insertMovie.run(...row));
const insertSeat = db.prepare(`INSERT OR IGNORE INTO seats(movie_id,seat_number) VALUES(?,?)`);
for (const [movieId] of movies) for (let seat = 1; seat <= 32; seat++) insertSeat.run(movieId, seat);

const rateBuckets = new Map();
function clientIp(req) {
    if (TRUST_PROXY) {
        const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
        if (forwarded) return forwarded.slice(0, 100);
    }
    return req.socket.remoteAddress || "unknown";
}
function rateLimit(req, bucket, max, windowMs = RATE_WINDOW_MS) {
    const key = `${bucket}:${clientIp(req)}`;
    const now = Date.now();
    const current = rateBuckets.get(key);
    if (!current || current.resetAt <= now) {
        rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
        return { allowed: true, retryAfter: 0 };
    }
    if (current.count >= max) return { allowed: false, retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
    current.count += 1;
    return { allowed: true, retryAfter: 0 };
}
setInterval(() => {
    const now = Date.now();
    for (const [key, value] of rateBuckets) if (value.resetAt <= now) rateBuckets.delete(key);
}, Math.max(60_000, RATE_WINDOW_MS)).unref();

function addSecurityHeaders(res) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
    if (IS_PRODUCTION) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
}
function json(res, status, data, extraHeaders = {}) {
    const body = JSON.stringify(data);
    addSecurityHeaders(res);
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store", ...extraHeaders });
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
        try { result[key] = decodeURIComponent(value); } catch { result[key] = ""; }
    });
    return result;
}
function setCookie(res, name, value, options = {}) {
    let cookie = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict`;
    if (IS_PRODUCTION) cookie += "; Secure";
    if (options.httpOnly === false) cookie = cookie.replace("HttpOnly; ", "");
    if (options.maxAge !== undefined) cookie += `; Max-Age=${options.maxAge}`;
    if (options.expires) cookie += `; Expires=${options.expires.toUTCString()}`;
    const existing = res.getHeader("Set-Cookie");
    const values = existing ? (Array.isArray(existing) ? existing : [existing]) : [];
    res.setHeader("Set-Cookie", [...values, cookie]);
}
function hashPassword(password, salt) { return crypto.scryptSync(password, salt, 64, { N: 131072, r: 8, p: 1 }).toString("hex"); }
function sessionHash(token) { return crypto.createHmac("sha256", SESSION_SECRET).update(token).digest("hex"); }
function createSession(userId) {
    const token = crypto.randomBytes(32).toString("hex");
    const expires = Date.now() + SESSION_TTL_MS;
    db.prepare(`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)`).run(sessionHash(token), userId, expires);
    return token;
}
function createBookingId(prefix) {
    return `${prefix}-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
}
function getUser(req) {
    const token = parseCookies(req).ibox_session;
    if (!token) return null;
    const row = db.prepare(`
        SELECT u.id,u.name,u.email,u.country_code AS country,c.name AS country_name,
               cur.code AS currency_code,cur.name AS currency_name,cur.symbol AS currency_symbol,
               cur.rate_from_usd AS currency_rate
        FROM sessions s JOIN users u ON u.id=s.user_id JOIN countries c ON c.code=u.country_code
        JOIN currencies cur ON cur.code=c.currency_code
        WHERE s.token_hash=? AND s.expires_at>?
    `).get(sessionHash(token), Date.now());
    return row || null;
}
function safeUser(row) {
    return { id: row.id, name: row.name, email: row.email, country: row.country, countryName: row.country_name,
        currency: { code: row.currency_code, name: row.currency_name, symbol: row.currency_symbol, rate: row.currency_rate } };
}
function validEmail(email) { return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function validPassword(password) {
    if (password.length < 12 || password.length > 128) return false;
    const common = new Set(["password123456", "password123", "123456789012", "qwertyuiop12", "admin123456", "letmein123456"]);
    return !common.has(password.toLowerCase());
}
async function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = "";
        let rejected = false;
        req.on("data", chunk => {
            body += chunk;
            if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES && !rejected) {
                rejected = true;
                reject(new Error("Request too large."));
                req.resume();
            }
        });
        req.on("end", () => {
            if (rejected) return;
            try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error("Invalid JSON.")); }
        });
        req.on("error", reject);
    });
}
function requestOrigin(req) {
    if (PUBLIC_ORIGIN) return PUBLIC_ORIGIN;
    const forwardedProto = TRUST_PROXY && req.headers["x-forwarded-proto"] ? String(req.headers["x-forwarded-proto"]).split(",")[0].trim() : "";
    const protocol = DIRECT_HTTPS || forwardedProto === "https" ? "https" : "http";
    return `${protocol}://${req.headers.host}`.replace(/\/$/, "");
}
function csrfAllowed(req) {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return true;
    const fetchSite = String(req.headers["sec-fetch-site"] || "").toLowerCase();
    if (fetchSite === "cross-site") return false;
    const expected = requestOrigin(req);
    const origin = String(req.headers.origin || "").replace(/\/$/, "");
    if (origin) return origin === expected;
    const referer = String(req.headers.referer || "");
    if (referer) { try { return new URL(referer).origin === expected; } catch { return false; } }
    return false;
}
function clearSessionCookie(res) { setCookie(res, "ibox_session", "", { maxAge: 0 }); }
function serveStatic(req, res) {
    let requestPath;
    try { requestPath = decodeURIComponent(new URL(req.url, requestOrigin(req)).pathname); }
    catch { return json(res, 400, { message: "Invalid URL." }); }
    if (requestPath === "/") requestPath = "/index.html";
    const filePath = path.normalize(path.join(PUBLIC_DIR, requestPath));
    if (!filePath.startsWith(PUBLIC_DIR + path.sep)) return json(res, 403, { message: "Forbidden." });
    fs.stat(filePath, (error, stat) => {
        if (error || !stat.isFile()) return json(res, 404, { message: "Not found." });
        const ext = path.extname(filePath).toLowerCase();
        const types = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".json":"application/json; charset=utf-8", ".png":"image/png", ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".webp":"image/webp", ".svg":"image/svg+xml", ".ico":"image/x-icon", ".woff":"font/woff", ".woff2":"font/woff2" };
        addSecurityHeaders(res);
        res.setHeader("Cache-Control", IS_PRODUCTION ? "public, max-age=300" : "no-cache");
        res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
        fs.createReadStream(filePath).pipe(res);
    });
}

async function handler(req, res) {
    try {
        addSecurityHeaders(res);
        const url = new URL(req.url, requestOrigin(req));
        const pathname = url.pathname;
        if (!csrfAllowed(req)) return json(res, 403, { message: "CSRF protection rejected this request." });

        if (req.method === "POST" && pathname === "/api/auth/login") {
            const limit = rateLimit(req, "login", AUTH_RATE_MAX);
            if (!limit.allowed) return json(res, 429, { message: "Too many login attempts. Please try again later." }, { "Retry-After": String(limit.retryAfter) });
            const body = await readBody(req);
            const email = String(body.email || "").trim().toLowerCase();
            const password = String(body.password || "");
            if (!validEmail(email) || password.length > 128) return json(res, 401, { message: "Invalid email or password." });
            const row = db.prepare(`SELECT u.*,c.name AS country_name,cur.code AS currency_code,cur.name AS currency_name,cur.symbol AS currency_symbol,cur.rate_from_usd AS currency_rate FROM users u JOIN countries c ON c.code=u.country_code JOIN currencies cur ON cur.code=c.currency_code WHERE u.email=?`).get(email);
            if (!row) return json(res, 401, { message: "Invalid email or password." });
            const attemptedHash = hashPassword(password, row.password_salt);
            const ok = crypto.timingSafeEqual(Buffer.from(attemptedHash, "hex"), Buffer.from(row.password_hash, "hex"));
            if (!ok) return json(res, 401, { message: "Invalid email or password." });
            const token = createSession(row.id);
            setCookie(res, "ibox_session", token, { maxAge: SESSION_TTL_MS / 1000 });
            return json(res, 200, { user: safeUser(row) });
        }

        if (req.method === "POST" && pathname === "/api/auth/register") {
            const limit = rateLimit(req, "register", REGISTER_RATE_MAX, 60 * 60 * 1000);
            if (!limit.allowed) return json(res, 429, { message: "Too many registration attempts. Please try again later." }, { "Retry-After": String(limit.retryAfter) });
            const body = await readBody(req);
            const name = String(body.name || "").trim();
            const email = String(body.email || "").trim().toLowerCase();
            const password = String(body.password || "");
            const country = String(body.country || "").trim().toUpperCase();
            if (name.length < 2 || name.length > 80) return json(res, 400, { message: "Name must contain 2-80 characters." });
            if (!validEmail(email)) return json(res, 400, { message: "Enter a valid email address." });
            if (!validPassword(password)) return json(res, 400, { message: "Password must be 12-128 characters and should not be a common password." });
            const countryRow = db.prepare(`SELECT code FROM countries WHERE code=?`).get(country);
            if (!countryRow) return json(res, 400, { message: "Please select a valid country." });
            const existing = db.prepare(`SELECT id FROM users WHERE email=?`).get(email);
            if (existing) return json(res, 409, { message: "An account with this email already exists." });
            const salt = crypto.randomBytes(16).toString("hex");
            const passwordHash = hashPassword(password, salt);
            const result = db.prepare(`INSERT INTO users(name,email,password_hash,password_salt,country_code) VALUES(?,?,?,?,?)`).run(name,email,passwordHash,salt,country);
            const token = createSession(Number(result.lastInsertRowid));
            setCookie(res, "ibox_session", token, { maxAge: SESSION_TTL_MS / 1000 });
            const userRow = db.prepare(`SELECT u.id,u.name,u.email,u.country_code AS country,c.name AS country_name,cur.code AS currency_code,cur.name AS currency_name,cur.symbol AS currency_symbol,cur.rate_from_usd AS currency_rate FROM users u JOIN countries c ON c.code=u.country_code JOIN currencies cur ON cur.code=c.currency_code WHERE u.id=?`).get(Number(result.lastInsertRowid));
            return json(res, 201, { user: safeUser(userRow) });
        }

        if (req.method === "POST" && pathname === "/api/auth/logout") {
            const token = parseCookies(req).ibox_session;
            if (token) db.prepare(`DELETE FROM sessions WHERE token_hash=?`).run(sessionHash(token));
            clearSessionCookie(res);
            return json(res, 200, { message: "Logged out." });
        }
        if (req.method === "GET" && pathname === "/api/auth/me") {
            const user = getUser(req);
            if (!user) return json(res, 401, { message: "Not logged in." });
            return json(res, 200, { user: safeUser(user) });
        }
        if (req.method === "GET" && pathname === "/api/countries") {
            return json(res, 200, { countries: db.prepare(`SELECT code,name FROM countries ORDER BY name`).all() });
        }
        if (req.method === "GET" && pathname.startsWith("/api/country/") && pathname.endsWith("/currency")) {
            const countryCode = decodeURIComponent(pathname.split("/")[3]).toUpperCase();
            const row = db.prepare(`SELECT c.code AS country_code,c.name AS country_name,cur.code,cur.name,cur.symbol,cur.rate_from_usd FROM countries c JOIN currencies cur ON cur.code=c.currency_code WHERE c.code=?`).get(countryCode);
            if (!row) return json(res, 404, { message: "Country not found." });
            return json(res, 200, { country:{code:row.country_code,name:row.country_name}, currency:{code:row.code,name:row.name,symbol:row.symbol,rate:row.rate_from_usd} });
        }
        if (req.method === "GET" && /^\/api\/movies\/\d+\/seats$/.test(pathname)) {
            const movieId = Number(pathname.split("/")[3]);
            if (!db.prepare(`SELECT id FROM movies WHERE id=?`).get(movieId)) return json(res, 404, { message: "Movie not found." });
            const rows = db.prepare(`SELECT seat_number FROM seats WHERE movie_id=? AND booking_id IS NOT NULL ORDER BY seat_number`).all(movieId);
            return json(res, 200, { occupiedSeats: rows.map(row => row.seat_number) });
        }
        if (req.method === "POST" && pathname === "/api/bookings") {
            const limit = rateLimit(req, "booking", BOOKING_RATE_MAX, 10 * 60 * 1000);
            if (!limit.allowed) return json(res, 429, { message: "Too many booking requests. Please wait before trying again." }, { "Retry-After": String(limit.retryAfter) });
            const user = getUser(req);
            if (!user) return json(res, 401, { message: "Please login first." });
            const body = await readBody(req);
            const movieId = Number(body.movieId);
            const seats = Array.isArray(body.seats) ? [...new Set(body.seats.map(Number))] : [];
            const paymentMethod = String(body.paymentMethod || "UPI QR (Demo)").slice(0,80);
            const paymentStatus = String(body.paymentStatus || "PAID (DEMO)").slice(0,30);
            if (!Number.isInteger(movieId)) return json(res, 400, { message: "Invalid movie." });
            if (!seats.length || seats.length > 32 || seats.some(s => !Number.isInteger(s) || s < 1 || s > 32)) return json(res, 400, { message: "Select valid seats." });
            if (paymentStatus !== "PAID (DEMO)" || !paymentMethod.includes("Demo")) return json(res, 400, { message: "Only the built-in demo payment is supported." });
            const movie = db.prepare(`SELECT id,title,category,show_time,price_usd FROM movies WHERE id=?`).get(movieId);
            if (!movie) return json(res, 404, { message: "Movie not found." });
            const currencyRow = db.prepare(`SELECT cur.code,cur.symbol,cur.rate_from_usd FROM users u JOIN countries c ON c.code=u.country_code JOIN currencies cur ON cur.code=c.currency_code WHERE u.id=?`).get(user.id);
            if (!currencyRow) return json(res, 400, { message: "User currency is unavailable." });
            const totalUsd = movie.price_usd * seats.length;
            const totalLocal = totalUsd * currencyRow.rate_from_usd;
            const bookingId = createBookingId("IBOX");
            const transactionId = createBookingId("DEMO");
            const now = new Date().toLocaleString("en-IN");
            db.exec("BEGIN IMMEDIATE");
            try {
                const placeholders = seats.map(() => "?").join(",");
                const occupied = db.prepare(`SELECT seat_number FROM seats WHERE movie_id=? AND seat_number IN (${placeholders}) AND booking_id IS NOT NULL`).all(movieId,...seats);
                if (occupied.length) { db.exec("ROLLBACK"); return json(res,409,{message:`Seat(s) ${occupied.map(x=>x.seat_number).join(", ")} were just booked by another user.`}); }
                db.prepare(`INSERT INTO bookings(id,user_id,movie_id,seats_json,total_usd,currency_code,total_local,payment_method,payment_status,transaction_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(bookingId,user.id,movieId,JSON.stringify(seats),totalUsd,currencyRow.code,totalLocal,paymentMethod,paymentStatus,transactionId,new Date().toISOString());
                const updateSeat = db.prepare(`UPDATE seats SET user_id=?,booking_id=?,booked_at=? WHERE movie_id=? AND seat_number=? AND booking_id IS NULL`);
                const bookedAt = new Date().toISOString();
                const updateResults = seats.map(seat => updateSeat.run(user.id,bookingId,bookedAt,movieId,seat));
                const updatedCount = updateResults.reduce((count, result) => count + (Number(result.changes) === 1 ? 1 : 0), 0);
                if (updatedCount !== seats.length) {
                    db.exec("ROLLBACK");
                    return json(res,409,{message:"One or more selected seats became unavailable. Please choose again."});
                }
                db.exec("COMMIT");
                return json(res,201,{booking:{id:bookingId,user:user.name,movie:movie.title,category:movie.category,time:movie.show_time,seats,totalPaid:totalLocal,currencyCode:currencyRow.code,currencySymbol:currencyRow.symbol,paymentMethod,paymentStatus,transactionId,date:now}});
            } catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
        }
        return serveStatic(req,res);
    } catch (error) {
        console.error(error);
        return json(res,500,{message: IS_PRODUCTION ? "Internal server error." : String(error.message || "Internal server error.")});
    }
}

const server = DIRECT_HTTPS
    ? https.createServer({ key: fs.readFileSync(TLS_KEY_FILE), cert: fs.readFileSync(TLS_CERT_FILE) }, handler)
    : http.createServer(handler);
server.listen(PORT,HOST,() => {
    const scheme = DIRECT_HTTPS ? "https" : "http";
    console.log(`IBOX x CVR's server running at ${scheme}://localhost:${PORT}`);
    console.log(`Database: ${DB_FILE}`);
    console.log(`Environment: ${NODE_ENV}`);
    console.log(`HTTPS mode: ${DIRECT_HTTPS ? "direct TLS" : TRUST_PROXY ? "reverse proxy TLS" : "development HTTP"}`);
});

"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const Razorpay = require("razorpay");

const ROOT = __dirname;
const DB_FILE = path.join(ROOT, "ibox_booking.sqlite");
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-only-change-me";
const INR_PER_USD = Number(process.env.PAYMENT_USD_TO_INR || 83.5);
const KEY_ID = String(process.env.RAZORPAY_KEY_ID || "").trim();
const KEY_SECRET = String(process.env.RAZORPAY_KEY_SECRET || "").trim();
const razorpay = KEY_ID && KEY_SECRET ? new Razorpay({ key_id: KEY_ID, key_secret: KEY_SECRET }) : null;
const db = new DatabaseSync(DB_FILE);

db.exec(`
  CREATE TABLE IF NOT EXISTS payment_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    razorpay_order_id TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    movie_id INTEGER NOT NULL,
    seats_json TEXT NOT NULL,
    amount_inr INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'CREATED',
    razorpay_payment_id TEXT,
    created_at TEXT NOT NULL,
    paid_at TEXT
  );
`);

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
}

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || "").split(";").forEach(part => {
    const i = part.indexOf("=");
    if (i < 0) return;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function sessionHash(token) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(token).digest("hex");
}

function getUser(req) {
  const token = parseCookies(req).ibox_session;
  if (!token) return null;
  return db.prepare(`
    SELECT u.id,u.name,u.email,u.country_code AS country,
           cur.code AS currency_code,cur.symbol AS currency_symbol,cur.rate_from_usd AS currency_rate
    FROM sessions s
    JOIN users u ON u.id=s.user_id
    JOIN countries c ON c.code=u.country_code
    JOIN currencies cur ON cur.code=c.currency_code
    WHERE s.token_hash=? AND s.expires_at>?
  `).get(sessionHash(token), Date.now()) || null;
}

async function readBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 1024 * 1024) throw new Error("Request too large.");
  }
  return body ? JSON.parse(body) : {};
}

function validSeats(value) {
  return Array.isArray(value) && value.length > 0 && value.length <= 32 &&
    [...new Set(value.map(Number))].length === value.length &&
    value.every(seat => Number.isInteger(Number(seat)) && Number(seat) >= 1 && Number(seat) <= 32);
}

function amountForMovie(movie, seats) {
  return Math.round(Number(movie.price_usd) * seats.length * INR_PER_USD * 100);
}

function verifySignature(orderId, paymentId, signature) {
  const expected = crypto.createHmac("sha256", KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex");
  const actual = String(signature || "");
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

function ensureBookingPaymentColumns() {
  for (const statement of [
    "ALTER TABLE bookings ADD COLUMN razorpay_order_id TEXT",
    "ALTER TABLE bookings ADD COLUMN razorpay_payment_id TEXT",
    "ALTER TABLE bookings ADD COLUMN razorpay_signature TEXT"
  ]) {
    try { db.exec(statement); } catch (error) {
      if (!String(error.message).toLowerCase().includes("duplicate column")) throw error;
    }
  }
}

async function handle(req, res) {
  const url = new URL(req.url, "http://localhost");

  if (req.method === "POST" && url.pathname === "/api/payment/order") {
    if (!razorpay) return json(res, 503, { message: "Razorpay is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to .env." });
    const user = getUser(req);
    if (!user) return json(res, 401, { message: "Please login first." });

    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { message: "Invalid payment request." }); }
    const movieId = Number(body.movieId);
    const seats = Array.isArray(body.seats) ? [...new Set(body.seats.map(Number))] : [];
    if (!Number.isInteger(movieId) || !validSeats(seats)) return json(res, 400, { message: "Invalid movie or seats." });

    const movie = db.prepare("SELECT id,title,price_usd FROM movies WHERE id=?").get(movieId);
    if (!movie) return json(res, 404, { message: "Movie not found." });

    const placeholders = seats.map(() => "?").join(",");
    const occupied = db.prepare(`SELECT seat_number FROM seats WHERE movie_id=? AND seat_number IN (${placeholders}) AND booking_id IS NOT NULL`).all(movieId, ...seats);
    if (occupied.length) return json(res, 409, { message: `Seat(s) ${occupied.map(x => x.seat_number).join(", ")} are already booked.` });

    const activeOrders = db.prepare("SELECT seats_json FROM payment_orders WHERE movie_id=? AND status='CREATED' AND created_at>? ").all(movieId, new Date(Date.now() - 15 * 60 * 1000).toISOString());
    const requested = new Set(seats);
    for (const row of activeOrders) {
      const existing = JSON.parse(row.seats_json).map(Number);
      if (existing.some(seat => requested.has(seat))) return json(res, 409, { message: "One or more seats are currently in another payment session. Please choose again in a moment." });
    }

    const amountInr = amountForMovie(movie, seats);
    if (!Number.isInteger(amountInr) || amountInr < 100) return json(res, 400, { message: "Payment amount is invalid." });

    try {
      const order = await razorpay.orders.create({
        amount: amountInr,
        currency: "INR",
        receipt: `ibox_${Date.now()}_${user.id}`.slice(0, 40),
        notes: { movie_id: String(movieId), user_id: String(user.id), seats: seats.join(",") }
      });
      db.prepare(`INSERT INTO payment_orders(razorpay_order_id,user_id,movie_id,seats_json,amount_inr,status,created_at) VALUES(?,?,?,?,?,'CREATED',?)`)
        .run(order.id, user.id, movieId, JSON.stringify(seats), amountInr, new Date().toISOString());
      return json(res, 200, { keyId: KEY_ID, orderId: order.id, amount: amountInr, currency: "INR", amountInr: amountInr / 100, movie: movie.title });
    } catch (error) {
      console.error("Razorpay order creation failed:", error);
      return json(res, 502, { message: "Unable to create the Razorpay payment order." });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/bookings") {
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { message: "Invalid booking request." }); }
    if (String(body.paymentStatus || "") !== "PAID (RAZORPAY)") return json(res, 400, { message: "Real Razorpay payment is required. Demo payment is disabled." });
    if (!razorpay) return json(res, 503, { message: "Razorpay is not configured." });
    const user = getUser(req);
    if (!user) return json(res, 401, { message: "Please login first." });

    const movieId = Number(body.movieId);
    const seats = Array.isArray(body.seats) ? [...new Set(body.seats.map(Number))] : [];
    const orderId = String(body.razorpayOrderId || "");
    const paymentId = String(body.razorpayPaymentId || "");
    const signature = String(body.razorpaySignature || "");
    if (!Number.isInteger(movieId) || !validSeats(seats) || !orderId || !paymentId || !signature) return json(res, 400, { message: "Incomplete Razorpay payment details." });

    const pending = db.prepare("SELECT * FROM payment_orders WHERE razorpay_order_id=? AND user_id=? AND status='CREATED'").get(orderId, user.id);
    if (!pending) return json(res, 409, { message: "Payment order is invalid, expired, or already used." });
    if (Number(pending.movie_id) !== movieId || JSON.stringify(JSON.parse(pending.seats_json).map(Number).sort((a,b)=>a-b)) !== JSON.stringify([...seats].sort((a,b)=>a-b))) return json(res, 400, { message: "Payment order does not match the selected movie or seats." });
    if (!verifySignature(orderId, paymentId, signature)) return json(res, 400, { message: "Razorpay signature verification failed." });

    try {
      const payment = await razorpay.payments.fetch(paymentId);
      if (String(payment.order_id) !== orderId) return json(res, 400, { message: "Payment/order mismatch." });
      if (String(payment.status) !== "captured") return json(res, 400, { message: `Payment is not captured yet (status: ${payment.status}).` });
      if (Number(payment.amount) !== Number(pending.amount_inr)) return json(res, 400, { message: "Payment amount mismatch." });
    } catch (error) {
      console.error("Razorpay payment verification failed:", error);
      return json(res, 502, { message: "Could not verify the Razorpay payment." });
    }

    ensureBookingPaymentColumns();
    const movie = db.prepare("SELECT id,title,category,show_time,price_usd FROM movies WHERE id=?").get(movieId);
    if (!movie) return json(res, 404, { message: "Movie not found." });
    const placeholders = seats.map(() => "?").join(",");
    const occupied = db.prepare(`SELECT seat_number FROM seats WHERE movie_id=? AND seat_number IN (${placeholders}) AND booking_id IS NOT NULL`).all(movieId, ...seats);
    if (occupied.length) return json(res, 409, { message: `Seat(s) ${occupied.map(x=>x.seat_number).join(", ")} were booked before payment confirmation.` });

    const bookingId = `IBOX-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
    const totalUsd = Number(movie.price_usd) * seats.length;
    const totalInr = Number(pending.amount_inr) / 100;
    const now = new Date().toISOString();
    db.exec("BEGIN IMMEDIATE");
    try {
      const stillOccupied = db.prepare(`SELECT seat_number FROM seats WHERE movie_id=? AND seat_number IN (${placeholders}) AND booking_id IS NOT NULL`).all(movieId, ...seats);
      if (stillOccupied.length) { db.exec("ROLLBACK"); return json(res,409,{message:"One or more seats became unavailable."}); }
      db.prepare(`INSERT INTO bookings(id,user_id,movie_id,seats_json,total_usd,currency_code,total_local,payment_method,payment_status,transaction_id,created_at,razorpay_order_id,razorpay_payment_id,razorpay_signature) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(bookingId,user.id,movieId,JSON.stringify(seats),totalUsd,"INR",totalInr,"Razorpay","PAID",paymentId,now,orderId,paymentId,signature);
      const update = db.prepare("UPDATE seats SET user_id=?,booking_id=?,booked_at=? WHERE movie_id=? AND seat_number=? AND booking_id IS NULL");
      const results = seats.map(seat => update.run(user.id,bookingId,now,movieId,seat));
      if (results.reduce((n,r)=>n+Number(r.changes||0),0) !== seats.length) { db.exec("ROLLBACK"); return json(res,409,{message:"Seat confirmation failed. Please contact support if payment was captured."}); }
      db.prepare("UPDATE payment_orders SET status='PAID',razorpay_payment_id=?,paid_at=? WHERE id=?").run(paymentId,now,pending.id);
      db.exec("COMMIT");
      return json(res,201,{booking:{id:bookingId,movie:movie.title,seats,totalInr,currency:"INR",paymentMethod:"Razorpay",paymentStatus:"PAID",transactionId:paymentId}});
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      console.error("Booking transaction failed:", error);
      return json(res,500,{message:"Booking could not be completed after payment verification."});
    }
  }

  return null;
}

function patchServerModule(serverModule) {
  const original = serverModule.createServer;
  serverModule.createServer = function patchedCreateServer(...args) {
    const listener = args.find(arg => typeof arg === "function");
    if (!listener) return original.apply(this, args);
    const wrapped = async function(req, res) {
      try {
        const handled = await handle(req, res);
        if (handled) return;
      } catch (error) {
        console.error("Payment hook error:", error);
        if (!res.headersSent) return json(res, 500, { message: "Payment service error." });
      }
      return listener(req, res);
    };
    const patchedArgs = args.map(arg => arg === listener ? wrapped : arg);
    return original.apply(this, patchedArgs);
  };
}

patchServerModule(require("node:http"));
patchServerModule(require("node:https"));

console.log(`Razorpay gateway: ${razorpay ? "configured" : "NOT configured (add RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET)"}`);

"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const Razorpay = require("razorpay");
const { DatabaseSync } = require("node:sqlite");

const ROOT = __dirname;
const DB_FILE = path.join(ROOT, "ibox_booking.sqlite");
const CINEMA_FILE = path.join(ROOT, "MAHARASHTRA_CINEMAS.json");
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-only-change-me";
const INR_PER_USD = Number(process.env.PAYMENT_USD_TO_INR || 83.5);
const KEY_ID = String(process.env.RAZORPAY_KEY_ID || "").trim();
const KEY_SECRET = String(process.env.RAZORPAY_KEY_SECRET || "").trim();
const ADMIN_EMAILS = new Set(String(process.env.ADMIN_EMAILS || "").split(",").map(v => v.trim().toLowerCase()).filter(Boolean));
const razorpay = KEY_ID && KEY_SECRET ? new Razorpay({ key_id: KEY_ID, key_secret: KEY_SECRET }) : null;
const db = new DatabaseSync(DB_FILE);

function safeIdent(value) { return String(value || "").trim().slice(0, 120); }

function json(res, status, data) {
  if (res.headersSent) return;
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(body);
}

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || "").split(";").forEach(part => {
    const i = part.indexOf("=");
    if (i < 0) return;
    try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch {}
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

function isAdmin(user) { return Boolean(user && ADMIN_EMAILS.has(String(user.email).toLowerCase())); }

function sameOrigin(req) {
  const origin = String(req.headers.origin || "");
  if (!origin) return true;
  const host = String(req.headers.host || "");
  return origin === `http://${host}` || origin === `https://${host}` || origin === String(process.env.PUBLIC_ORIGIN || "").replace(/\/$/, "");
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

function verifySignature(orderId, paymentId, signature) {
  const expected = crypto.createHmac("sha256", KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex");
  const actual = String(signature || "");
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

function ensureColumns() {
  const statements = [
    "ALTER TABLE bookings ADD COLUMN razorpay_order_id TEXT",
    "ALTER TABLE bookings ADD COLUMN razorpay_payment_id TEXT",
    "ALTER TABLE bookings ADD COLUMN razorpay_signature TEXT",
    "ALTER TABLE bookings ADD COLUMN cinema_id INTEGER",
    "ALTER TABLE bookings ADD COLUMN show_id INTEGER",
    "ALTER TABLE bookings ADD COLUMN show_date TEXT",
    "ALTER TABLE bookings ADD COLUMN show_time TEXT",
    "ALTER TABLE bookings ADD COLUMN theatre_name TEXT"
  ];
  for (const statement of statements) {
    try { db.exec(statement); } catch (error) {
      if (!String(error.message).toLowerCase().includes("duplicate column")) throw error;
    }
  }
}

ensureColumns();
db.exec(`
  CREATE TABLE IF NOT EXISTS cinemas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    state TEXT NOT NULL,
    district TEXT NOT NULL,
    city TEXT NOT NULL,
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    UNIQUE(state,district,city,name)
  );
  CREATE TABLE IF NOT EXISTS shows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cinema_id INTEGER NOT NULL,
    movie_id INTEGER NOT NULL,
    show_date TEXT NOT NULL,
    show_time TEXT NOT NULL,
    price_inr REAL NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    UNIQUE(cinema_id,movie_id,show_date,show_time),
    FOREIGN KEY(cinema_id) REFERENCES cinemas(id) ON DELETE CASCADE,
    FOREIGN KEY(movie_id) REFERENCES movies(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS show_seats (
    show_id INTEGER NOT NULL,
    seat_number INTEGER NOT NULL,
    locked_by INTEGER,
    lock_expires_at INTEGER,
    booking_id TEXT,
    booked_at TEXT,
    PRIMARY KEY(show_id,seat_number),
    FOREIGN KEY(show_id) REFERENCES shows(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS payment_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    razorpay_order_id TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    movie_id INTEGER NOT NULL,
    show_id INTEGER,
    seats_json TEXT NOT NULL,
    amount_inr INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'CREATED',
    razorpay_payment_id TEXT,
    created_at TEXT NOT NULL,
    paid_at TEXT
  );
`);

function seedDirectory() {
  if (!fs.existsSync(CINEMA_FILE)) return;
  let directory;
  try { directory = JSON.parse(fs.readFileSync(CINEMA_FILE, "utf8")); } catch { return; }
  const insert = db.prepare(`INSERT OR IGNORE INTO cinemas(state,district,city,name) VALUES(?,?,?,?)`);
  for (const district of directory.districts || []) {
    for (const city of district.cities || []) {
      for (const theatre of city.theatres || []) insert.run(directory.state || "Maharashtra", district.district, city.city, theatre);
    }
  }
}

function seedShows() {
  const movies = db.prepare("SELECT id,price_usd,show_time FROM movies ORDER BY id").all();
  const cinemas = db.prepare("SELECT id FROM cinemas WHERE active=1").all();
  if (!movies.length || !cinemas.length) return;
  const insertShow = db.prepare(`INSERT OR IGNORE INTO shows(cinema_id,movie_id,show_date,show_time,price_inr,active) VALUES(?,?,?,?,?,1)`);
  const insertSeat = db.prepare(`INSERT OR IGNORE INTO show_seats(show_id,seat_number) VALUES(?,?)`);
  const dates = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date();
    d.setHours(0,0,0,0);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().slice(0,10));
  }
  for (const cinema of cinemas) {
    for (const movie of movies) {
      const price = Math.max(50, Math.round(Number(movie.price_usd) * INR_PER_USD));
      for (const date of dates) {
        const show = insertShow.run(cinema.id, movie.id, date, movie.show_time, price);
        if (Number(show.changes) === 1) {
          const showId = Number(show.lastInsertRowid);
          for (let seat = 1; seat <= 32; seat++) insertSeat.run(showId, seat);
        }
      }
    }
  }
}

seedDirectory();
seedShows();

function cleanExpiredLocks(showId = null) {
  const now = Date.now();
  if (showId) db.prepare("UPDATE show_seats SET locked_by=NULL,lock_expires_at=NULL WHERE show_id=? AND booking_id IS NULL AND lock_expires_at IS NOT NULL AND lock_expires_at<=?").run(showId, now);
  else db.prepare("UPDATE show_seats SET locked_by=NULL,lock_expires_at=NULL WHERE booking_id IS NULL AND lock_expires_at IS NOT NULL AND lock_expires_at<=?").run(now);
}

async function handle(req, res) {
  const url = new URL(req.url, "http://localhost");
  if (!["GET","HEAD","OPTIONS"].includes(req.method) && !sameOrigin(req)) return json(res, 403, { message: "CSRF protection rejected this request." });

  if (req.method === "GET" && url.pathname === "/api/catalog") {
    const district = safeIdent(url.searchParams.get("district"));
    const city = safeIdent(url.searchParams.get("city"));
    const theatre = safeIdent(url.searchParams.get("theatre"));
    const date = safeIdent(url.searchParams.get("date"));
    if (!district || !city || !theatre) return json(res, 400, { message: "Select District, City and Cinema Hall first." });
    const dates = db.prepare(`SELECT DISTINCT s.show_date FROM shows s JOIN cinemas c ON c.id=s.cinema_id WHERE c.district=? AND c.city=? AND c.name=? AND s.active=1 AND s.show_date>=date('now') ORDER BY s.show_date LIMIT 30`).all(district,city,theatre).map(r=>r.show_date);
    const chosenDate = date && dates.includes(date) ? date : (dates[0] || "");
    const rows = chosenDate ? db.prepare(`SELECT s.id AS show_id,s.show_date,s.show_time,s.price_inr,m.id AS movie_id,m.title,m.category,c.id AS cinema_id,c.name AS theatre,c.city,c.district FROM shows s JOIN movies m ON m.id=s.movie_id JOIN cinemas c ON c.id=s.cinema_id WHERE c.district=? AND c.city=? AND c.name=? AND s.show_date=? AND s.active=1 ORDER BY m.title,s.show_time`).all(district,city,theatre,chosenDate) : [];
    return json(res,200,{dates,selectedDate:chosenDate,shows:rows});
  }

  if (req.method === "GET" && /^\/api\/shows\/\d+\/seats$/.test(url.pathname)) {
    const showId = Number(url.pathname.split("/")[3]);
    const user = getUser(req);
    cleanExpiredLocks(showId);
    const rows = db.prepare("SELECT seat_number,locked_by,lock_expires_at,booking_id FROM show_seats WHERE show_id=? ORDER BY seat_number").all(showId);
    if (!rows.length) return json(res,404,{message:"Show not found."});
    const now = Date.now();
    return json(res,200,{occupiedSeats:rows.filter(r=>r.booking_id).map(r=>r.seat_number),lockedSeats:rows.filter(r=>!r.booking_id && r.lock_expires_at>now && r.locked_by!==user?.id).map(r=>r.seat_number),myLockedSeats:rows.filter(r=>!r.booking_id && r.lock_expires_at>now && r.locked_by===user?.id).map(r=>r.seat_number),lockExpiresAt:rows.find(r=>r.locked_by===user?.id && r.lock_expires_at>now)?.lock_expires_at||null});
  }

  if (req.method === "GET" && url.pathname === "/api/bookings/history") {
    const user = getUser(req);
    if (!user) return json(res,401,{message:"Please login first."});
    ensureColumns();
    const rows = db.prepare(`SELECT b.id,b.seats_json,b.total_local,b.currency_code,b.payment_status,b.transaction_id,b.created_at,b.show_date,b.show_time,b.theatre_name,m.title AS movie FROM bookings b JOIN movies m ON m.id=b.movie_id WHERE b.user_id=? ORDER BY b.created_at DESC LIMIT 100`).all(user.id);
    return json(res,200,{bookings:rows.map(r=>({...r,seats:JSON.parse(r.seats_json)}))});
  }

  if (req.method === "POST" && url.pathname === "/api/payment/order") {
    if (!razorpay) return json(res,503,{message:"Razorpay is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to .env."});
    const user = getUser(req);
    if (!user) return json(res,401,{message:"Please login first."});
    let body; try { body=await readBody(req); } catch { return json(res,400,{message:"Invalid payment request."}); }
    const movieId=Number(body.movieId), showId=Number(body.showId);
    const seats=Array.isArray(body.seats)?[...new Set(body.seats.map(Number))]:[];
    if (!Number.isInteger(movieId)||!Number.isInteger(showId)||!validSeats(seats)) return json(res,400,{message:"Invalid movie, show or seats."});
    cleanExpiredLocks(showId);
    const show=db.prepare(`SELECT s.*,m.title,m.category,m.price_usd,c.name AS theatre,c.district,c.city FROM shows s JOIN movies m ON m.id=s.movie_id JOIN cinemas c ON c.id=s.cinema_id WHERE s.id=? AND s.movie_id=? AND s.active=1`).get(showId,movieId);
    if(!show) return json(res,404,{message:"Selected show is no longer available."});
    db.exec("BEGIN IMMEDIATE");
    try {
      const placeholders=seats.map(()=>"?").join(",");
      const rows=db.prepare(`SELECT seat_number,booking_id,locked_by,lock_expires_at FROM show_seats WHERE show_id=? AND seat_number IN (${placeholders})`).all(showId,...seats);
      const now=Date.now();
      if(rows.length!==seats.length||rows.some(r=>r.booking_id||(r.locked_by&&r.locked_by!==user.id&&Number(r.lock_expires_at)>now))){db.exec("ROLLBACK");return json(res,409,{message:"One or more selected seats are unavailable."});}
      db.prepare(`UPDATE show_seats SET locked_by=?,lock_expires_at=? WHERE show_id=? AND seat_number IN (${placeholders})`).run(user.id,now+10*60*1000,showId,...seats);
      db.exec("COMMIT");
    } catch(e){try{db.exec("ROLLBACK")}catch{};throw e;}
    const amountInr=Math.round(Number(show.price_inr)*seats.length*100);
    if(!Number.isInteger(amountInr)||amountInr<100)return json(res,400,{message:"Payment amount is invalid."});
    try{
      const order=await razorpay.orders.create({amount:amountInr,currency:"INR",receipt:`ibox_${Date.now()}_${user.id}`.slice(0,40),notes:{movie_id:String(movieId),show_id:String(showId),user_id:String(user.id),seats:seats.join(",")} });
      db.prepare(`INSERT INTO payment_orders(razorpay_order_id,user_id,movie_id,show_id,seats_json,amount_inr,status,created_at) VALUES(?,?,?,?,?,?, 'CREATED',?)`).run(order.id,user.id,movieId,showId,JSON.stringify(seats),amountInr,new Date().toISOString());
      return json(res,200,{keyId:KEY_ID,orderId:order.id,amount:amountInr,currency:"INR",amountInr:amountInr/100,movie:show.title,showId,showDate:show.show_date,showTime:show.show_time,theatre:show.theatre});
    }catch(error){
      db.prepare(`UPDATE show_seats SET locked_by=NULL,lock_expires_at=NULL WHERE show_id=? AND locked_by=? AND booking_id IS NULL`).run(showId,user.id);
      console.error("Razorpay order creation failed:",error);return json(res,502,{message:"Unable to create the Razorpay payment order."});
    }
  }

  if (req.method === "POST" && url.pathname === "/api/bookings") {
    let body; try { body=await readBody(req); } catch { return json(res,400,{message:"Invalid booking request."}); }
    if(String(body.paymentStatus||"")!=="PAID (RAZORPAY)")return json(res,400,{message:"Real Razorpay payment is required. Demo payment is disabled."});
    if(!razorpay)return json(res,503,{message:"Razorpay is not configured."});
    const user=getUser(req);if(!user)return json(res,401,{message:"Please login first."});
    const movieId=Number(body.movieId),showId=Number(body.showId),seats=Array.isArray(body.seats)?[...new Set(body.seats.map(Number))]:[];
    const orderId=String(body.razorpayOrderId||""),paymentId=String(body.razorpayPaymentId||""),signature=String(body.razorpaySignature||"");
    if(!Number.isInteger(movieId)||!Number.isInteger(showId)||!validSeats(seats)||!orderId||!paymentId||!signature)return json(res,400,{message:"Incomplete Razorpay payment details."});
    const pending=db.prepare("SELECT * FROM payment_orders WHERE razorpay_order_id=? AND user_id=? AND status='CREATED'").get(orderId,user.id);
    if(!pending)return json(res,409,{message:"Payment order is invalid, expired, or already used."});
    const pendingSeats=JSON.stringify(JSON.parse(pending.seats_json).map(Number).sort((a,b)=>a-b));
    if(Number(pending.movie_id)!==movieId||Number(pending.show_id)!==showId||pendingSeats!==JSON.stringify([...seats].sort((a,b)=>a-b)))return json(res,400,{message:"Payment order does not match the selected show or seats."});
    if(!verifySignature(orderId,paymentId,signature))return json(res,400,{message:"Razorpay signature verification failed."});
    try{const payment=await razorpay.payments.fetch(paymentId);if(String(payment.order_id)!==orderId)return json(res,400,{message:"Payment/order mismatch."});if(String(payment.status)!=="captured")return json(res,400,{message:`Payment is not captured yet (status: ${payment.status}).`});if(Number(payment.amount)!==Number(pending.amount_inr))return json(res,400,{message:"Payment amount mismatch."});}catch(error){console.error("Razorpay payment verification failed:",error);return json(res,502,{message:"Could not verify the Razorpay payment."});}
    const show=db.prepare(`SELECT s.*,m.title,m.category,c.name AS theatre FROM shows s JOIN movies m ON m.id=s.movie_id JOIN cinemas c ON c.id=s.cinema_id WHERE s.id=? AND s.movie_id=?`).get(showId,movieId);
    if(!show)return json(res,404,{message:"Show not found."});
    const bookingId=`IBOX-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;const now=new Date().toISOString();const totalInr=Number(pending.amount_inr)/100;const totalUsd=Number(show.price_usd)*seats.length;
    db.exec("BEGIN IMMEDIATE");
    try{
      const placeholders=seats.map(()=>"?").join(",");
      const rows=db.prepare(`SELECT seat_number,booking_id,locked_by,lock_expires_at FROM show_seats WHERE show_id=? AND seat_number IN (${placeholders})`).all(showId,...seats);
      if(rows.length!==seats.length||rows.some(r=>r.booking_id||(Number(r.locked_by)!==user.id)||Number(r.lock_expires_at)<=Date.now())){db.exec("ROLLBACK");return json(res,409,{message:"Your seat hold expired or the selected seats are no longer available. If payment was captured, contact support with the payment ID."});}
      db.prepare(`INSERT INTO bookings(id,user_id,movie_id,seats_json,total_usd,currency_code,total_local,payment_method,payment_status,transaction_id,created_at,razorpay_order_id,razorpay_payment_id,razorpay_signature,cinema_id,show_id,show_date,show_time,theatre_name) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(bookingId,user.id,movieId,JSON.stringify(seats),totalUsd,"INR",totalInr,"Razorpay","PAID",paymentId,now,orderId,paymentId,signature,show.cinema_id,showId,show.show_date,show.show_time,show.theatre);
      db.prepare(`UPDATE show_seats SET booking_id=?,booked_at=?,locked_by=NULL,lock_expires_at=NULL WHERE show_id=? AND seat_number IN (${placeholders})`).run(bookingId,now,showId,...seats);
      db.prepare("UPDATE payment_orders SET status='PAID',razorpay_payment_id=?,paid_at=? WHERE id=?").run(paymentId,now,pending.id);
      db.exec("COMMIT");
      return json(res,201,{booking:{id:bookingId,user:user.name,movie:show.title,category:show.category,seats,totalInr,currencyCode:"INR",currencySymbol:"₹",paymentMethod:"Razorpay",paymentStatus:"PAID",transactionId:paymentId,showDate:show.show_date,showTime:show.show_time,theatre:show.theatre,date:new Date().toLocaleString("en-IN")}});
    }catch(error){try{db.exec("ROLLBACK")}catch{};console.error("Booking transaction failed:",error);return json(res,500,{message:"Booking could not be completed after payment verification."});}
  }

  if (url.pathname.startsWith("/api/admin/")) {
    const user=getUser(req);if(!isAdmin(user))return json(res,403,{message:"Admin access required."});
    if(req.method==="GET"&&url.pathname==="/api/admin/bookings"){
      ensureColumns();
      const rows=db.prepare(`SELECT b.id,b.created_at,b.show_date,b.show_time,b.theatre_name,b.seats_json,b.total_local,b.currency_code,b.payment_status,b.transaction_id,u.name AS customer,u.email,m.title AS movie FROM bookings b JOIN users u ON u.id=b.user_id JOIN movies m ON m.id=b.movie_id ORDER BY b.created_at DESC LIMIT 500`).all();
      return json(res,200,{bookings:rows.map(r=>({...r,seats:JSON.parse(r.seats_json)}))});
    }
    let body={};try{body=await readBody(req)}catch{body={};}
    if(req.method==="POST"&&url.pathname==="/api/admin/movies"){
      const title=safeIdent(body.title),category=safeIdent(body.category)||"General",time=safeIdent(body.showTime)||"18:00",price=Number(body.priceUsd);if(title.length<1||!Number.isFinite(price)||price<=0)return json(res,400,{message:"Valid title and price are required."});
      const max=db.prepare("SELECT COALESCE(MAX(id),0)+1 AS id FROM movies").get().id;db.prepare("INSERT INTO movies(id,title,category,show_time,price_usd) VALUES(?,?,?,?,?)").run(max,title,category,time,price);return json(res,201,{movie:{id:max,title,category,showTime:time,priceUsd:price}});
    }
    if(req.method==="POST"&&url.pathname==="/api/admin/cinemas"){
      const state=safeIdent(body.state)||"Maharashtra",district=safeIdent(body.district),city=safeIdent(body.city),name=safeIdent(body.name);if(!district||!city||!name)return json(res,400,{message:"District, city and cinema name are required."});
      try{const r=db.prepare("INSERT INTO cinemas(state,district,city,name) VALUES(?,?,?,?)").run(state,district,city,name);return json(res,201,{cinema:{id:Number(r.lastInsertRowid),state,district,city,name}})}catch{return json(res,409,{message:"Cinema already exists."})}
    }
    if(req.method==="POST"&&url.pathname==="/api/admin/shows"){
      const cinemaId=Number(body.cinemaId),movieId=Number(body.movieId),date=safeIdent(body.showDate),time=safeIdent(body.showTime),price=Number(body.priceInr);if(!cinemaId||!movieId||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)||!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(time)||!Number.isFinite(price)||price<50)return json(res,400,{message:"Valid cinema, movie, date, time and INR price are required."});
      try{const r=db.prepare("INSERT INTO shows(cinema_id,movie_id,show_date,show_time,price_inr) VALUES(?,?,?,?,?)").run(cinemaId,movieId,date,time,price);const id=Number(r.lastInsertRowid);const ins=db.prepare("INSERT INTO show_seats(show_id,seat_number) VALUES(?,?)");for(let s=1;s<=32;s++)ins.run(id,s);return json(res,201,{showId:id})}catch{return json(res,409,{message:"That show already exists."})}
    }
    if(req.method==="PATCH"&&/^\/api\/admin\/shows\/\d+$/.test(url.pathname)){
      const id=Number(url.pathname.split("/").pop());const fields=[];const values=[];if(body.showDate){fields.push("show_date=?");values.push(safeIdent(body.showDate))}if(body.showTime){fields.push("show_time=?");values.push(safeIdent(body.showTime))}if(body.priceInr!==undefined){const p=Number(body.priceInr);if(!Number.isFinite(p)||p<50)return json(res,400,{message:"Invalid price."});fields.push("price_inr=?");values.push(p)}if(body.active!==undefined){fields.push("active=?");values.push(body.active?1:0)}if(!fields.length)return json(res,400,{message:"No changes supplied."});values.push(id);db.prepare(`UPDATE shows SET ${fields.join(",")} WHERE id=?`).run(...values);return json(res,200,{message:"Show updated."});
    }
    if(req.method==="DELETE"&&/^\/api\/admin\/movies\/\d+$/.test(url.pathname)){
      const id=Number(url.pathname.split("/").pop());db.prepare("UPDATE movies SET title=title WHERE id=?").run(id);db.prepare("UPDATE shows SET active=0 WHERE movie_id=?").run(id);return json(res,200,{message:"Movie removed from future shows."});
    }
    if(req.method==="GET"&&url.pathname==="/api/admin/summary"){
      return json(res,200,{movies:db.prepare("SELECT COUNT(*) AS count FROM movies").get().count,cinemas:db.prepare("SELECT COUNT(*) AS count FROM cinemas WHERE active=1").get().count,shows:db.prepare("SELECT COUNT(*) AS count FROM shows WHERE active=1 AND show_date>=date('now')").get().count,bookings:db.prepare("SELECT COUNT(*) AS count FROM bookings").get().count});
    }
    return json(res,404,{message:"Admin endpoint not found."});
  }

  return null;
}

function patchServerModule(serverModule) {
  const original=serverModule.createServer;
  serverModule.createServer=function patchedCreateServer(...args){
    const listener=args.find(arg=>typeof arg==="function");
    if(!listener)return original.apply(this,args);
    const wrapped=async function(req,res){try{const handled=await handle(req,res);if(handled)return;}catch(error){console.error("Gateway/catalog hook error:",error);if(!res.headersSent)return json(res,500,{message:"Service error."});}return listener(req,res);};
    return original.apply(this,args.map(arg=>arg===listener?wrapped:arg));
  };
}

patchServerModule(require("node:http"));
patchServerModule(require("node:https"));
console.log(`Razorpay gateway: ${razorpay ? "configured" : "NOT configured (add RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET)"}`);
console.log(`Dynamic cinema catalog: ${db.prepare("SELECT COUNT(*) AS count FROM cinemas").get().count} cinemas, ${db.prepare("SELECT COUNT(*) AS count FROM shows").get().count} shows`);

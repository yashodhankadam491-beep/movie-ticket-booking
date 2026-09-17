"use strict";

// Startup bridge for the Cinema -> Screen -> Show admin layer.
// It wraps the native HTTP server without replacing server.js, so the existing
// authentication, booking and payment routes continue to work unchanged.
const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { handleAdminScreens } = require("./admin-screens.js");

const DB_FILE = path.join(__dirname, "ibox_booking.sqlite");
const db = new DatabaseSync(DB_FILE);
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`CREATE TABLE IF NOT EXISTS screens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cinema_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  seat_capacity INTEGER NOT NULL DEFAULT 32,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(cinema_id,name),
  FOREIGN KEY(cinema_id) REFERENCES cinemas(id) ON DELETE CASCADE
);`);

const SESSION_SECRET = process.env.SESSION_SECRET || "dev-only-change-me";
const ADMIN_EMAILS = new Set(String(process.env.ADMIN_EMAILS || "").split(",").map(v => v.trim().toLowerCase()).filter(Boolean));

function sessionHash(token) { return crypto.createHmac("sha256", SESSION_SECRET).update(token).digest("hex"); }
function cookies(req) {
  const out = {};
  String(req.headers.cookie || "").split(";").forEach(part => {
    const i = part.indexOf("=");
    if (i < 0) return;
    try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch {}
  });
  return out;
}
function admin(req) {
  const token = cookies(req).ibox_session;
  if (!token || !ADMIN_EMAILS.size) return null;
  return db.prepare(`SELECT u.id,u.name,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`).get(sessionHash(token), Date.now()) || null;
}
function isAdmin(req) {
  const u = admin(req);
  return Boolean(u && ADMIN_EMAILS.has(String(u.email).toLowerCase()));
}
function json(res, status, data) {
  if (res.headersSent) return;
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type":"application/json; charset=utf-8", "Cache-Control":"no-store", "X-Content-Type-Options":"nosniff" });
  res.end(body);
}
async function readJson(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw, "utf8") > 1024 * 1024) throw new Error("Request too large.");
  }
  return raw ? JSON.parse(raw) : {};
}
function clean(v, max = 160) { return String(v ?? "").trim().slice(0, max); }
function validDate(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v)); }
function validTime(v) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v)); }

function ensureShowSeats(showId, capacity) {
  db.exec(`CREATE TABLE IF NOT EXISTS show_seats (
    show_id INTEGER NOT NULL,
    seat_number INTEGER NOT NULL,
    locked_by INTEGER,
    lock_expires_at INTEGER,
    booking_id TEXT,
    booked_at TEXT,
    PRIMARY KEY(show_id,seat_number),
    FOREIGN KEY(show_id) REFERENCES shows(id) ON DELETE CASCADE
  );`);
  const add = db.prepare("INSERT OR IGNORE INTO show_seats(show_id,seat_number) VALUES(?,?)");
  for (let n = 1; n <= capacity; n++) add.run(showId, n);
}

async function routeAdminExtras(req, res, url) {
  if (!url.pathname.startsWith("/api/admin/")) return false;
  if (!isAdmin(req)) { json(res, 403, { message: "Admin access required." }); return true; }

  // Screen endpoints are implemented by the dedicated module.
  if (url.pathname === "/api/admin/screens" || url.pathname.startsWith("/api/admin/screens/")) {
    return handleAdminScreens(req, res, url);
  }

  // Compact lists used by the admin UI dropdowns.
  if (req.method === "GET" && url.pathname === "/api/admin/manage/movies") {
    const movies = db.prepare("SELECT id,title,category,show_time,price_usd FROM movies ORDER BY title").all();
    return json(res, 200, { movies });
  }
  if (req.method === "GET" && url.pathname === "/api/admin/manage/cinemas") {
    const cinemas = db.prepare("SELECT id,state,district,city,name,active FROM cinemas ORDER BY district,city,name").all();
    return json(res, 200, { cinemas });
  }
  if (req.method === "GET" && url.pathname === "/api/admin/manage/shows") {
    const shows = db.prepare(`SELECT sh.id,sh.cinema_id,sh.movie_id,sh.screen_id,sh.show_date,sh.show_time,sh.price_inr,sh.active,
      c.district,c.city,c.name AS theatre_name,m.title AS movie_title,sc.name AS screen_name,sc.seat_capacity
      FROM shows sh JOIN cinemas c ON c.id=sh.cinema_id JOIN movies m ON m.id=sh.movie_id
      LEFT JOIN screens sc ON sc.id=sh.screen_id ORDER BY sh.show_date,sh.show_time,c.district,c.city,c.name,m.title`).all();
    return json(res, 200, { shows });
  }

  // Full show creation/update/delete. A show is always attached to a screen.
  if (req.method === "POST" && url.pathname === "/api/admin/manage/shows") {
    let b; try { b = await readJson(req); } catch { return json(res,400,{message:"Invalid request."}); }
    const cinemaId = Number(b.cinemaId), movieId = Number(b.movieId), screenId = Number(b.screenId);
    const showDate = clean(b.showDate, 10), showTime = clean(b.showTime, 5), priceInr = Number(b.priceInr);
    if (![cinemaId,movieId,screenId].every(Number.isInteger) || cinemaId<1 || movieId<1 || screenId<1 || !validDate(showDate) || !validTime(showTime) || !Number.isFinite(priceInr) || priceInr<1) return json(res,400,{message:"Enter valid cinema, screen, movie, date, time and ticket price."});
    const screen = db.prepare("SELECT id,cinema_id,seat_capacity,active FROM screens WHERE id=?").get(screenId);
    if (!screen || Number(screen.cinema_id)!==cinemaId || !screen.active) return json(res,400,{message:"Selected screen does not belong to the selected active cinema."});
    if (!db.prepare("SELECT id FROM cinemas WHERE id=? AND active=1").get(cinemaId)) return json(res,404,{message:"Cinema not found."});
    if (!db.prepare("SELECT id FROM movies WHERE id=?").get(movieId)) return json(res,404,{message:"Movie not found."});
    try {
      const result = db.prepare("INSERT INTO shows(cinema_id,movie_id,screen_id,show_date,show_time,price_inr,active) VALUES(?,?,?,?,?,?,1)").run(cinemaId,movieId,screenId,showDate,showTime,priceInr);
      ensureShowSeats(Number(result.lastInsertRowid), Number(screen.seat_capacity));
      return json(res,201,{message:"Show added.",showId:Number(result.lastInsertRowid)});
    } catch (e) {
      if (String(e.message).toLowerCase().includes("unique")) return json(res,409,{message:"That movie already has a show at this cinema on this date and time."});
      throw e;
    }
  }

  const showMatch = url.pathname.match(/^\/api\/admin\/manage\/shows\/(\d+)$/);
  if (showMatch && req.method === "PATCH") {
    let b; try { b = await readJson(req); } catch { return json(res,400,{message:"Invalid request."}); }
    const id = Number(showMatch[1]);
    const current = db.prepare("SELECT * FROM shows WHERE id=?").get(id);
    if (!current) return json(res,404,{message:"Show not found."});
    const cinemaId = b.cinemaId === undefined ? Number(current.cinema_id) : Number(b.cinemaId);
    const movieId = b.movieId === undefined ? Number(current.movie_id) : Number(b.movieId);
    const screenId = b.screenId === undefined ? Number(current.screen_id) : Number(b.screenId);
    const showDate = b.showDate === undefined ? current.show_date : clean(b.showDate,10);
    const showTime = b.showTime === undefined ? current.show_time : clean(b.showTime,5);
    const priceInr = b.priceInr === undefined ? Number(current.price_inr) : Number(b.priceInr);
    const active = b.active === undefined ? Number(current.active) : (b.active ? 1 : 0);
    const screen = db.prepare("SELECT id,cinema_id,seat_capacity FROM screens WHERE id=?").get(screenId);
    if (!screen || Number(screen.cinema_id)!==cinemaId) return json(res,400,{message:"Selected screen does not belong to the cinema."});
    if (!validDate(showDate) || !validTime(showTime) || !Number.isFinite(priceInr) || priceInr<1) return json(res,400,{message:"Invalid date, time or ticket price."});
    try {
      db.prepare("UPDATE shows SET cinema_id=?,movie_id=?,screen_id=?,show_date=?,show_time=?,price_inr=?,active=? WHERE id=?").run(cinemaId,movieId,screenId,showDate,showTime,priceInr,active,id);
      ensureShowSeats(id, Number(screen.seat_capacity));
      return json(res,200,{message:"Show updated."});
    } catch(e) {
      if (String(e.message).toLowerCase().includes("unique")) return json(res,409,{message:"Another show already uses that cinema, movie, date and time."});
      throw e;
    }
  }
  if (showMatch && req.method === "DELETE") {
    const id = Number(showMatch[1]);
    const used = db.prepare("SELECT COUNT(*) AS count FROM bookings WHERE show_id=?").get(id);
    if (Number(used?.count || 0) > 0) return json(res,409,{message:"This show has bookings. Deactivate it instead of deleting it."});
    db.prepare("DELETE FROM shows WHERE id=?").run(id);
    return json(res,200,{message:"Show deleted."});
  }

  // Movie/cinema management additions. Existing add endpoints remain compatible.
  const movieMatch = url.pathname.match(/^\/api\/admin\/manage\/movies\/(\d+)$/);
  if (movieMatch && req.method === "PATCH") {
    let b; try { b=await readJson(req); } catch { return json(res,400,{message:"Invalid request."}); }
    const id=Number(movieMatch[1]);
    const current=db.prepare("SELECT * FROM movies WHERE id=?").get(id);
    if(!current) return json(res,404,{message:"Movie not found."});
    const title=clean(b.title===undefined?current.title:b.title,160), category=clean(b.category===undefined?current.category:b.category,60), showTime=clean(b.showTime===undefined?current.show_time:b.showTime,5), priceUsd=b.priceUsd===undefined?Number(current.price_usd):Number(b.priceUsd);
    if(!title||!category||!validTime(showTime)||!Number.isFinite(priceUsd)||priceUsd<0) return json(res,400,{message:"Invalid movie details."});
    db.prepare("UPDATE movies SET title=?,category=?,show_time=?,price_usd=? WHERE id=?").run(title,category,showTime,priceUsd,id);
    return json(res,200,{message:"Movie updated."});
  }
  if (movieMatch && req.method === "DELETE") {
    const id=Number(movieMatch[1]);
    const used=db.prepare("SELECT COUNT(*) AS count FROM shows WHERE movie_id=?").get(id);
    if(Number(used?.count||0)>0) return json(res,409,{message:"This movie is used by shows. Remove/deactivate its shows first.",count:Number(used.count)});
    db.prepare("DELETE FROM movies WHERE id=?").run(id);
    return json(res,200,{message:"Movie deleted."});
  }

  return false;
}

const originalCreateServer = http.createServer;
http.createServer = function wrappedCreateServer(...args) {
  const originalHandler = typeof args[0] === "function" ? args[0] : null;
  if (!originalHandler) return originalCreateServer.apply(this, args);
  args[0] = async function wrappedRequest(req, res) {
    let url;
    try { url = new URL(req.url, `http://${req.headers.host || "localhost"}`); } catch { return json(res,400,{message:"Invalid URL."}); }
    if (url.pathname.startsWith("/api/admin/")) {
      try {
        const handled = await routeAdminExtras(req,res,url);
        if (handled) return;
      } catch (error) {
        console.error("[admin-screen-hook]", error);
        if (!res.headersSent) return json(res,500,{message:"Admin request failed."});
        return;
      }
    }
    return originalHandler(req,res);
  };
  return originalCreateServer.apply(this,args);
};

console.log("[screen-hook] Cinema -> Screen -> Show admin integration loaded.");

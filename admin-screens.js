"use strict";

// Admin Screen Management API module.
// Loaded by server startup through admin-screen-hook.js.
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const crypto = require("node:crypto");

const db = new DatabaseSync(path.join(__dirname, "ibox_booking.sqlite"));
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
function user(req) {
  const token = cookies(req).ibox_session;
  if (!token) return null;
  return db.prepare(`SELECT u.id,u.name,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`).get(sessionHash(token), Date.now()) || null;
}
function admin(req) {
  const u = user(req);
  return u && ADMIN_EMAILS.has(String(u.email).toLowerCase()) ? u : null;
}
function json(res, status, data) {
  if (res.headersSent) return;
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type":"application/json; charset=utf-8", "Cache-Control":"no-store", "X-Content-Type-Options":"nosniff" });
  res.end(body);
}
async function body(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > 1024 * 1024) throw new Error("Request too large.");
  }
  return raw ? JSON.parse(raw) : {};
}
function clean(v, max=120) { return String(v ?? "").trim().slice(0,max); }

async function handleAdminScreens(req, res, url) {
  if (!url.pathname.startsWith("/api/admin/screens") && !url.pathname.startsWith("/api/admin/cinema-screens")) return false;
  if (!admin(req)) { json(res, 403, {message:"Admin access required."}); return true; }

  if (req.method === "GET" && url.pathname === "/api/admin/screens") {
    const rows = db.prepare(`SELECT s.id,s.cinema_id,s.name,s.seat_capacity,s.active,c.state,c.district,c.city,c.name AS cinema_name FROM screens s JOIN cinemas c ON c.id=s.cinema_id ORDER BY c.district,c.city,c.name,s.name`).all();
    return json(res,200,{screens:rows});
  }

  if (req.method === "POST" && url.pathname === "/api/admin/screens") {
    let b; try { b=await body(req); } catch { return json(res,400,{message:"Invalid request."}); }
    const cinemaId=Number(b.cinemaId), name=clean(b.name), capacity=Number(b.seatCapacity || 32);
    if (!Number.isInteger(cinemaId)||cinemaId<1||!name||!Number.isInteger(capacity)||capacity<1||capacity>500) return json(res,400,{message:"Enter a valid cinema, screen name and seat capacity (1-500)."});
    const cinema=db.prepare("SELECT id FROM cinemas WHERE id=? AND active=1").get(cinemaId);
    if(!cinema) return json(res,404,{message:"Cinema not found."});
    try { const r=db.prepare("INSERT INTO screens(cinema_id,name,seat_capacity,active) VALUES(?,?,?,1)").run(cinemaId,name,capacity); return json(res,201,{message:"Screen added.",screenId:Number(r.lastInsertRowid)}); }
    catch(e){ if(String(e.message).toLowerCase().includes("unique")) return json(res,409,{message:"That screen already exists in this cinema."}); throw e; }
  }

  const match=url.pathname.match(/^\/api\/admin\/screens\/(\d+)$/);
  if(match && req.method === "PATCH") {
    let b; try { b=await body(req); } catch { return json(res,400,{message:"Invalid request."}); }
    const id=Number(match[1]), name=clean(b.name), capacity=Number(b.seatCapacity), active=b.active===undefined?1:(b.active?1:0);
    if(!Number.isInteger(id)||!name||!Number.isInteger(capacity)||capacity<1||capacity>500) return json(res,400,{message:"Invalid screen details."});
    try { db.prepare("UPDATE screens SET name=?,seat_capacity=?,active=? WHERE id=?").run(name,capacity,active,id); return json(res,200,{message:"Screen updated."}); }
    catch(e){ if(String(e.message).toLowerCase().includes("unique")) return json(res,409,{message:"That screen name already exists in this cinema."}); throw e; }
  }

  if(match && req.method === "DELETE") {
    const id=Number(match[1]);
    const used=db.prepare("SELECT COUNT(*) AS count FROM shows WHERE screen_id=?").get(id);
    if(Number(used.count)>0) return json(res,409,{message:"This screen is already used by shows. Deactivate it instead of deleting it."});
    db.prepare("DELETE FROM screens WHERE id=?").run(id);
    return json(res,200,{message:"Screen deleted."});
  }
  return json(res,405,{message:"Method not allowed."});
}

module.exports = { handleAdminScreens };

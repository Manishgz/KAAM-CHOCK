"use strict";
/*
 * Kaam Chowk — labour marketplace backend. Zero dependencies, Node 18+.
 *   node server.js
 * See README.md for all environment variables.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { promisify } = require("util");
const scrypt = promisify(crypto.scrypt);

const env = process.env;
const CFG = {
  port: Number(env.PORT) || 3000,
  dataDir: env.DATA_DIR || path.join(__dirname, "data"),
  prod: env.NODE_ENV === "production",
  trustProxy: env.TRUST_PROXY === "1",
  cookieSecure: env.COOKIE_SECURE === "1",
  smsUrl: env.SMS_WEBHOOK_URL || "",
  smsAuth: env.SMS_WEBHOOK_AUTH || "",
  seedDemo: env.SEED_DEMO !== "0",
  rateScale: Number(env.RATE_SCALE) || 1, // tests raise per-IP limits
};
// OTP is returned in the API response ONLY when no SMS provider is configured and not in production.
CFG.devOtp = env.DEV_OTP ? env.DEV_OTP === "1" : !CFG.smsUrl && !CFG.prod;

const DB_FILE = path.join(CFG.dataDir, "db.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const CATS = ["mazdoori", "painting", "plumbing", "bijli", "mistri", "safai", "transport", "ghar", "other"];
const H = 3600e3, DAY = 24 * H;
const MAX_ACTIVE_CLAIMS = 3, MAX_OPEN_POSTS = 20;

/* ---------------- tiny helpers ---------------- */
const digits = (p) => String(p || "").replace(/\D/g, "");
function clean(v, max) {
  return String(v == null ? "" : v).replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
function normPhone(raw) {
  let d = digits(raw);
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return d;
}
function phoneErr(raw) {
  const d = normPhone(raw);
  if (d.length !== 10) return "10 ank ka mobile number likho (jaise 98765 43210).";
  if (!/^[6-9]/.test(d)) return "Number 6, 7, 8 ya 9 se shuru hona chahiye.";
  return "";
}
const fmtPhone = (raw) => { const d = normPhone(raw); return d.length === 10 ? d.slice(0, 5) + " " + d.slice(5) : String(raw || ""); };
const newId = (p) => p + crypto.randomBytes(6).toString("hex");
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const dayKey = (ts) => new Date(ts + 19800000).toISOString().slice(0, 10); // IST day

class HttpError extends Error {
  constructor(status, message, fields, extra) { super(message); this.status = status; this.fields = fields; this.extra = extra; }
}

/* ---------------- database (JSON file, atomic writes) ---------------- */
let db;
const emptyDb = () => ({ version: 2, users: [], jobs: [], sessions: {}, audit: [] });

function seedDemo() {
  const d = emptyDb(), now = Date.now();
  const J = (id, title, cat, area, pay, timing, note, ownerName, ownerPhone, ago, extra) =>
    Object.assign({ id, title, cat, area, pay, timing, note, ownerId: null, ownerName, ownerPhone: normPhone(ownerPhone), status: "open", createdAt: now - ago, claimant: null, demo: true }, extra || {});
  d.jobs = [
    J("s1", "Deewar aur chhat ki putai, 3 kamre", "painting", "Shivaji Nagar, gali no. 4", "₹8,500 poora kaam", "Is hafte me shuru", "Putai ka saman ghar par hai. Do aadmi ka kaam hai, do din lagegenge.", "Ramesh Yadav", "98765 43201", 95 * 60e3),
    J("s2", "200 brick chhat par uthane hain", "mazdoori", "Gandhi Colony", "₹700 / din", "Aaj shaam tak", "", "Mohan Lal", "98765 43202", 3 * H),
    J("s3", "Bathroom ke nal ka leakage", "plumbing", "Purana Bazaar, dukan ke peeche", "₹400 – ₹600", "Aaj hi", "Pipe se paani tapak raha hai. Jaldi aana, dukan 9 baje khulti hai.", "Farid Bhai", "98765 43203", 6 * H),
    J("s4", "Dukan ka shutter repair, naya lock", "mistri", "Station Road", "₹900", "Kal subah", "Shutter chadta hai par rukta nahi. Lock bhi lena hoga.", "Suresh Gupta", "98765 43204", 27 * H),
    J("s5", "Shaadi se pehle ghar ki safai, 3 kamre", "safai", "Shivaji Nagar", "₹1,500 / 2 din", "Parso se", "Pocha, bartan, poora ghar. Do log chahiye.", "Kavita Ji", "98765 43205", 52 * H),
    J("s6", "Meter se ghar tak wiring aur switch board", "bijli", "Gandhi Colony, block C", "₹2,500", "Is hafte", "Naya ghar hai. Meter lag chuka hai, andar ka kaam baaki hai.", "Anita Sharma", "98765 43206", 74 * H),
    J("s7", "Tempo se saman shift, ek hi colony me", "transport", "Purana Bazaar se Gandhi Colony", "₹800", "Sunday", "Almari, palang aur 4 bori. Loading me madad chahiye.", "Nasreen Bano", "98765 43207", 108 * H,
      { status: "taken", claimant: { userId: null, legacyName: "Salim Bhai", legacyPhone: "9876543299", claimedAt: now - 30 * H } }),
  ];
  const W = (id, name, skill, area, phone, experience, rate) => ({
    id, name, role: "labour", phone: normPhone(phone), skill, area, bio: "", experience, rate, available: true, verified: false,
    phoneVerified: true, blocked: false, passHash: null, demo: true, createdAt: now, jobsDone: 0, ratingSum: 0, ratingCount: 0,
  });
  d.users = [
    W("w1", "Ramesh Kumar", "mazdoori", "Shivaji Nagar", "98765 43210", 6, "₹700 / din"),
    W("w2", "Sunita Devi", "safai", "Gandhi Colony", "98765 43211", 4, "₹500 / din"),
    W("w3", "Iqbal Khan", "bijli", "Purana Bazaar", "98765 43212", 9, "₹900 / din"),
    W("w4", "Deepak Prajapati", "painting", "Station Road", "98765 43213", 5, "₹800 / din"),
  ];
  return d;
}

function migrate(old) {
  const d = emptyDb();
  d.jobs = (old.jobs || []).map((j) => ({
    id: j.id, title: j.title, cat: j.cat, area: j.area, pay: j.pay, timing: j.timing || "", note: j.note || "",
    ownerId: null, ownerName: j.name, ownerPhone: normPhone(j.phone), status: j.taken ? "taken" : "open", createdAt: j.createdAt,
    claimant: j.claimant ? { userId: null, legacyName: j.claimant.workerName, legacyPhone: normPhone(j.claimant.workerPhone), claimedAt: j.claimant.claimedAt } : null,
    demo: /^s\d$/.test(j.id),
  }));
  d.users = (old.workers || []).map((w) => ({
    id: w.id, name: w.name, role: "labour", phone: normPhone(w.phone), skill: w.skill, area: w.area, bio: "", experience: 0, rate: "",
    available: true, verified: false, phoneVerified: true, blocked: false, passHash: null, demo: /^w\d$/.test(w.id),
    createdAt: w.createdAt || Date.now(), jobsDone: 0, ratingSum: 0, ratingCount: 0,
  }));
  return d;
}

function saveSync() {
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}

async function load() {
  fs.mkdirSync(CFG.dataDir, { recursive: true });
  let raw = null;
  try { raw = JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
  catch (e) { if (e.code !== "ENOENT") console.warn("db.json unreadable (" + e.message + "), starting fresh"); }
  if (!raw) db = CFG.seedDemo ? seedDemo() : emptyDb();
  else if (raw.version === 2) db = raw;
  else { fs.copyFileSync(DB_FILE, DB_FILE + ".v1.bak"); db = migrate(raw); console.log("Old database migrated (backup: db.json.v1.bak)"); }
  db.sessions = db.sessions || {}; db.audit = db.audit || [];
  const now = Date.now();
  for (const k of Object.keys(db.sessions)) if (db.sessions[k].exp < now) delete db.sessions[k];

  if (!db.users.some((u) => u.role === "admin")) {
    const phone = normPhone(env.ADMIN_PHONE || "9000000000");
    const generated = !env.ADMIN_PASSWORD;
    const pw = env.ADMIN_PASSWORD || crypto.randomBytes(9).toString("base64url");
    db.users = db.users.filter((u) => u.phone !== phone);
    db.users.push({
      id: newId("u"), name: "Admin", role: "admin", phone, area: "", skill: "", bio: "", experience: 0, rate: "", available: true,
      verified: true, phoneVerified: true, blocked: false, passHash: await hashPassword(pw), createdAt: now, jobsDone: 0, ratingSum: 0, ratingCount: 0,
    });
    console.log("\n  Admin account created — login with mobile " + phone + (generated ? " and password: " + pw + "\n  (shown only once; change it from Dashboard > Profile, or set ADMIN_PASSWORD)" : " and your ADMIN_PASSWORD") + "\n");
  }
  saveSync();
}

/* ---------------- passwords, sessions ---------------- */
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return "s1$" + salt.toString("hex") + "$" + key.toString("hex");
}
const DUMMY_HASH = "s1$" + "00".repeat(16) + "$" + "00".repeat(64);
async function verifyPassword(pw, stored) {
  const parts = String(stored || DUMMY_HASH).split("$");
  const key = await scrypt(pw, Buffer.from(parts[1], "hex"), 64, { N: 16384, r: 8, p: 1 });
  const ok = crypto.timingSafeEqual(key, Buffer.from(parts[2], "hex"));
  return !!stored && ok;
}
function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || "").split(";").forEach((p) => {
    const i = p.indexOf("="); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
const isSecure = (req) => CFG.cookieSecure || (CFG.trustProxy && req.headers["x-forwarded-proto"] === "https");
const cookieStr = (req, token, maxAge) =>
  "kc_sid=" + token + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + maxAge + (isSecure(req) ? "; Secure" : "");
const uById = (id) => db.users.find((u) => u.id === id);
const uByPhone = (p) => db.users.find((u) => u.phone === p);

function getUser(req) {
  const t = parseCookies(req).kc_sid; if (!t) return null;
  const s = db.sessions[sha(t)];
  if (!s || s.exp < Date.now()) return null;
  const u = uById(s.userId);
  return u && !u.blocked ? u : null;
}
function startSession(ctx, user) {
  const token = crypto.randomBytes(32).toString("base64url");
  db.sessions[sha(token)] = { userId: user.id, exp: Date.now() + 30 * DAY, at: Date.now() };
  user.lastLoginAt = Date.now();
  saveSync();
  ctx.cookies.push(cookieStr(ctx.req, token, 30 * 86400));
}
function killSessions(userId, exceptHash) {
  for (const k of Object.keys(db.sessions)) if (db.sessions[k].userId === userId && k !== exceptHash) delete db.sessions[k];
}

/* ---------------- rate limits, OTP ---------------- */
const hits = new Map();
const clientIp = (req) => (CFG.trustProxy && String(req.headers["x-forwarded-for"] || "").split(",")[0].trim()) || req.socket.remoteAddress || "?";
function limit(req, bucket, max, windowMs, who) {
  const key = bucket + "|" + (who || clientIp(req));
  const now = Date.now();
  let h = hits.get(key);
  if (!h || now > h.reset) { h = { n: 0, reset: now + windowMs }; hits.set(key, h); }
  if (++h.n > max * CFG.rateScale) throw new HttpError(429, "Bahut jaldi-jaldi ho raha hai. Thodi der baad koshish karo.");
}
setInterval(() => { const t = Date.now(); for (const [k, v] of hits) if (t > v.reset) hits.delete(k); }, 60e3).unref();

const otps = new Map(); // in memory on purpose: short lived, 5 minutes
const OTP_SECRET = crypto.randomBytes(32);
const otpHash = (phone, purpose, code) => crypto.createHmac("sha256", OTP_SECRET).update(phone + "|" + purpose + "|" + code).digest("hex");
setInterval(() => { const t = Date.now(); for (const [k, v] of otps) if (t > v.exp) otps.delete(k); }, 60e3).unref();

async function sendSms(phone, message) {
  if (CFG.smsUrl) {
    const r = await fetch(CFG.smsUrl, {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, CFG.smsAuth ? { Authorization: CFG.smsAuth } : {}),
      body: JSON.stringify({ to: "+91" + phone, message }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error("SMS provider replied " + r.status);
    return true;
  }
  console.log("[SMS not configured] to " + phone + ": " + message);
  return false;
}
async function issueOtp(phone, purpose) {
  const key = phone + "|" + purpose, now = Date.now(), cur = otps.get(key);
  if (cur && now - cur.sentAt < 30e3) throw new HttpError(429, "OTP abhi bheja hai. " + Math.ceil((30e3 - (now - cur.sentAt)) / 1000) + " second baad dobara maango.");
  limit(null, "otp-phone", 6, 3600e3, phone); // max 6 OTPs per number per hour
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  otps.set(key, { hash: otpHash(phone, purpose, code), exp: now + 5 * 60e3, attempts: 0, sentAt: now });
  let delivered = false;
  try { delivered = await sendSms(phone, "Kaam Chowk OTP: " + code + ". 5 minute me expire hoga. Kisi ko mat batao."); }
  catch (e) { otps.delete(key); console.error(e.message); throw new HttpError(502, "SMS nahi bhej paaye. Thodi der baad koshish karo."); }
  return CFG.devOtp && !delivered ? code : undefined;
}
function checkOtp(phone, purpose, code) {
  const key = phone + "|" + purpose, o = otps.get(key);
  if (!o || Date.now() > o.exp) { otps.delete(key); throw new HttpError(400, "OTP expire ho gaya ya mila nahi. Naya OTP maango."); }
  if (o.attempts >= 5) { otps.delete(key); throw new HttpError(429, "Bahut galat koshish. Naya OTP maango."); }
  o.attempts++;
  const given = Buffer.from(otpHash(phone, purpose, digits(code)));
  if (!crypto.timingSafeEqual(given, Buffer.from(o.hash))) throw new HttpError(400, "OTP galat hai. " + (5 - o.attempts) + " koshish baaki.", { code: "OTP galat hai." });
  otps.delete(key);
}
const fails = new Map();
function lockCheck(phone) { const f = fails.get(phone); if (f && f.until > Date.now()) throw new HttpError(429, "Bahut galat koshish. 15 minute baad try karo, ya OTP se login karo."); }
function lockFail(phone) { const f = fails.get(phone) || { n: 0, until: 0 }; if (++f.n >= 5) { f.until = Date.now() + 15 * 60e3; f.n = 0; } fails.set(phone, f); }

/* ---------------- validation ---------------- */
const vName = (v) => { const s = clean(v, 40); return s.length >= 2 ? s : ""; };
function vPassword(p, phone) {
  p = String(p || "");
  if (p.length < 8) return "Password kam se kam 8 akshar ka rakho.";
  if (p.length > 72) return "Password bahut lamba hai.";
  if (digits(p) === phone) return "Password mobile number jaisa mat rakho.";
  return "";
}
function validateJob(b) {
  const job = { title: clean(b.title, 90), cat: clean(b.cat, 20), area: clean(b.area, 70), pay: clean(b.pay, 40), timing: clean(b.timing, 50), note: clean(b.note, 240) };
  const f = {};
  if (job.title.length < 4) f.title = "Kam se kam chaar akshar likho — jaise “putai, 2 kamre”.";
  if (!CATS.includes(job.cat)) f.cat = "Kaam ki kism chuno.";
  if (!job.area) f.area = "Jagah likho — mohalla ya gali.";
  if (!job.pay) f.pay = "Paisa likho (ya “baat karke” likh do).";
  if (Object.keys(f).length) throw new HttpError(400, "Form me galti hai.", f);
  return job;
}

/* ---------------- views (what each viewer may see) ---------------- */
const avg = (u) => (u.ratingCount ? Math.round((u.ratingSum / u.ratingCount) * 10) / 10 : null);
function selfView(u) {
  return {
    id: u.id, name: u.name, phone: fmtPhone(u.phone), role: u.role, area: u.area || "", skill: u.skill || "", bio: u.bio || "",
    experience: u.experience || 0, rate: u.rate || "", available: u.available !== false, verified: !!u.verified,
    rating: avg(u), ratingCount: u.ratingCount || 0, jobsDone: u.jobsDone || 0, createdAt: u.createdAt,
  };
}
const labourView = (u) => ({
  id: u.id, name: u.name, skill: u.skill, area: u.area, bio: u.bio || "", experience: u.experience || 0, rate: u.rate || "",
  verified: !!u.verified, rating: avg(u), ratingCount: u.ratingCount || 0, jobsDone: u.jobsDone || 0,
});
function ownerOf(j) {
  const u = j.ownerId && uById(j.ownerId);
  return { name: u ? u.name : j.ownerName || "Hata diya gaya", phone: u ? u.phone : j.ownerPhone || "", verified: !!(u && u.verified) };
}
function claimantOf(j) {
  const c = j.claimant; if (!c) return null;
  const u = c.userId && uById(c.userId);
  return { userId: c.userId || null, name: u ? u.name : c.legacyName || "Labour", phone: u ? u.phone : c.legacyPhone || "", claimedAt: c.claimedAt };
}
function jobView(j, v) {
  const o = ownerOf(j), c = claimantOf(j);
  const isOwner = !!v && !!j.ownerId && j.ownerId === v.id;
  const isCl = !!v && !!c && !!c.userId && c.userId === v.id;
  const isAdmin = !!v && v.role === "admin";
  const out = {
    id: j.id, title: j.title, cat: j.cat, area: j.area, pay: j.pay, timing: j.timing || "", note: j.note || "", status: j.status,
    createdAt: j.createdAt, ownerName: o.name, ownerVerified: o.verified, claimantName: c ? c.name : null, mine: isOwner, claimedByMe: isCl,
  };
  if ((isOwner || isAdmin) && c) out.claimant = { name: c.name, phone: fmtPhone(c.phone), claimedAt: c.claimedAt };
  if (isOwner || isCl || isAdmin) out.ownerPhone = fmtPhone(o.phone);
  if (j.status === "completed" && (isOwner || isCl || isAdmin)) { out.rating = j.rating || null; out.review = j.review || ""; }
  if (isAdmin) { out.ownerId = j.ownerId; out.demo = !!j.demo; }
  return out;
}
const byNew = (a, b) => b.createdAt - a.createdAt;
const activeClaims = (uid) => db.jobs.filter((j) => j.status === "taken" && j.claimant && j.claimant.userId === uid).length;

function audit(admin, action, target) {
  db.audit.unshift({ at: Date.now(), by: admin.name, action, target });
  if (db.audit.length > 500) db.audit.length = 500;
}

/* ---------------- routing ---------------- */
const routes = [];
function R(method, pattern, opts, fn) {
  if (typeof opts === "function") { fn = opts; opts = {}; }
  routes.push({ method, re: new RegExp("^" + pattern + "$"), opts, fn });
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > 16 * 1024) { reject(new HttpError(413, "Request bahut badi hai.")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try { const v = JSON.parse(Buffer.concat(chunks).toString("utf8")); resolve(v && typeof v === "object" && !Array.isArray(v) ? v : {}); }
      catch { reject(new HttpError(400, "JSON galat hai.")); }
    });
    req.on("error", reject);
  });
}
function send(res, status, body, headers) {
  res.writeHead(status, Object.assign({
    "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
  }, headers));
  res.end(JSON.stringify(body));
}

/* ======== public ======== */
R("GET", "/api/health", () => ({ ok: true }));
R("GET", "/api/config", () => ({ cats: CATS, devOtp: CFG.devOtp, smsConfigured: !!CFG.smsUrl }));
R("GET", "/api/stats", () => ({
  open: db.jobs.filter((j) => j.status === "open").length,
  placed: db.jobs.filter((j) => j.status === "taken" || j.status === "completed").length,
  labour: db.users.filter((u) => u.role === "labour" && u.phoneVerified && !u.blocked).length,
}));
R("GET", "/api/jobs", ({ user }) => {
  const open = db.jobs.filter((j) => j.status === "open").sort(byNew);
  const done = db.jobs.filter((j) => j.status === "taken" || j.status === "completed").sort(byNew).slice(0, 12);
  return { jobs: open.concat(done).map((j) => jobView(j, user)) };
});
R("GET", "/api/workers", ({ query }) => {
  const q = clean(query.q, 40).toLowerCase(), skill = clean(query.skill, 20);
  const list = db.users.filter((u) => u.role === "labour" && u.phoneVerified && !u.blocked && u.available !== false
    && (!skill || skill === "all" || u.skill === skill)
    && (!q || [u.name, u.area, u.skill, u.bio].join(" ").toLowerCase().includes(q)));
  list.sort((a, b) => (+!!b.verified - +!!a.verified) || ((avg(b) || 0) - (avg(a) || 0)) || ((b.jobsDone || 0) - (a.jobsDone || 0)));
  return { workers: list.slice(0, 60).map(labourView), total: list.length };
});
R("GET", "/api/workers/([\\w-]+)/phone", { roles: ["employer", "admin"] }, ({ req, m, user }) => {
  limit(req, "reveal", 40, 3600e3, user.id);
  const w = uById(m[1]);
  if (!w || w.role !== "labour" || w.blocked || !w.phoneVerified) throw new HttpError(404, "Ye vyakti nahi mila.");
  return { phone: fmtPhone(w.phone) };
});

/* ======== auth ======== */
R("POST", "/api/auth/register", async ({ req, body }) => {
  limit(req, "reg", 10, 3600e3);
  const phone = normPhone(body.phone), name = vName(body.name), role = clean(body.role, 10);
  const f = {};
  if (!name) f.name = "Apna poora naam likho.";
  const pe = phoneErr(phone); if (pe) f.phone = pe;
  if (!["employer", "labour"].includes(role)) f.role = "Chuno: kaam dene wala ya kaam karne wala.";
  const pwe = vPassword(body.password, phone); if (pwe) f.password = pwe;
  const area = clean(body.area, 50); let skill = "";
  if (role === "labour") {
    skill = clean(body.skill, 20);
    if (!CATS.includes(skill)) f.skill = "Kaam ki kism chuno.";
    if (!area) f.area = "Mohalla likho.";
  }
  if (Object.keys(f).length) throw new HttpError(400, "Form me galti hai.", f);
  let u = uByPhone(phone);
  if (u && (u.phoneVerified || u.role === "admin")) throw new HttpError(409, "Ye number pehle se register hai. Login karo.", { phone: "Ye number pehle se register hai." });
  const passHash = await hashPassword(String(body.password));
  if (!u) { u = { id: newId("u"), phone, createdAt: Date.now() }; db.users.push(u); }
  Object.assign(u, { name, role, area, skill, passHash, phoneVerified: false, blocked: false, verified: false, available: true, bio: "", experience: 0, rate: "", jobsDone: 0, ratingSum: 0, ratingCount: 0 });
  saveSync();
  const devOtp = await issueOtp(phone, "register");
  return { ok: true, resendIn: 30, devOtp };
});

R("POST", "/api/auth/otp/request", async ({ req, body }) => {
  limit(req, "otp", 10, 600e3);
  const phone = normPhone(body.phone), purpose = clean(body.purpose, 10);
  if (!["login", "reset", "register"].includes(purpose)) throw new HttpError(400, "Galat request.");
  const pe = phoneErr(phone); if (pe) throw new HttpError(400, pe, { phone: pe });
  const u = uByPhone(phone);
  const eligible = u && !u.demo && !u.blocked && u.role !== undefined && (purpose === "register" ? !u.phoneVerified : u.phoneVerified);
  // Same answer whether or not the number exists, so numbers cannot be probed.
  const devOtp = eligible ? await issueOtp(phone, purpose) : undefined;
  return { ok: true, resendIn: 30, devOtp };
});

R("POST", "/api/auth/otp/verify", async (ctx) => {
  const { req, body } = ctx;
  limit(req, "otpv", 20, 600e3);
  const phone = normPhone(body.phone), purpose = clean(body.purpose, 10);
  if (!["login", "register"].includes(purpose)) throw new HttpError(400, "Galat request.");
  checkOtp(phone, purpose, body.code);
  const u = uByPhone(phone);
  if (!u || u.demo) throw new HttpError(400, "Account nahi mila.");
  if (u.blocked) throw new HttpError(403, "Ye account band hai. Admin se baat karo.");
  if (purpose === "register") u.phoneVerified = true;
  else if (!u.phoneVerified) throw new HttpError(400, "Pehle register karo.");
  startSession(ctx, u);
  return { user: selfView(u) };
});

R("POST", "/api/auth/login", async (ctx) => {
  const { req, body } = ctx;
  limit(req, "login", 15, 600e3);
  const phone = normPhone(body.phone);
  const pe = phoneErr(phone); if (pe) throw new HttpError(400, pe, { phone: pe });
  lockCheck(phone);
  const u = uByPhone(phone);
  const ok = await verifyPassword(String(body.password || ""), u && u.passHash);
  if (!u || !ok || u.demo) { lockFail(phone); throw new HttpError(401, "Mobile number ya password galat hai."); }
  if (u.blocked) throw new HttpError(403, "Ye account band hai. Admin se baat karo.");
  if (!u.phoneVerified) throw new HttpError(403, "Pehle mobile number OTP se verify karo.", undefined, { needsVerify: true });
  fails.delete(phone);
  startSession(ctx, u);
  return { user: selfView(u) };
});

R("POST", "/api/auth/reset", async ({ req, body }) => {
  limit(req, "reset", 10, 600e3);
  const phone = normPhone(body.phone);
  const pwe = vPassword(body.newPassword, phone);
  if (pwe) throw new HttpError(400, pwe, { newPassword: pwe }); // checked first so a typo does not burn the OTP
  checkOtp(phone, "reset", body.code);
  const u = uByPhone(phone);
  if (!u || u.demo || u.blocked) throw new HttpError(400, "Account nahi mila.");
  u.passHash = await hashPassword(String(body.newPassword));
  u.phoneVerified = true;
  killSessions(u.id);
  fails.delete(phone);
  saveSync();
  return { ok: true };
});

R("POST", "/api/auth/logout", (ctx) => {
  const t = parseCookies(ctx.req).kc_sid;
  if (t) { delete db.sessions[sha(t)]; saveSync(); }
  ctx.cookies.push(cookieStr(ctx.req, "", 0));
  return { ok: true };
});
R("GET", "/api/auth/me", ({ user }) => ({ user: user ? selfView(user) : null }));

/* ======== me (profile) ======== */
R("PATCH", "/api/me", { auth: true }, ({ user, body }) => {
  const f = {};
  if ("name" in body) { const n = vName(body.name); if (!n) f.name = "Apna poora naam likho."; else user.name = n; }
  if ("area" in body) { const a = clean(body.area, 50); if (user.role === "labour" && !a) f.area = "Mohalla likho."; else user.area = a; }
  if (user.role === "labour") {
    if ("skill" in body) { const s = clean(body.skill, 20); if (!CATS.includes(s)) f.skill = "Kaam ki kism chuno."; else user.skill = s; }
    if ("bio" in body) user.bio = clean(body.bio, 200);
    if ("rate" in body) user.rate = clean(body.rate, 30);
    if ("experience" in body) {
      const x = Math.round(Number(body.experience));
      if (!Number.isFinite(x) || x < 0 || x > 60) f.experience = "0 se 60 ke beech saal likho."; else user.experience = x;
    }
    if ("available" in body) user.available = !!body.available;
  }
  if (Object.keys(f).length) throw new HttpError(400, "Form me galti hai.", f);
  saveSync();
  return { user: selfView(user) };
});
R("POST", "/api/me/password", { auth: true }, async ({ req, user, body }) => {
  limit(req, "pw", 10, 600e3, user.id);
  const pwe = vPassword(body.newPassword, user.phone);
  if (pwe) throw new HttpError(400, pwe, { newPassword: pwe });
  if (!(await verifyPassword(String(body.oldPassword || ""), user.passHash))) throw new HttpError(400, "Purana password galat hai.", { oldPassword: "Purana password galat hai." });
  user.passHash = await hashPassword(String(body.newPassword));
  const cur = parseCookies(req).kc_sid;
  killSessions(user.id, cur && sha(cur));
  saveSync();
  return { ok: true };
});
R("GET", "/api/me/jobs", { auth: true }, ({ user }) => {
  if (user.role === "employer") return { jobs: db.jobs.filter((j) => j.ownerId === user.id).sort(byNew).map((j) => jobView(j, user)) };
  if (user.role === "labour") return { jobs: db.jobs.filter((j) => j.claimant && j.claimant.userId === user.id).sort(byNew).map((j) => jobView(j, user)) };
  return { jobs: [] };
});

/* ======== job lifecycle ======== */
R("POST", "/api/jobs", { roles: ["employer"] }, ({ req, user, body }) => {
  limit(req, "post", 15, 3600e3, user.id);
  const job = validateJob(body);
  if (db.jobs.filter((j) => j.ownerId === user.id && j.status === "open").length >= MAX_OPEN_POSTS)
    throw new HttpError(429, "Ek saath " + MAX_OPEN_POSTS + " se zyada khule kaam nahi ho sakte. Purane band karo.");
  Object.assign(job, { id: newId("j"), ownerId: user.id, status: "open", createdAt: Date.now(), claimant: null });
  db.jobs.unshift(job);
  saveSync();
  return [201, { job: jobView(job, user) }];
});
function myJob(m, user, ownerOnly) {
  const j = db.jobs.find((x) => x.id === m[1]);
  if (!j) throw new HttpError(404, "Ye kaam nahi mila.");
  if (ownerOnly && j.ownerId !== user.id) throw new HttpError(403, "Ye tumhara kaam nahi hai.");
  return j;
}
R("PATCH", "/api/jobs/([\\w-]+)", { roles: ["employer"] }, ({ m, user, body }) => {
  const j = myJob(m, user, true);
  if (j.status !== "open") throw new HttpError(409, "Sirf khule kaam badle ja sakte hain.");
  Object.assign(j, validateJob(body));
  saveSync();
  return { job: jobView(j, user) };
});
R("POST", "/api/jobs/([\\w-]+)/cancel", { roles: ["employer"] }, ({ m, user }) => {
  const j = myJob(m, user, true);
  if (j.status !== "open" && j.status !== "taken") throw new HttpError(409, "Ye kaam ab band nahi ho sakta.");
  j.status = "cancelled"; j.cancelledAt = Date.now();
  saveSync();
  return { job: jobView(j, user) };
});
R("POST", "/api/jobs/([\\w-]+)/claim", { roles: ["labour"] }, ({ req, m, user }) => {
  limit(req, "claim", 20, 3600e3, user.id);
  const j = myJob(m, user, false);
  if (j.status !== "open") throw new HttpError(409, "Ye kaam kisi aur ne utha liya.");
  if (activeClaims(user.id) >= MAX_ACTIVE_CLAIMS) throw new HttpError(409, "Ek saath " + MAX_ACTIVE_CLAIMS + " kaam hi le sakte ho. Pehle koi kaam pura karo.");
  j.status = "taken";
  j.claimant = { userId: user.id, claimedAt: Date.now() };
  saveSync();
  return { job: jobView(j, user) };
});
R("POST", "/api/jobs/([\\w-]+)/release", { roles: ["labour"] }, ({ m, user }) => {
  const j = myJob(m, user, false);
  if (j.status !== "taken" || !j.claimant || j.claimant.userId !== user.id) throw new HttpError(409, "Ye kaam tumhare paas nahi hai.");
  j.status = "open"; j.claimant = null;
  saveSync();
  return { job: jobView(j, user) };
});
R("POST", "/api/jobs/([\\w-]+)/complete", { roles: ["employer"] }, ({ m, user, body }) => {
  const j = myJob(m, user, true);
  if (j.status !== "taken") throw new HttpError(409, "Kaam pura tabhi hota hai jab koi use utha le.");
  let rating = null;
  if (body.rating != null && body.rating !== "") {
    rating = Math.round(Number(body.rating));
    if (!(rating >= 1 && rating <= 5)) throw new HttpError(400, "Rating 1 se 5 ke beech chuno.", { rating: "Rating 1 se 5 ke beech chuno." });
  }
  j.status = "completed"; j.completedAt = Date.now();
  if (rating) { j.rating = rating; j.review = clean(body.review, 200); }
  const w = j.claimant && j.claimant.userId && uById(j.claimant.userId);
  if (w) { w.jobsDone = (w.jobsDone || 0) + 1; if (rating) { w.ratingSum = (w.ratingSum || 0) + rating; w.ratingCount = (w.ratingCount || 0) + 1; } }
  saveSync();
  return { job: jobView(j, user) };
});

/* ======== admin ======== */
const ADMIN = { roles: ["admin"] };
function adminUserView(u) {
  return {
    id: u.id, name: u.name, phone: fmtPhone(u.phone), role: u.role, area: u.area || "", skill: u.skill || "", verified: !!u.verified,
    blocked: !!u.blocked, phoneVerified: !!u.phoneVerified, demo: !!u.demo, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt || null,
    jobsPosted: db.jobs.filter((j) => j.ownerId === u.id).length,
    jobsClaimed: db.jobs.filter((j) => j.claimant && j.claimant.userId === u.id).length,
    rating: avg(u), ratingCount: u.ratingCount || 0, jobsDone: u.jobsDone || 0,
  };
}
R("GET", "/api/admin/stats", ADMIN, () => {
  const now = Date.now(), days = [];
  for (let i = 6; i >= 0; i--) days.push(dayKey(now - i * DAY));
  const series = (items, ts) => days.map((d) => ({ day: d, count: items.filter((x) => dayKey(ts(x)) === d).length }));
  const real = db.users.filter((u) => u.role !== "admin" && !u.demo);
  const byStatus = (s) => db.jobs.filter((j) => j.status === s).length;
  return {
    users: { total: real.length, labour: real.filter((u) => u.role === "labour").length, employer: real.filter((u) => u.role === "employer").length,
      blocked: real.filter((u) => u.blocked).length, pending: real.filter((u) => !u.phoneVerified).length,
      unverifiedLabour: real.filter((u) => u.role === "labour" && u.phoneVerified && !u.verified).length },
    jobs: { open: byStatus("open"), taken: byStatus("taken"), completed: byStatus("completed"), cancelled: byStatus("cancelled"), total: db.jobs.length },
    signups: series(real, (u) => u.createdAt),
    posted: series(db.jobs.filter((j) => !j.demo), (j) => j.createdAt),
    categories: CATS.map((c) => ({ cat: c, count: db.jobs.filter((j) => j.cat === c).length })).filter((x) => x.count),
    demoCount: db.users.filter((u) => u.demo).length + db.jobs.filter((j) => j.demo).length,
    avgRating: (() => { const r = db.users.filter((u) => u.ratingCount); const c = r.reduce((s, u) => s + u.ratingCount, 0); return c ? Math.round((r.reduce((s, u) => s + u.ratingSum, 0) / c) * 10) / 10 : null; })(),
  };
});
R("GET", "/api/admin/users", ADMIN, ({ query }) => {
  const q = clean(query.q, 40).toLowerCase(), role = clean(query.role, 10), status = clean(query.status, 10);
  let list = db.users.filter((u) => u.role !== "admin"
    && (!role || role === "all" || u.role === role)
    && (!status || status === "all" || (status === "blocked" ? u.blocked : status === "pending" ? !u.phoneVerified : status === "unverified" ? (u.phoneVerified && !u.verified) : true))
    && (!q || [u.name, u.phone, u.area, u.skill].join(" ").toLowerCase().includes(q)));
  list.sort(byNew);
  const off = Math.max(0, parseInt(query.offset, 10) || 0);
  return { total: list.length, users: list.slice(off, off + 50).map(adminUserView) };
});
R("PATCH", "/api/admin/users/([\\w-]+)", ADMIN, ({ user, m, body }) => {
  const u = uById(m[1]);
  if (!u || u.role === "admin") throw new HttpError(404, "User nahi mila.");
  if ("blocked" in body) { u.blocked = !!body.blocked; if (u.blocked) killSessions(u.id); audit(user, u.blocked ? "block" : "unblock", u.name + " (" + fmtPhone(u.phone) + ")"); }
  if ("verified" in body) { u.verified = !!body.verified; audit(user, u.verified ? "verify" : "unverify", u.name + " (" + fmtPhone(u.phone) + ")"); }
  saveSync();
  return { user: adminUserView(u) };
});
function removeUser(u) {
  killSessions(u.id);
  db.jobs.forEach((j) => {
    if (j.ownerId === u.id) { j.ownerId = null; j.ownerName = ""; j.ownerPhone = ""; if (j.status === "open" || j.status === "taken") j.status = "cancelled"; }
    if (j.claimant && j.claimant.userId === u.id) { if (j.status === "taken") { j.status = "open"; j.claimant = null; } else j.claimant = { userId: null, legacyName: "Hata diya gaya", legacyPhone: "", claimedAt: j.claimant.claimedAt }; }
  });
  db.users = db.users.filter((x) => x.id !== u.id);
}
R("DELETE", "/api/admin/users/([\\w-]+)", ADMIN, ({ user, m }) => {
  const u = uById(m[1]);
  if (!u || u.role === "admin") throw new HttpError(404, "User nahi mila.");
  audit(user, "delete user", u.name + " (" + fmtPhone(u.phone) + ")");
  removeUser(u); saveSync();
  return { ok: true };
});
R("GET", "/api/admin/jobs", ADMIN, ({ query }) => {
  const q = clean(query.q, 40).toLowerCase(), status = clean(query.status, 10);
  const list = db.jobs.filter((j) => (!status || status === "all" || j.status === status)
    && (!q || [j.title, j.area, ownerOf(j).name, CATS.includes(j.cat) ? j.cat : ""].join(" ").toLowerCase().includes(q))).sort(byNew);
  const off = Math.max(0, parseInt(query.offset, 10) || 0);
  return { total: list.length, jobs: list.slice(off, off + 50).map((j) => jobView(j, { role: "admin" })) };
});
R("PATCH", "/api/admin/jobs/([\\w-]+)", ADMIN, ({ user, m, body }) => {
  const j = db.jobs.find((x) => x.id === m[1]);
  if (!j) throw new HttpError(404, "Kaam nahi mila.");
  if (body.status !== "cancelled") throw new HttpError(400, "Sirf band (cancelled) kiya ja sakta hai.");
  j.status = "cancelled"; j.cancelledAt = Date.now();
  audit(user, "cancel job", j.title);
  saveSync();
  return { job: jobView(j, user) };
});
R("DELETE", "/api/admin/jobs/([\\w-]+)", ADMIN, ({ user, m }) => {
  const j = db.jobs.find((x) => x.id === m[1]);
  if (!j) throw new HttpError(404, "Kaam nahi mila.");
  audit(user, "delete job", j.title);
  db.jobs = db.jobs.filter((x) => x !== j); saveSync();
  return { ok: true };
});
R("POST", "/api/admin/purge-demo", ADMIN, ({ user }) => {
  const users = db.users.filter((u) => u.demo), jobs = db.jobs.filter((j) => j.demo);
  users.forEach(removeUser);
  db.jobs = db.jobs.filter((j) => !j.demo);
  audit(user, "demo data hataya", users.length + " users, " + jobs.length + " jobs");
  saveSync();
  return { ok: true, users: users.length, jobs: jobs.length };
});
R("GET", "/api/admin/log", ADMIN, () => ({ log: db.audit.slice(0, 100) }));

/* ---------------- static files ---------------- */
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8" };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { res.writeHead(400); return res.end(); }
  if (rel === "/") rel = "/index.html";
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("Nahi mila"); }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "Content-Security-Policy": CSP,
      "Cache-Control": "no-cache",
    });
    res.end(req.method === "HEAD" ? undefined : buf);
  });
}

/* ---------------- server ---------------- */
const server = http.createServer(async (req, res) => {
  let pathname;
  try { pathname = new URL(req.url, "http://x").pathname; } catch { res.writeHead(400); return res.end(); }
  if (!pathname.startsWith("/api/")) {
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end(); }
    return serveStatic(req, res, pathname);
  }
  const ctx = { req, res, query: Object.fromEntries(new URL(req.url, "http://x").searchParams), cookies: [], user: null, body: {}, m: null };
  try {
    limit(req, "api", 300, 60e3);
    const write = req.method !== "GET" && req.method !== "HEAD";
    if (write) {
      const origin = req.headers.origin;
      if (origin) { let ok = false; try { ok = new URL(origin).host === req.headers.host; } catch {} if (!ok) throw new HttpError(403, "Request allowed nahi."); }
      const len = Number(req.headers["content-length"] || 0);
      if (len > 0 && !String(req.headers["content-type"] || "").startsWith("application/json")) throw new HttpError(415, "JSON bhejo.");
    }
    let route = null, mismatch = false;
    for (const r of routes) {
      const m = pathname.match(r.re); if (!m) continue;
      if (r.method === req.method) { route = r; ctx.m = m; break; }
      mismatch = true;
    }
    if (!route) throw new HttpError(mismatch ? 405 : 404, mismatch ? "Method allowed nahi." : "Route nahi mila.");
    ctx.user = getUser(req);
    if (route.opts.auth || route.opts.roles) {
      if (!ctx.user) throw new HttpError(401, "Pehle login karo.");
      if (route.opts.roles && !route.opts.roles.includes(ctx.user.role)) throw new HttpError(403, "Ye kaam tumhare account se nahi ho sakta.");
    }
    if (write) ctx.body = await readJson(req);
    let out = await route.fn(ctx), status = 200;
    if (Array.isArray(out)) [status, out] = out;
    send(res, status, out, ctx.cookies.length ? { "Set-Cookie": ctx.cookies } : undefined);
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, Object.assign({ error: e.message, fields: e.fields }, e.extra));
    console.error(e);
    send(res, 500, { error: "Server me gadbad ho gayi." });
  }
});

load().then(() => {
  server.listen(CFG.port, () => {
    console.log("Kaam Chowk chal raha hai: http://localhost:" + CFG.port);
    if (!CFG.smsUrl) console.log(CFG.devOtp ? "  OTP mode: DEV — OTP API response me aur is console me dikhega. Asli SMS ke liye SMS_WEBHOOK_URL set karo." : "  WARNING: SMS_WEBHOOK_URL set nahi hai — OTP users tak nahi pahunchega.");
  });
});

"use strict";
// Run: node --test test/
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

let proc, base, dir;
const PORT = 3400 + Math.floor(Math.random() * 400);

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kc-"));
  proc = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: Object.assign({}, process.env, { PORT, DATA_DIR: dir, ADMIN_PHONE: "9000000001", ADMIN_PASSWORD: "adminpass123", DEV_OTP: "1", SEED_DEMO: "0", RATE_SCALE: "100" }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  base = "http://localhost:" + PORT;
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base + "/api/health")).ok) return; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  throw new Error("server did not start");
});
after(() => { proc.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

// tiny client with its own cookie jar
function client() {
  let cookie = "";
  return async (method, url, body, headers) => {
    const r = await fetch(base + url, {
      method, headers: Object.assign({ cookie }, body !== undefined ? { "Content-Type": "application/json" } : {}, headers), body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    if (sc.length) cookie = sc[0].split(";")[0].replace(/^kc_sid=$/, "");
    return { status: r.status, body: await r.json().catch(() => ({})), setCookie: sc };
  };
}
async function signup(role, phone, extra) {
  const c = client();
  const r = await c("POST", "/api/auth/register", Object.assign({ name: "Test " + role, phone, role, password: "secret-pass-1", skill: "painting", area: "Gandhi Colony" }, extra));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.devOtp, /^\d{6}$/);
  const v = await c("POST", "/api/auth/otp/verify", { phone, purpose: "register", code: r.body.devOtp });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  return c;
}

test("register validates input and sets nothing until OTP verified", async () => {
  const c = client();
  const bad = await c("POST", "/api/auth/register", { name: "x", phone: "123", role: "king", password: "short" });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.fields.name && bad.body.fields.phone && bad.body.fields.role && bad.body.fields.password);
  const ok = await c("POST", "/api/auth/register", { name: "Ravi Kumar", phone: "9811111111", role: "employer", password: "secret-pass-1" });
  assert.equal(ok.status, 200);
  assert.equal(ok.setCookie.length, 0);
  const login = await c("POST", "/api/auth/login", { phone: "9811111111", password: "secret-pass-1" });
  assert.equal(login.status, 403);
  assert.equal(login.body.needsVerify, true);
});

test("OTP: wrong code counts attempts, right code logs in with HttpOnly cookie", async () => {
  const c = client();
  const r = await c("POST", "/api/auth/register", { name: "Sita Devi", phone: "9822222222", role: "labour", password: "secret-pass-1", skill: "safai", area: "Station Road" });
  const wrong = await c("POST", "/api/auth/otp/verify", { phone: "9822222222", purpose: "register", code: r.body.devOtp === "000000" ? "111111" : "000000" });
  assert.equal(wrong.status, 400);
  assert.match(wrong.body.error, /4 koshish/);
  const good = await c("POST", "/api/auth/otp/verify", { phone: "9822222222", purpose: "register", code: r.body.devOtp });
  assert.equal(good.status, 200);
  assert.match(good.setCookie[0], /HttpOnly/);
  assert.match(good.setCookie[0], /SameSite=Lax/);
  const me = await c("GET", "/api/auth/me");
  assert.equal(me.body.user.name, "Sita Devi");
  assert.equal(me.body.user.phone, "98222 22222");
  const reuse = await c("POST", "/api/auth/otp/verify", { phone: "9822222222", purpose: "register", code: r.body.devOtp });
  assert.equal(reuse.status, 400); // OTP is single use
});

test("OTP is locked after 5 wrong tries", async () => {
  const c = client();
  const r = await c("POST", "/api/auth/register", { name: "Lock Test", phone: "9833333333", role: "employer", password: "secret-pass-1" });
  const wrongCode = r.body.devOtp === "123456" ? "654321" : "123456";
  let last;
  for (let i = 0; i < 5; i++) last = await c("POST", "/api/auth/otp/verify", { phone: "9833333333", purpose: "register", code: wrongCode });
  const after = await c("POST", "/api/auth/otp/verify", { phone: "9833333333", purpose: "register", code: r.body.devOtp });
  assert.equal(last.status, 400);
  assert.equal(after.status, 429);
  assert.notEqual(after.status, 200, "real code must not work after lockout: " + JSON.stringify(after.body));
});

test("password login, OTP login, wrong password lockout", async () => {
  await signup("employer", "9844444444");
  const c = client();
  assert.equal((await c("POST", "/api/auth/login", { phone: "98444 44444", password: "secret-pass-1" })).status, 200);
  const o = client();
  const req = await o("POST", "/api/auth/otp/request", { phone: "9844444444", purpose: "login" });
  assert.match(req.body.devOtp, /^\d{6}$/);
  assert.equal((await o("POST", "/api/auth/otp/verify", { phone: "9844444444", purpose: "login", code: req.body.devOtp })).status, 200);
  // unknown number: same shape, no OTP leaked
  const unk = await client()("POST", "/api/auth/otp/request", { phone: "9855555550", purpose: "login" });
  assert.equal(unk.status, 200); assert.equal(unk.body.devOtp, undefined);
  const x = client(); let r;
  for (let i = 0; i < 5; i++) r = await x("POST", "/api/auth/login", { phone: "9844444444", password: "nope-nope-1" });
  assert.equal(r.status, 401);
  assert.equal((await x("POST", "/api/auth/login", { phone: "9844444444", password: "secret-pass-1" })).status, 429);
});

test("forgot password: OTP resets, old password and old sessions die", async () => {
  const a = await signup("labour", "9866666666");
  const c = client();
  const req = await c("POST", "/api/auth/otp/request", { phone: "9866666666", purpose: "reset" });
  const weak = await c("POST", "/api/auth/reset", { phone: "9866666666", code: req.body.devOtp, newPassword: "abc" });
  assert.equal(weak.status, 400);
  const bad = await c("POST", "/api/auth/reset", { phone: "9866666666", code: "000000" === req.body.devOtp ? "111111" : "000000", newPassword: "brand-new-pass" });
  assert.equal(bad.status, 400);
  const ok = await c("POST", "/api/auth/reset", { phone: "9866666666", code: req.body.devOtp, newPassword: "brand-new-pass" });
  assert.equal(ok.status, 200, JSON.stringify(ok.body)); // weak attempt did not burn the OTP
  assert.equal((await client()("POST", "/api/auth/login", { phone: "9866666666", password: "secret-pass-1" })).status, 401);
  assert.equal((await client()("POST", "/api/auth/login", { phone: "9866666666", password: "brand-new-pass" })).status, 200);
  assert.equal((await a("GET", "/api/auth/me")).body.user, null);
});

test("marketplace flow: post, claim, privacy, complete with rating, role rules", async () => {
  const emp = await signup("employer", "9877777771");
  const lab = await signup("labour", "9877777772");
  const lab2 = await signup("labour", "9877777773");

  assert.equal((await lab("POST", "/api/jobs", { title: "Putai", cat: "painting", area: "x", pay: "1" })).status, 403);
  assert.equal((await client()("POST", "/api/jobs", { title: "Putai", cat: "painting", area: "x", pay: "1" })).status, 401);
  assert.equal((await emp("POST", "/api/jobs", { title: "ab", cat: "zzz" })).status, 400);

  const posted = await emp("POST", "/api/jobs", { title: "Deewar ki putai", cat: "painting", area: "Gandhi Colony", pay: "₹800 / din" });
  assert.equal(posted.status, 201);
  const id = posted.body.job.id;

  const pub = (await client()("GET", "/api/jobs")).body.jobs.find((j) => j.id === id);
  assert.equal(pub.ownerPhone, undefined);       // public cannot see contact
  const asLab = (await lab("GET", "/api/jobs")).body.jobs.find((j) => j.id === id);
  assert.equal(asLab.ownerPhone, undefined);     // not even labour before claiming

  assert.equal((await emp("POST", `/api/jobs/${id}/claim`)).status, 403);
  const claim = await lab("POST", `/api/jobs/${id}/claim`);
  assert.equal(claim.status, 200);
  assert.equal(claim.body.job.ownerPhone, "98777 77771");   // revealed after claim
  assert.equal((await lab2("POST", `/api/jobs/${id}/claim`)).status, 409); // no double-claim
  assert.equal((await lab2("POST", `/api/jobs/${id}/complete`)).status, 403);

  const mine = (await emp("GET", "/api/me/jobs")).body.jobs[0];
  assert.equal(mine.claimant.phone, "98777 77772");          // employer sees labour contact
  assert.equal((await client()("GET", "/api/jobs")).body.jobs.find((j) => j.id === id).claimant, undefined);

  // release re-opens, then re-claim, then complete
  assert.equal((await lab("POST", `/api/jobs/${id}/release`)).body.job.status, "open");
  await lab("POST", `/api/jobs/${id}/claim`);
  assert.equal((await emp("POST", `/api/jobs/${id}/complete`, { rating: 9 })).status, 400);
  const done = await emp("POST", `/api/jobs/${id}/complete`, { rating: 5, review: "Time par aaya" });
  assert.equal(done.body.job.status, "completed");
  const me = (await lab("GET", "/api/auth/me")).body.user;
  assert.equal(me.jobsDone, 1); assert.equal(me.rating, 5);
  assert.equal((await emp("POST", `/api/jobs/${id}/cancel`)).status, 409);
});

test("labour is limited to 3 active jobs; profile edit + directory + phone reveal rules", async () => {
  const emp = await signup("employer", "9888888881");
  const lab = await signup("labour", "9888888882");
  const ids = [];
  for (let i = 0; i < 4; i++) ids.push((await emp("POST", "/api/jobs", { title: "Kaam number " + i, cat: "mazdoori", area: "A", pay: "100" })).body.job.id);
  for (let i = 0; i < 3; i++) assert.equal((await lab("POST", `/api/jobs/${ids[i]}/claim`)).status, 200);
  assert.equal((await lab("POST", `/api/jobs/${ids[3]}/claim`)).status, 409);

  const p = await lab("PATCH", "/api/me", { skill: "bijli", experience: 7, rate: "₹900 / din", bio: "Wiring expert", available: true });
  assert.equal(p.body.user.skill, "bijli");
  assert.equal((await lab("PATCH", "/api/me", { experience: 99 })).status, 400);
  const dir = (await client()("GET", "/api/workers?skill=bijli")).body.workers;
  const w = dir.find((x) => x.name === "Test labour");
  assert.ok(w); assert.equal(w.phone, undefined);
  assert.equal((await client()("GET", `/api/workers/${w.id}/phone`)).status, 401);
  assert.equal((await lab("GET", `/api/workers/${w.id}/phone`)).status, 403);
  assert.equal((await emp("GET", `/api/workers/${w.id}/phone`)).body.phone, "98888 88882");
  await lab("PATCH", "/api/me", { available: false });
  assert.ok(!(await client()("GET", "/api/workers?skill=bijli")).body.workers.find((x) => x.id === w.id));
});

test("change password keeps this session, kills others", async () => {
  const a = await signup("employer", "9899999991");
  const login2 = client(); await login2("POST", "/api/auth/login", { phone: "9899999991", password: "secret-pass-1" });
  assert.equal((await a("POST", "/api/me/password", { oldPassword: "wrong-wrong", newPassword: "another-pass-2" })).status, 400);
  assert.equal((await a("POST", "/api/me/password", { oldPassword: "secret-pass-1", newPassword: "another-pass-2" })).status, 200);
  assert.ok((await a("GET", "/api/auth/me")).body.user);
  assert.equal((await login2("GET", "/api/auth/me")).body.user, null);
});

test("admin: access control, stats, block kills session, verify, delete, audit log", async () => {
  const admin = client();
  assert.equal((await admin("POST", "/api/auth/login", { phone: "9000000001", password: "adminpass123" })).status, 200);
  const emp = await signup("employer", "9700000001");
  const lab = await signup("labour", "9700000002");
  assert.equal((await emp("GET", "/api/admin/stats")).status, 403);
  assert.equal((await client()("GET", "/api/admin/users")).status, 401);

  const stats = (await admin("GET", "/api/admin/stats")).body;
  assert.ok(stats.users.total >= 2); assert.equal(stats.signups.length, 7);

  const list = (await admin("GET", "/api/admin/users?q=9700000002")).body;
  assert.equal(list.users.length, 1);
  const uid = list.users[0].id;
  assert.equal(list.users[0].phone, "97000 00002");

  assert.equal((await admin("PATCH", `/api/admin/users/${uid}`, { verified: true })).body.user.verified, true);
  assert.equal((await client()("GET", "/api/workers?q=Test")).body.workers.find((w) => w.id === uid).verified, true);

  await admin("PATCH", `/api/admin/users/${uid}`, { blocked: true });
  assert.equal((await lab("GET", "/api/auth/me")).body.user, null);                     // live session killed
  assert.equal((await client()("POST", "/api/auth/login", { phone: "9700000002", password: "secret-pass-1" })).status, 403);
  await admin("PATCH", `/api/admin/users/${uid}`, { blocked: false });

  const job = (await emp("POST", "/api/jobs", { title: "Admin test job", cat: "other", area: "A", pay: "1" })).body.job;
  assert.equal((await admin("PATCH", `/api/admin/jobs/${job.id}`, { status: "cancelled" })).body.job.status, "cancelled");
  assert.equal((await admin("DELETE", `/api/admin/jobs/${job.id}`)).status, 200);
  assert.equal((await admin("DELETE", `/api/admin/users/${uid}`)).status, 200);
  const log = (await admin("GET", "/api/admin/log")).body.log;
  assert.ok(log.some((l) => l.action === "block") && log.some((l) => l.action === "delete user"));
  // admin account cannot be touched through the API
  const me = (await admin("GET", "/api/auth/me")).body.user;
  assert.equal((await admin("DELETE", `/api/admin/users/${me.id}`)).status, 404);
});

test("CSRF-style guards: foreign Origin and non-JSON bodies are refused", async () => {
  const c = client();
  const r1 = await c("POST", "/api/auth/login", { phone: "9000000001", password: "adminpass123" }, { Origin: "https://evil.example" });
  assert.equal(r1.status, 403);
  const r2 = await fetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "phone=1" });
  assert.equal(r2.status, 415);
});

test("static: app files served with CSP, traversal blocked", async () => {
  const r = await fetch(base + "/");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-security-policy"), /script-src 'self'/);
  assert.equal((await fetch(base + "/..%2fserver.js")).status === 200, false);
  assert.equal((await fetch(base + "/data/db.json")).status, 404);
});

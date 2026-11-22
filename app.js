(() => {
"use strict";

/* ================= basics ================= */
const CATS = [["mazdoori","Mazdoori"],["painting","Painting"],["plumbing","Plumbing"],["bijli","Bijli"],["mistri","Mistri"],["safai","Safai"],["transport","Gadi / Transport"],["ghar","Ghar ka kaam"],["other","Kuch aur"]];
const CATMAP = Object.fromEntries(CATS);
const STATUS = { open: "Khula", taken: "Chal raha hai", completed: "Pura hua", cancelled: "Band" };
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const digits = (p) => String(p || "").replace(/\D/g, "");
const telHref = (p) => { const d = digits(p); return "tel:" + (d.length === 10 ? "+91" + d : d); };
const catLabel = (k) => CATMAP[k] || "Kaam";
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const fmtDate = (ts) => ts ? new Date(ts).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";
const fmtDateTime = (ts) => ts ? new Date(ts).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—";
function fmtAgo(ts) {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return "abhi";
  if (m < 60) return m + " min pehle";
  const h = Math.floor(m / 60);
  if (h < 24) return h + " ghante pehle";
  const d = Math.floor(h / 24);
  if (d === 1) return "kal";
  if (d < 8) return d + " din pehle";
  return Math.floor(d / 7) + " hafte pehle";
}
function rotFor(id) {
  let sum = 0; const s = String(id);
  for (let i = 0; i < s.length; i++) sum += s.charCodeAt(i) * (i + 3);
  return [-1.2, 0.9, -0.6, 1.3, -0.9, 0.5, -1.7, 1.1][sum % 8];
}
function stars(n) {
  const r = Math.round(n || 0);
  return `<span class="stars" role="img" aria-label="${n || 0} me se 5">${"★".repeat(r)}<i>${"★".repeat(5 - r)}</i></span>`;
}

const state = { me: null, cfg: { devOtp: false }, stats: null, jobs: [], workers: [], cat: "all", q: "", dq: "", dskill: "all", ready: false };

async function api(method, url, body) {
  let r;
  try {
    r = await fetch(url, { method, credentials: "same-origin", headers: body !== undefined ? { "Content-Type": "application/json" } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch { const e = new Error("Server se jud nahi paaye. Internet check karo."); e.status = 0; e.fields = {}; throw e; }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(data.error || "Kuch gadbad ho gayi.");
    e.status = r.status; e.fields = data.fields || {}; e.data = data;
    if (r.status === 401 && state.me) { state.me = null; renderNav(); toast("Session khatam ho gaya. Dobara login karo."); route(); }
    throw e;
  }
  return data;
}

let toastTimer;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("on");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("on"), 3600);
}
const busy = (btn, on) => { if (btn) btn.disabled = !!on; };

/* ================= modal ================= */
let lastFocus = null, modalTimer = null;
const focusables = (root) => $$('a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select,textarea', root).filter((el) => el.offsetParent !== null || el === document.activeElement);
function openModal(html) {
  closeModal(true);
  lastFocus = document.activeElement;
  $("#modal-root").innerHTML = `<div class="modal"><div class="modal-back" data-action="close"></div><div class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="m-title"><button class="modal-x" type="button" data-action="close" aria-label="Band karo">✕</button><div id="modal-body">${html}</div></div></div>`;
  document.body.style.overflow = "hidden";
  focusFirst();
}
function setModalBody(html) { $("#modal-body").innerHTML = html; focusFirst(); }
function focusFirst() {
  setTimeout(() => { const el = $("#modal-body input:not([type=radio]):not([type=checkbox]), #modal-body select, #modal-body button.btn-save"); if (el) el.focus(); }, 30);
}
function closeModal(silent) {
  clearInterval(modalTimer);
  $("#modal-root").innerHTML = "";
  document.body.style.overflow = "";
  if (!silent && lastFocus && document.contains(lastFocus)) lastFocus.focus();
}
const modalOpen = () => !!$("#modal-root .modal");

/* ================= form helpers ================= */
const fld = (id, label, inner, cls = "") => `<div class="field ${cls}"><label for="${id}">${label}</label>${inner}<p class="err" id="e-${id}" hidden></p></div>`;
const pwInput = (id, ac, ph = "") => `<div class="pw-wrap"><input id="${id}" type="password" autocomplete="${ac}" maxlength="72" placeholder="${ph}"><button class="pw-toggle" type="button" data-action="pw-toggle" aria-label="Password dikhao">Dikhao</button></div>`;
const phoneInput = (id, val = "") => `<input id="${id}" type="tel" inputmode="tel" autocomplete="tel-national" maxlength="14" placeholder="98765 43210" value="${esc(val)}">`;
const catOptions = (sel, first) => `<option value="">${first || "Chuno…"}</option>` + CATS.map(([k, v]) => `<option value="${k}"${k === sel ? " selected" : ""}>${v}</option>`).join("");
function clearErrs(form) {
  $$(`#${form} .err`).forEach((e) => { e.hidden = true; e.textContent = ""; });
  const fe = $(`#fe-${form}`); if (fe) { fe.hidden = true; fe.textContent = ""; }
}
// fields: {name: msg} from server; shows under input if "<form>-<name>" exists, otherwise in the form error line
function showErrs(form, fields, message, map = {}) {
  let general = !Object.keys(fields || {}).length;
  Object.keys(fields || {}).forEach((k) => {
    const el = $(`#e-${form}-${map[k] || k}`);
    if (el) { el.textContent = fields[k]; el.hidden = false; } else general = true;
  });
  if (general) { const fe = $(`#fe-${form}`); if (fe) { fe.textContent = message; fe.hidden = false; } else toast(message); }
  const first = $(`#${form} .err:not([hidden])`);
  if (first) { const inp = first.parentElement.querySelector("input,select,textarea"); if (inp) inp.focus(); }
}
const val = (id) => { const el = $("#" + id); return el ? el.value.trim() : ""; };
function phoneError(raw) {
  const d = digits(raw).replace(/^91(?=\d{10}$)/, "");
  if (d.length !== 10) return "10 ank ka mobile number likho (jaise 98765 43210).";
  if (!/^[6-9]/.test(d)) return "Number 6, 7, 8 ya 9 se shuru hona chahiye.";
  return "";
}

/* ================= auth ================= */
const auth = { phone: "", purpose: "", devOtp: undefined, role: "employer", then: null, notice: "" };

function openAuth(step = "login", opts = {}) {
  auth.then = opts.then || null;
  if (opts.role) auth.role = opts.role;
  if (opts.phone) auth.phone = opts.phone;
  auth.notice = ""; auth.devOtp = undefined;
  openModal(authHTML(step));
  afterAuthStep(step);
}
function gotoAuth(step, data) {
  Object.assign(auth, data || {});
  clearInterval(modalTimer);
  setModalBody(authHTML(step));
  afterAuthStep(step);
}
function afterAuthStep(step) { if (step === "otp" || step === "reset") startResend(30); }

function authHTML(step) {
  const notice = auth.notice ? `<p class="form-ok">${esc(auth.notice)}</p>` : "";
  if (step === "login" || step === "loginotp") {
    const pwMode = step === "login";
    return `<h2 class="modal-title" id="m-title">Login</h2>
      <p class="modal-sub">Apne mobile number se andar aao.</p>
      <div class="seg"><button type="button" data-action="auth-step" data-step="login" aria-pressed="${pwMode}">Password se</button><button type="button" data-action="auth-step" data-step="loginotp" aria-pressed="${!pwMode}">OTP se</button></div>
      <form id="f-login" data-form="${pwMode ? "login" : "loginotp"}" class="stack" novalidate>
        ${notice}<p class="form-err" id="fe-f-login" hidden role="alert"></p>
        ${fld("f-login-phone", "Mobile number", phoneInput("f-login-phone", auth.phone))}
        ${pwMode ? fld("f-login-password", "Password", pwInput("f-login-password", "current-password")) : `<p class="hint">Is number par 6 ank ka OTP SMS se aayega. Password ki zaroorat nahi.</p>`}
        <button class="btn-save" type="submit">${pwMode ? "Login karo" : "OTP bhejo"}</button>
        <div class="links-row">
          ${pwMode ? `<button type="button" class="btn-link" data-action="auth-step" data-step="forgot">Password bhool gaye?</button>` : "<span></span>"}
          <button type="button" class="btn-link" data-action="auth-step" data-step="register">Naya account banao</button>
        </div>
      </form>`;
  }
  if (step === "register") {
    const lab = auth.role === "labour";
    return `<h2 class="modal-title" id="m-title">Naya account</h2>
      <p class="modal-sub">Free hai. Mobile number OTP se verify hoga.</p>
      <form id="f-reg" data-form="register" class="stack" novalidate>
        <p class="form-err" id="fe-f-reg" hidden role="alert"></p>
        <div class="field"><span class="lbl" id="role-lbl">Tum kaun ho?</span>
          <div class="pills" role="radiogroup" aria-labelledby="role-lbl">
            <label class="pill"><input type="radio" name="role" value="employer"${lab ? "" : " checked"}><span>Kaam dene wala</span></label>
            <label class="pill"><input type="radio" name="role" value="labour"${lab ? " checked" : ""}><span>Kaam karne wala (labour)</span></label>
          </div><p class="err" id="e-f-reg-role" hidden></p></div>
        ${fld("f-reg-name", "Poora naam", `<input id="f-reg-name" type="text" maxlength="40" autocomplete="name" placeholder="jaise: Ramesh Kumar">`)}
        ${fld("f-reg-phone", "Mobile number", phoneInput("f-reg-phone", auth.phone))}
        <div class="two-fields" id="labour-fields"${lab ? "" : " hidden"}>
          ${fld("f-reg-skill", "Kya kaam karte ho?", `<select id="f-reg-skill">${catOptions("")}</select>`)}
          ${fld("f-reg-area", "Kahan rehte ho?", `<input id="f-reg-area" type="text" maxlength="50" placeholder="mohalla / colony">`)}
        </div>
        ${fld("f-reg-password", "Password (kam se kam 8 akshar)", pwInput("f-reg-password", "new-password"))}
        <button class="btn-save" type="submit">OTP bhejo</button>
        <div class="links-row"><span class="hint">Pehle se account hai?</span><button type="button" class="btn-link" data-action="auth-step" data-step="login">Login karo</button></div>
      </form>`;
  }
  if (step === "forgot") {
    return `<h2 class="modal-title" id="m-title">Password bhool gaye?</h2>
      <p class="modal-sub">Mobile number likho. OTP se naya password bana sakte ho.</p>
      <form id="f-forgot" data-form="forgot" class="stack" novalidate>
        <p class="form-err" id="fe-f-forgot" hidden role="alert"></p>
        ${fld("f-forgot-phone", "Mobile number", phoneInput("f-forgot-phone", auth.phone))}
        <button class="btn-save" type="submit">OTP bhejo</button>
        <div class="links-row"><button type="button" class="btn-link" data-action="auth-step" data-step="login">← Login par wapas</button></div>
      </form>`;
  }
  if (step === "otp" || step === "reset") {
    const m = digits(auth.phone); const masked = m.length === 10 ? "XXXXX X" + m.slice(6) : auth.phone;
    const dev = auth.devOtp ? `<p class="dev-otp">Test mode — SMS abhi connect nahi hai. Tumhara OTP: <b>${esc(auth.devOtp)}</b></p>` : "";
    const isReset = step === "reset";
    return `<h2 class="modal-title" id="m-title">${isReset ? "Naya password banao" : "OTP daalo"}</h2>
      <p class="modal-sub">6 ank ka OTP ${esc(masked)} par bheja gaya hai. 5 minute me expire hoga.</p>
      <form id="f-otp" data-form="${isReset ? "reset" : "otp"}" class="stack" novalidate>
        ${dev}<p class="form-err" id="fe-f-otp" hidden role="alert"></p>
        ${fld("f-otp-code", "OTP", `<input id="f-otp-code" class="otp-input" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••">`)}
        ${isReset ? fld("f-otp-newPassword", "Naya password (kam se kam 8 akshar)", pwInput("f-otp-newPassword", "new-password")) : ""}
        <button class="btn-save" type="submit">${isReset ? "Password badlo" : "Verify karo"}</button>
        <div class="links-row">
          <button type="button" class="btn-link" id="resend" data-action="resend" disabled>OTP dobara bhejo</button>
          <button type="button" class="btn-link" data-action="auth-step" data-step="${auth.purpose === "reset" ? "forgot" : auth.purpose === "register" ? "register" : "loginotp"}">Number badlo</button>
        </div>
      </form>`;
  }
  return "";
}
function startResend(sec) {
  clearInterval(modalTimer);
  let left = sec;
  const tick = () => {
    const b = $("#resend"); if (!b) return clearInterval(modalTimer);
    if (left <= 0) { b.disabled = false; b.textContent = "OTP dobara bhejo"; clearInterval(modalTimer); }
    else { b.disabled = true; b.textContent = "Dobara bhejo (" + left + " s)"; left--; }
  };
  tick(); modalTimer = setInterval(tick, 1000);
}
async function requestOtp(phone, purpose) {
  const r = await api("POST", "/api/auth/otp/request", { phone, purpose });
  return r.devOtp;
}
function loggedIn(user) {
  state.me = user; renderNav(); closeModal(true);
  toast("Swagat hai, " + user.name.split(" ")[0] + "!");
  const then = auth.then; auth.then = null;
  if (then) { route(); then(); } else go(user.role === "admin" ? "#/admin" : "#/dashboard");
}

/* ================= navigation ================= */
function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
function renderNav() {
  const me = state.me, el = $("#nav-auth");
  el.innerHTML = !me
    ? `<button class="btn btn-ghost btn-sm" type="button" data-action="login">Login</button><button class="btn btn-primary btn-sm" type="button" data-action="register">Register</button>`
    : `<span class="who-chip">${esc(me.name)}</span><a class="btn btn-ghost btn-sm" href="#/${me.role === "admin" ? "admin" : "dashboard"}">${me.role === "admin" ? "Admin" : "Dashboard"}</a><button class="btn-link" type="button" data-action="logout">Logout</button>`;
}
function showView(v) {
  $("#view-home").hidden = v !== "home"; $("#view-dash").hidden = v !== "dash"; $("#view-admin").hidden = v !== "admin";
}
function route() {
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  const seg = parts[0] || "", sub = parts[1] || "";
  if (seg === "dashboard") {
    if (!state.me) { showView("home"); loadHome(); openAuth("login", { then: () => go("#/dashboard") }); return; }
    if (state.me.role === "admin") return go("#/admin");
    showView("dash"); renderDash(sub || "overview"); window.scrollTo(0, 0); return;
  }
  if (seg === "admin") {
    if (!state.me || state.me.role !== "admin") return go("#/");
    showView("admin"); renderAdmin(sub || "overview"); window.scrollTo(0, 0); return;
  }
  showView("home");
  loadHome().then(() => {
    const target = { board: "#sec-board", labour: "#sec-labour", how: "#sec-how" }[seg];
    if (target) $(target).scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    else if (!state.scrolled) window.scrollTo(0, 0);
  });
}

/* ================= home ================= */
const slip = (j, o = {}) => {
  const taken = j.status !== "open";
  const cls = "slip" + (taken ? " taken" : "") + (o.fresh ? " fresh" : "");
  let h = `<article class="${cls}" data-id="${esc(j.id)}" style="--rot:${rotFor(j.id)}deg">`;
  if (taken) h += `<span class="claimed">${j.status === "completed" ? "Pura hua" : "Mil gaya"}</span>`;
  h += `<div class="slip-top"><span class="cat">${esc(catLabel(j.cat))}</span><span class="ago">${esc(fmtAgo(j.createdAt))}</span></div>`;
  h += `<h3>${esc(j.title)}</h3><div class="meta"><span><b>Jagah:</b> ${esc(j.area)}</span>${j.timing ? `<span><b>Kab:</b> ${esc(j.timing)}</span>` : ""}</div>`;
  if (j.note) h += `<p class="note">${esc(j.note)}</p>`;
  h += `<span class="pay">${esc(j.pay)}</span>`;
  if (taken && j.claimantName) h += `<div class="contact">Kaam lene wala: <b>${esc(j.claimantName)}</b></div>`;
  h += `<div class="slip-foot"><span class="giver"><b>${esc(j.ownerName)}${j.ownerVerified ? ' <span class="badge ok">Verified</span>' : ""}</b>${j.ownerPhone ? `<a class="tel" href="${telHref(j.ownerPhone)}">${esc(j.ownerPhone)}</a>` : ""}</span>`;
  if (!o.preview) {
    if (j.mine) h += `<span class="mine-tag">Tumhara kaam</span>`;
    else if (j.claimedByMe) h += `<span class="mine-tag">Tumne uthaya</span>`;
    else if (!taken && !state.me) h += `<button class="btn-take" type="button" data-action="take" data-id="${esc(j.id)}">Login karke lo</button>`;
    else if (!taken && state.me.role === "labour") h += `<button class="btn-take" type="button" data-action="take" data-id="${esc(j.id)}">Main karunga</button>`;
  }
  return h + `</div></article>`;
};

function filteredJobs() {
  const q = state.q.trim().toLowerCase();
  return state.jobs.filter((j) => (state.cat === "all" || j.cat === state.cat) && (!q || [j.title, j.area, j.note, catLabel(j.cat), j.ownerName].join(" ").toLowerCase().includes(q)));
}
function renderBoard(freshId) {
  const list = filteredJobs(), grid = $("#board-grid");
  if (!list.length) {
    grid.innerHTML = `<div class="empty"><p>${state.jobs.length ? "Is filter me koi kaam nahi mila. Doosri kism dekho, ya naya post karo." : "Board abhi khaali hai. Pehla kaam tum post karo."}</p><button class="btn btn-primary btn-sm" type="button" data-action="post">Kaam post karo</button></div>`;
    return;
  }
  grid.innerHTML = list.map((j) => slip(j, { fresh: j.id === freshId })).join("");
}
function renderChips() {
  $("#chips").innerHTML = [["all", "Sab"], ...CATS].map(([k, v]) => `<button class="chip" type="button" data-action="filter" data-cat="${k}" aria-pressed="${state.cat === k}">${v}</button>`).join("");
}
function renderHomeTop() {
  const open = state.jobs.filter((j) => j.status === "open");
  const peek = open.slice(0, 2);
  $("#peek").innerHTML = peek.length ? peek.map((j) => slip(j, { preview: true })).join("")
    : `<div class="slip" style="--rot:-1.2deg"><div class="slip-top"><span class="cat">Board</span><span class="ago">abhi</span></div><h3>Board khaali hai</h3><p class="note">Naya kaam post karo, yahan slip lagegi.</p></div>`;
  const s = state.stats || { open: open.length, placed: 0, labour: 0 };
  $("#live-line").textContent = `Abhi board par ${s.open} kaam khule hain, ${s.labour} labour judey hain.`;
  $("#board-count").textContent = `${s.open} khule · ${s.placed} mil gaye`;
  $("#stats").innerHTML = `<div class="stat"><b>${s.open}</b><span>khule kaam</span></div><div class="stat"><b>${s.labour}</b><span>labour judey hain</span></div><div class="stat"><b>${s.placed}</b><span>kaam mil gaye</span></div>`;
}
function lcard(w) {
  return `<article class="lcard"><h3>${esc(w.name)}${w.verified ? ' <span class="badge ok">Verified</span>' : ""}</h3>
    <div class="sub">${esc(catLabel(w.skill))} · ${esc(w.area)}</div>
    <div class="sub">${w.experience ? esc(w.experience) + " saal ka anubhav" : "Naya"}${w.rate ? " · " + esc(w.rate) : ""}</div>
    <div>${w.ratingCount ? stars(w.rating) + ` <span class="sub">${w.rating} (${w.ratingCount})</span>` : '<span class="sub">Abhi rating nahi</span>'}${w.jobsDone ? ` <span class="sub">· ${w.jobsDone} kaam pure</span>` : ""}</div>
    ${w.bio ? `<p class="bio">${esc(w.bio)}</p>` : ""}
    <div class="lfoot"><button class="reveal" type="button" data-action="reveal" data-id="${esc(w.id)}">Number dekho</button></div></article>`;
}
function renderDirectory() {
  const g = $("#dir-grid");
  g.innerHTML = state.workers.length ? state.workers.map(lcard).join("")
    : `<div class="empty-paper" style="grid-column:1/-1"><p>Is filter me abhi koi labour nahi mila.</p></div>`;
}
async function loadWorkers() {
  const p = new URLSearchParams({ q: state.dq, skill: state.dskill });
  try { state.workers = (await api("GET", "/api/workers?" + p)).workers; renderDirectory(); } catch (e) { toast(e.message); }
}
async function loadHome(quiet) {
  try {
    const [j, s, w] = await Promise.all([api("GET", "/api/jobs"), api("GET", "/api/stats"), api("GET", "/api/workers?" + new URLSearchParams({ q: state.dq, skill: state.dskill }))]);
    state.jobs = j.jobs; state.stats = s; state.workers = w.workers; state.ready = true;
    renderHomeTop(); renderChips(); renderBoard(); renderDirectory();
  } catch (e) {
    if (!quiet || !state.ready) $("#board-grid").innerHTML = `<div class="empty"><p>${esc(e.message)}</p><button class="btn btn-primary btn-sm" type="button" data-action="retry">Dobara koshish karo</button></div>`;
  }
}

/* ================= job modals ================= */
function openPost(job) {
  if (!state.me) return openAuth("register", { role: "employer", then: () => openPost() });
  if (state.me.role !== "employer") return toast("Kaam post karne ke liye ‘kaam dene wala’ account chahiye.");
  const j = job || {};
  openModal(`<h2 class="modal-title" id="m-title">${job ? "Kaam badlo" : "Kaam post karo"}</h2>
    <p class="modal-sub">Jitna saaf likhoge, utni jaldi koi uthayega. Tumhara number slip par nahi dikhega — kaam uthane wale ko hi dikhega.</p>
    <form id="f-job" data-form="job" data-id="${esc(j.id || "")}" novalidate>
      <p class="form-err" id="fe-f-job" hidden role="alert"></p>
      <div class="form-grid">
        ${fld("f-job-title", "Kaam kya hai?", `<input id="f-job-title" type="text" maxlength="90" placeholder="jaise: deewar ki putai, 3 kamre" autocomplete="off" value="${esc(j.title || "")}">`, "full")}
        <div class="field full"><span class="lbl" id="cat-label">Kaam ki kism</span>
          <div class="pills" role="radiogroup" aria-labelledby="cat-label">${CATS.map(([k, v]) => `<label class="pill"><input type="radio" name="cat" value="${k}"${j.cat === k ? " checked" : ""}><span>${v}</span></label>`).join("")}</div>
          <p class="err" id="e-f-job-cat" hidden></p></div>
        ${fld("f-job-area", "Kahan? (mohalla / gali)", `<input id="f-job-area" type="text" maxlength="70" placeholder="jaise: Shivaji Nagar, gali 4" value="${esc(j.area || "")}">`)}
        ${fld("f-job-pay", "Kitna paisa?", `<input id="f-job-pay" type="text" maxlength="40" placeholder="₹700 / din ya ₹8,500 poora" value="${esc(j.pay || "")}">`)}
        ${fld("f-job-timing", 'Kab tak / kab se? <span class="opt">(optional)</span>', `<input id="f-job-timing" type="text" maxlength="50" placeholder="aaj shaam tak" value="${esc(j.timing || "")}">`)}
        ${fld("f-job-note", 'Aur kuch batana hai? <span class="opt">(optional)</span>', `<textarea id="f-job-note" maxlength="240" placeholder="saman, kitne log chahiye, kya dhyan rakhna hai…">${esc(j.note || "")}</textarea>`, "full")}
      </div>
      <div class="modal-actions"><button class="btn-cancel" type="button" data-action="close">Band karo</button><button class="btn-save" type="submit">${job ? "Save karo" : "Board par lagao"}</button></div>
    </form>`);
}
function openClaim(id) {
  const j = state.jobs.find((x) => x.id === id) || state.dashJobs?.find((x) => x.id === id);
  if (!j || j.status !== "open") return toast("Ye kaam ab khula nahi hai.");
  if (!state.me) return openAuth("register", { role: "labour", then: () => state.me.role === "labour" ? openClaim(id) : toast("Kaam uthane ke liye labour account chahiye.") });
  if (state.me.role !== "labour") return toast("Kaam sirf labour account utha sakta hai.");
  openModal(`<h2 class="modal-title" id="m-title">Ye kaam tum karoge?</h2>
    <p class="modal-sub">Confirm karte hi kaam tumhare naam ho jayega aur kaam dene wale ka number tumhe dikhega. Dusre labour ko ye slip nahi dikhegi.</p>
    <div class="job-brief"><h3>${esc(j.title)}</h3><p>${esc(j.area)} · ${esc(j.pay)}${j.timing ? " · " + esc(j.timing) : ""}</p><div class="employer"><span>Kaam dene wala: <b>${esc(j.ownerName)}</b></span></div></div>
    <p class="form-err" id="fe-f-claim" hidden role="alert"></p>
    <form id="f-claim" data-form="claim" data-id="${esc(j.id)}"><div class="modal-actions"><button class="btn-cancel" type="button" data-action="close">Rehne do</button><button class="btn-save" type="submit">Haan, main karunga</button></div></form>`);
}
function openComplete(id) {
  const j = (state.dashJobs || []).find((x) => x.id === id); if (!j) return;
  openModal(`<h2 class="modal-title" id="m-title">Kaam pura hua?</h2>
    <p class="modal-sub">${esc(j.title)} — ${esc(j.claimant ? j.claimant.name : "labour")} ko rating do. Isse achhe labour ko aage kaam milta hai.</p>
    <form id="f-done" data-form="complete" data-id="${esc(j.id)}" class="stack" novalidate>
      <p class="form-err" id="fe-f-done" hidden role="alert"></p>
      <div class="field"><span class="lbl" id="rate-lbl">Rating <span class="opt">(optional)</span></span>
        <div class="rate-row" role="radiogroup" aria-labelledby="rate-lbl">${[1, 2, 3, 4, 5].map((n) => `<label><input type="radio" name="rating" value="${n}"><span aria-hidden="true">★</span><span class="sr" style="position:absolute;left:-999px">${n} star</span></label>`).join("")}</div>
        <p class="err" id="e-f-done-rating" hidden></p></div>
      ${fld("f-done-review", 'Do line likho <span class="opt">(optional)</span>', `<textarea id="f-done-review" maxlength="200" placeholder="kaam kaisa raha?"></textarea>`)}
      <div class="modal-actions"><button class="btn-cancel" type="button" data-action="close">Abhi nahi</button><button class="btn-save" type="submit">Pura mark karo</button></div>
    </form>`);
}
function claimedModal(j) {
  openModal(`<h2 class="modal-title" id="m-title">Kaam tumhara hai!</h2>
    <p class="modal-sub">Ab ${esc(j.ownerName)} ko phone karo aur rate, samay aur pata pakka kar lo.</p>
    <div class="job-brief"><h3>${esc(j.title)}</h3><p>${esc(j.area)} · ${esc(j.pay)}${j.timing ? " · " + esc(j.timing) : ""}</p><div class="employer"><b>${esc(j.ownerName)}</b><a class="tel" href="${telHref(j.ownerPhone)}">${esc(j.ownerPhone)}</a></div></div>
    <div class="modal-actions"><button class="btn-cancel" type="button" data-action="close">Baad me</button><a class="btn-save btn" href="${telHref(j.ownerPhone)}" style="text-decoration:none">Abhi phone karo</a></div>`);
}

/* ================= dashboard ================= */
const jobStatus = (j) => `<span class="status s-${j.status}">${STATUS[j.status]}</span>`;
function profilePct(u) { return Math.round([u.skill, u.area, u.bio, u.experience > 0, u.rate].filter(Boolean).length / 5 * 100); }
function dashTabs(role, cur) {
  const tabs = role === "labour"
    ? [["overview", "Overview"], ["find", "Naye kaam"], ["jobs", "Mere kaam"], ["profile", "Profile"]]
    : [["overview", "Overview"], ["jobs", "Mere post kiye kaam"], ["profile", "Profile"]];
  return `<nav class="tabs" aria-label="Dashboard">${tabs.map(([k, v]) => `<a class="tab" href="#/dashboard/${k}"${k === cur ? ' aria-current="page"' : ""}>${v}</a>`).join("")}</nav>`;
}
function jobRow(j, role) {
  let contact = "";
  if (role === "employer") {
    if (j.claimant) contact = `<p class="jcontact">Labour: <b>${esc(j.claimant.name)}</b> · <a class="tel" href="${telHref(j.claimant.phone)}">${esc(j.claimant.phone)}</a></p>`;
    else if (j.status === "open") contact = `<p class="jcontact">Abhi kisi labour ne nahi uthaya.</p>`;
  } else if (j.ownerPhone && (j.status === "taken" || j.status === "completed")) {
    contact = `<p class="jcontact">Kaam dene wala: <b>${esc(j.ownerName)}</b> · <a class="tel" href="${telHref(j.ownerPhone)}">${esc(j.ownerPhone)}</a></p>`;
  }
  const rating = j.status === "completed" && j.rating ? `<p class="jmeta" style="margin-top:6px">${stars(j.rating)} ${esc(j.review || "")}</p>` : "";
  let acts = "";
  if (role === "employer") {
    if (j.status === "open") acts = `<button class="btn-outline sm" type="button" data-action="edit-job" data-id="${esc(j.id)}">Badlo</button><button class="btn-danger sm" type="button" data-action="cancel-job" data-id="${esc(j.id)}">Band karo</button>`;
    if (j.status === "taken") acts = `<button class="btn-ink sm" type="button" data-action="complete-job" data-id="${esc(j.id)}">Kaam pura hua</button><button class="btn-danger sm" type="button" data-action="cancel-job" data-id="${esc(j.id)}">Band karo</button>`;
  } else if (j.status === "taken" && j.claimedByMe) {
    acts = `<button class="btn-outline sm" type="button" data-action="release-job" data-id="${esc(j.id)}">Chhod do</button>`;
  } else if (j.status === "open") {
    acts = `<button class="btn-ink sm" type="button" data-action="take" data-id="${esc(j.id)}">Main karunga</button>`;
  }
  return `<article class="jrow"><div class="jrow-main"><div class="jrow-top"><span class="cat">${esc(catLabel(j.cat))}</span>${jobStatus(j)}<span class="ago">${esc(fmtAgo(j.createdAt))}</span></div>
    <h3>${esc(j.title)}</h3><p class="jmeta">${esc(j.area)} · ${esc(j.pay)}${j.timing ? " · " + esc(j.timing) : ""}</p>${contact}${rating}</div>
    ${acts ? `<div class="jrow-actions">${acts}</div>` : ""}</article>`;
}
const jobList = (jobs, role, emptyMsg, cta) => jobs.length ? `<div class="jlist">${jobs.map((j) => jobRow(j, role)).join("")}</div>` : `<div class="empty-paper"><p>${emptyMsg}</p>${cta || ""}</div>`;

async function renderDash(tab) {
  const me = state.me, box = $("#view-dash");
  const roleLabel = me.role === "labour" ? "Labour" : "Kaam dene wala";
  const head = `<div class="dash-head"><div><p class="kicker">${roleLabel} dashboard</p><h1>Namaste, ${esc(me.name.split(" ")[0])}</h1></div>
    <div class="meta-line">${me.verified ? '<span class="badge ok">Verified</span>' : '<span class="badge warn">Verification baaki</span>'}${me.role === "employer" ? '<button class="btn btn-primary btn-sm" type="button" data-action="post">+ Naya kaam post karo</button>' : ""}</div></div>`;
  box.innerHTML = head + dashTabs(me.role, tab) + `<div id="dash-body"><div class="loading">Load ho raha hai…</div></div>`;
  const body = $("#dash-body");
  try {
    if (tab === "profile") return (body.innerHTML = profileHTML(me));
    if (me.role === "labour" && tab === "find") {
      const all = (await api("GET", "/api/jobs")).jobs.filter((j) => j.status === "open");
      all.sort((a, b) => (+(b.cat === me.skill) - +(a.cat === me.skill)) || b.createdAt - a.createdAt);
      state.dashJobs = all;
      return (body.innerHTML = `<div class="panel"><div class="panel-head"><div><h2>Naye kaam</h2><p class="sub">Tumhare hunar (${esc(catLabel(me.skill))}) ke kaam sabse upar hain.</p></div></div>${jobList(all, "labour", "Abhi koi khula kaam nahi hai. Thodi der baad dekho.")}</div>`);
    }
    const jobs = (await api("GET", "/api/me/jobs")).jobs;
    state.dashJobs = jobs;
    if (tab === "jobs") {
      const empty = me.role === "employer" ? ["Tumne abhi koi kaam post nahi kiya.", '<button class="btn-ink" type="button" data-action="post">Pehla kaam post karo</button>'] : ["Tumne abhi koi kaam nahi uthaya.", '<a class="btn-ink btn" href="#/dashboard/find" style="text-decoration:none">Naye kaam dekho</a>'];
      return (body.innerHTML = `<div class="panel"><h2>${me.role === "employer" ? "Mere post kiye kaam" : "Mere kaam"}</h2><p class="sub">${me.role === "employer" ? "Labour ne kaam uthaya to uska number yahan dikhega." : "Kaam dene wale ka number kaam uthane ke baad dikhta hai."}</p>${jobList(jobs, me.role, ...empty)}</div>`);
    }
    // overview
    if (me.role === "employer") {
      const c = (s) => jobs.filter((j) => j.status === s).length;
      body.innerHTML = `<div class="tiles"><div class="tile"><b>${jobs.length}</b><span>kul kaam</span></div><div class="tile"><b>${c("open")}</b><span>khule</span></div><div class="tile"><b>${c("taken")}</b><span>chal rahe</span></div><div class="tile"><b>${c("completed")}</b><span>pure hue</span></div></div>
        <div class="panel"><div class="panel-head"><div><h2>Haal ke kaam</h2><p class="sub">Sabse naye 5 kaam.</p></div><a class="btn-outline btn sm" href="#/dashboard/jobs" style="text-decoration:none">Sab dekho</a></div>${jobList(jobs.slice(0, 5), "employer", "Abhi koi kaam nahi. Pehla slip lagao.", '<button class="btn-ink" type="button" data-action="post">Kaam post karo</button>')}</div>
        <div class="panel"><h2>Labour dhoondho</h2><p class="sub">Apne mohalle ke labour ki list dekho, rating padho, aur seedha phone karo.</p><a class="btn-ink btn" href="#/labour" style="text-decoration:none">Labour list kholo</a></div>`;
    } else {
      const active = jobs.filter((j) => j.status === "taken"), pct = profilePct(me);
      body.innerHTML = `<div class="tiles"><div class="tile"><b>${active.length}</b><span>chal rahe kaam</span></div><div class="tile"><b>${me.jobsDone}</b><span>kaam pure hue</span></div><div class="tile"><b>${me.ratingCount ? me.rating : "—"}</b><span>rating${me.ratingCount ? " (" + me.ratingCount + ")" : ""}</span></div><div class="tile"><b>${pct}%</b><span>profile poori</span></div></div>
        <div class="panel"><div class="two-col"><div><h2>Kaam ke liye taiyaar?</h2><p class="sub">Band karoge to labour list me tumhara naam nahi dikhega.</p>
          <label class="switch"><input type="checkbox" id="avail" data-action="toggle-avail"${me.available ? " checked" : ""}> ${me.available ? "Haan, kaam chahiye" : "Abhi kaam nahi chahiye"}</label></div>
          <div><h2>Profile ${pct}% poori</h2><div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div><p class="sub">${pct < 100 ? 'Anubhav, rate aur apne baare me likho — poori profile par zyada log phone karte hain. <a href="#/dashboard/profile" style="color:var(--stamp);font-weight:700">Profile poori karo</a>' : "Badhiya! Tumhari profile poori hai."}</p></div></div></div>
        <div class="panel"><div class="panel-head"><div><h2>Chal rahe kaam</h2></div><a class="btn-outline btn sm" href="#/dashboard/find" style="text-decoration:none">Naye kaam dekho</a></div>${jobList(active, "labour", "Abhi koi kaam nahi chal raha.", '<a class="btn-ink btn" href="#/dashboard/find" style="text-decoration:none">Naye kaam dekho</a>')}</div>`;
    }
  } catch (e) { body.innerHTML = `<div class="panel"><div class="empty-paper"><p>${esc(e.message)}</p><button class="btn-ink" type="button" data-action="retry-dash">Dobara koshish karo</button></div></div>`; }
}
function profileHTML(u) {
  const lab = u.role === "labour";
  return `<div class="panel"><h2>Meri profile</h2><p class="sub">Mobile number: <b>${esc(u.phone)}</b> (badla nahi ja sakta)</p>
    <form id="f-prof" data-form="profile" class="profile-form" novalidate>
      <p class="form-err full" id="fe-f-prof" hidden role="alert"></p>
      ${fld("f-prof-name", "Naam", `<input id="f-prof-name" type="text" maxlength="40" value="${esc(u.name)}">`)}
      ${fld("f-prof-area", "Mohalla / colony", `<input id="f-prof-area" type="text" maxlength="50" value="${esc(u.area)}">`)}
      ${lab ? `${fld("f-prof-skill", "Hunar", `<select id="f-prof-skill">${catOptions(u.skill)}</select>`)}
      ${fld("f-prof-experience", "Anubhav (saal)", `<input id="f-prof-experience" type="number" min="0" max="60" inputmode="numeric" value="${esc(u.experience)}">`)}
      ${fld("f-prof-rate", "Rate", `<input id="f-prof-rate" type="text" maxlength="30" placeholder="₹700 / din" value="${esc(u.rate)}">`)}
      <div class="field"><span class="lbl">Kaam chahiye?</span><label class="switch" style="min-height:44px"><input type="checkbox" id="f-prof-available"${u.available ? " checked" : ""}> Labour list me dikhao</label></div>
      ${fld("f-prof-bio", "Apne baare me", `<textarea id="f-prof-bio" maxlength="200" placeholder="kya kaam aata hai, kitne saal se karte ho…">${esc(u.bio)}</textarea>`, "full")}` : ""}
      <div class="actions"><button class="btn-ink" type="submit">Save karo</button></div>
    </form></div>
    <div class="panel"><h2>Password badlo</h2><p class="sub">Badalne par baaki sab device se logout ho jayega.</p>
    <form id="f-pw" data-form="password" class="profile-form" novalidate>
      <p class="form-err full" id="fe-f-pw" hidden role="alert"></p>
      ${fld("f-pw-oldPassword", "Purana password", pwInput("f-pw-oldPassword", "current-password"))}
      ${fld("f-pw-newPassword", "Naya password", pwInput("f-pw-newPassword", "new-password"))}
      <div class="actions"><button class="btn-ink" type="submit">Password badlo</button><button class="btn-outline btn" type="button" data-action="logout">Logout</button></div>
    </form></div>`;
}

/* ================= admin ================= */
const adm = { uq: "", urole: "all", ustatus: "all", jq: "", jstatus: "all" };
function adminTabs(cur) {
  return `<nav class="tabs" aria-label="Admin">${[["overview", "Overview"], ["users", "Users"], ["jobs", "Kaam"], ["log", "Activity log"]].map(([k, v]) => `<a class="tab" href="#/admin/${k}"${k === cur ? ' aria-current="page"' : ""}>${v}</a>`).join("")}</nav>`;
}
const dShort = (d) => d.slice(8, 10) + "/" + d.slice(5, 7);
function barChart(series, label) {
  const max = Math.max(1, ...series.map((x) => x.count));
  return `<div class="bars" role="img" aria-label="${esc(label)}: ${series.map((x) => dShort(x.day) + " = " + x.count).join(", ")}">${series.map((x) => `<div class="bar"><b>${x.count}</b><i style="height:${Math.max(2, Math.round((x.count / max) * 100))}%"></i><span>${dShort(x.day)}</span></div>`).join("")}</div>`;
}
async function renderAdmin(tab) {
  const box = $("#view-admin");
  box.innerHTML = `<div class="dash-head"><div><p class="kicker">Admin</p><h1>Control room</h1></div></div>${adminTabs(tab)}<div id="admin-body"><div class="loading">Load ho raha hai…</div></div>`;
  const body = $("#admin-body");
  try {
    if (tab === "users") {
      body.innerHTML = `<div class="panel"><h2>Users</h2><p class="sub">Block karne par user turant logout ho jata hai aur login nahi kar sakta.</p>
        <div class="toolbar"><input id="a-uq" type="search" placeholder="Naam, mobile, mohalla" aria-label="User dhoondho" value="${esc(adm.uq)}">
        <select id="a-urole" aria-label="Role">${[["all", "Sab role"], ["labour", "Labour"], ["employer", "Kaam dene wale"]].map(([k, v]) => `<option value="${k}"${adm.urole === k ? " selected" : ""}>${v}</option>`).join("")}</select>
        <select id="a-ustatus" aria-label="Status">${[["all", "Sab status"], ["unverified", "Verification baaki"], ["blocked", "Blocked"], ["pending", "OTP baaki"]].map(([k, v]) => `<option value="${k}"${adm.ustatus === k ? " selected" : ""}>${v}</option>`).join("")}</select></div>
        <div id="admin-table"><div class="loading">Load ho raha hai…</div></div></div>`;
      return loadAdminUsers();
    }
    if (tab === "jobs") {
      body.innerHTML = `<div class="panel"><h2>Kaam</h2><p class="sub">Galat ya spam slip yahan se band ya delete karo.</p>
        <div class="toolbar"><input id="a-jq" type="search" placeholder="Kaam, jagah ya poster" aria-label="Kaam dhoondho" value="${esc(adm.jq)}">
        <select id="a-jstatus" aria-label="Status">${[["all", "Sab status"], ["open", "Khule"], ["taken", "Chal rahe"], ["completed", "Pure hue"], ["cancelled", "Band"]].map(([k, v]) => `<option value="${k}"${adm.jstatus === k ? " selected" : ""}>${v}</option>`).join("")}</select></div>
        <div id="admin-table"><div class="loading">Load ho raha hai…</div></div></div>`;
      return loadAdminJobs();
    }
    if (tab === "log") {
      const log = (await api("GET", "/api/admin/log")).log;
      return (body.innerHTML = `<div class="panel"><h2>Activity log</h2><p class="sub">Admin ne kya kya kiya — aakhri 100.</p>${log.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Samay</th><th>Admin</th><th>Action</th><th>Kis par</th></tr></thead><tbody>${log.map((l) => `<tr><td>${esc(fmtDateTime(l.at))}</td><td>${esc(l.by)}</td><td>${esc(l.action)}</td><td>${esc(l.target)}</td></tr>`).join("")}</tbody></table></div>` : '<div class="empty-paper"><p>Abhi koi activity nahi.</p></div>'}</div>`);
    }
    const s = await api("GET", "/api/admin/stats");
    const maxC = Math.max(1, ...s.categories.map((c) => c.count));
    body.innerHTML = `<div class="tiles"><div class="tile"><b>${s.users.total}</b><span>kul users</span></div><div class="tile"><b>${s.users.labour}</b><span>labour</span></div><div class="tile"><b>${s.users.employer}</b><span>kaam dene wale</span></div><div class="tile"><b>${s.users.unverifiedLabour}</b><span>verification baaki</span></div></div>
      <div class="tiles"><div class="tile"><b>${s.jobs.open}</b><span>khule kaam</span></div><div class="tile"><b>${s.jobs.taken}</b><span>chal rahe</span></div><div class="tile"><b>${s.jobs.completed}</b><span>pure hue</span></div><div class="tile"><b>${s.avgRating == null ? "—" : s.avgRating}</b><span>average rating</span></div></div>
      <div class="two-col"><div class="panel"><h2>Naye users</h2><p class="sub">Pichhle 7 din</p>${barChart(s.signups, "Naye users")}</div><div class="panel"><h2>Naye kaam</h2><p class="sub">Pichhle 7 din</p>${barChart(s.posted, "Naye kaam")}</div></div>
      <div class="two-col"><div class="panel"><h2>Kaam ki kism</h2>${s.categories.length ? s.categories.map((c) => `<div class="hbar"><span>${esc(catLabel(c.cat))}</span><span class="track"><i style="width:${Math.round((c.count / maxC) * 100)}%"></i></span><b>${c.count}</b></div>`).join("") : '<p class="sub">Abhi koi kaam nahi.</p>'}</div>
      <div class="panel"><h2>Dhyan dene wali baatein</h2><p class="sub">${s.users.pending} adhoore signup (OTP baaki) · ${s.users.blocked} blocked users</p>
        ${s.demoCount ? `<p class="sub">Board par ${s.demoCount} demo entries hain (nakli naam aur numbers). Asli launch se pehle inhe hata do.</p><button class="btn-danger btn" type="button" data-action="adm-purge">Demo data hatao</button>` : '<p class="sub">Demo data hat chuka hai.</p>'}</div></div>`;
  } catch (e) { body.innerHTML = `<div class="panel"><div class="empty-paper"><p>${esc(e.message)}</p></div></div>`; }
}
async function loadAdminUsers() {
  const box = $("#admin-table"); if (!box) return;
  try {
    const r = await api("GET", "/api/admin/users?" + new URLSearchParams({ q: adm.uq, role: adm.urole, status: adm.ustatus }));
    if (!r.users.length) return (box.innerHTML = '<div class="empty-paper"><p>Koi user nahi mila.</p></div>');
    box.innerHTML = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Naam</th><th>Mobile</th><th>Role</th><th>Status</th><th>Joined</th><th>Kaam</th><th>Actions</th></tr></thead><tbody>${r.users.map((u) => `<tr>
      <td><span class="name">${esc(u.name)}</span><span class="sub">${esc(u.area || "—")}${u.skill ? " · " + esc(catLabel(u.skill)) : ""}</span></td>
      <td>${esc(u.phone)}</td><td>${u.role === "labour" ? "Labour" : "Kaam dene wala"}</td>
      <td>${u.blocked ? '<span class="badge off">Blocked</span> ' : ""}${u.verified ? '<span class="badge ok">Verified</span> ' : ""}${!u.phoneVerified ? '<span class="badge warn">OTP baaki</span> ' : ""}${u.demo ? '<span class="badge dim">Demo</span>' : ""}</td>
      <td>${esc(fmtDate(u.createdAt))}</td><td>${u.role === "labour" ? u.jobsClaimed + " liye · " + u.jobsDone + " pure" : u.jobsPosted + " post"}</td>
      <td><div class="acts">${u.role === "labour" && u.phoneVerified ? `<button class="btn-outline" type="button" data-action="adm-verify" data-id="${esc(u.id)}" data-val="${!u.verified}">${u.verified ? "Unverify" : "Verify"}</button>` : ""}<button class="btn-outline" type="button" data-action="adm-block" data-id="${esc(u.id)}" data-val="${!u.blocked}">${u.blocked ? "Unblock" : "Block"}</button><button class="btn-danger" type="button" data-action="adm-deluser" data-id="${esc(u.id)}">Delete</button></div></td></tr>`).join("")}</tbody></table></div><p class="hint" style="margin-top:8px">${r.total} me se ${r.users.length} dikh rahe hain.</p>`;
  } catch (e) { box.innerHTML = `<div class="empty-paper"><p>${esc(e.message)}</p></div>`; }
}
async function loadAdminJobs() {
  const box = $("#admin-table"); if (!box) return;
  try {
    const r = await api("GET", "/api/admin/jobs?" + new URLSearchParams({ q: adm.jq, status: adm.jstatus }));
    if (!r.jobs.length) return (box.innerHTML = '<div class="empty-paper"><p>Koi kaam nahi mila.</p></div>');
    box.innerHTML = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Kaam</th><th>Poster</th><th>Labour</th><th>Status</th><th>Posted</th><th>Actions</th></tr></thead><tbody>${r.jobs.map((j) => `<tr>
      <td><span class="name">${esc(j.title)}</span><span class="sub">${esc(catLabel(j.cat))} · ${esc(j.area)} · ${esc(j.pay)}</span></td>
      <td>${esc(j.ownerName)}${j.demo ? ' <span class="badge dim">Demo</span>' : ""}<span class="sub">${esc(j.ownerPhone || "")}</span></td>
      <td>${j.claimant ? esc(j.claimant.name) + `<span class="sub">${esc(j.claimant.phone)}</span>` : "—"}</td>
      <td>${jobStatus(j)}</td><td>${esc(fmtDate(j.createdAt))}</td>
      <td><div class="acts">${j.status === "open" || j.status === "taken" ? `<button class="btn-outline" type="button" data-action="adm-canceljob" data-id="${esc(j.id)}">Band karo</button>` : ""}<button class="btn-danger" type="button" data-action="adm-deljob" data-id="${esc(j.id)}">Delete</button></div></td></tr>`).join("")}</tbody></table></div><p class="hint" style="margin-top:8px">${r.total} me se ${r.jobs.length} dikh rahe hain.</p>`;
  } catch (e) { box.innerHTML = `<div class="empty-paper"><p>${esc(e.message)}</p></div>`; }
}

/* ================= events ================= */
const refreshView = () => { const h = location.hash; if (h.startsWith("#/admin")) return renderAdmin(h.split("/")[2] || "overview"); if (h.startsWith("#/dashboard")) return renderDash(h.split("/")[2] || "overview"); return loadHome(true); };
async function act(btn, fn) {
  busy(btn, true);
  try { await fn(); } catch (e) { toast(e.message); } finally { busy(btn, false); }
}

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-action]"); if (!t) return;
  const a = t.dataset.action, id = t.dataset.id;
  switch (a) {
    case "close": closeModal(); break;
    case "login": openAuth("login"); break;
    case "register": openAuth("register", { role: "employer" }); break;
    case "register-labour": state.me ? toast("Tum pehle se login ho.") : openAuth("register", { role: "labour" }); break;
    case "auth-step": auth.notice = ""; gotoAuth(t.dataset.step); break;
    case "pw-toggle": { const i = t.previousElementSibling; const show = i.type === "password"; i.type = show ? "text" : "password"; t.textContent = show ? "Chhupao" : "Dikhao"; break; }
    case "post": openPost(); break;
    case "take": openClaim(id); break;
    case "retry": loadHome(); break;
    case "retry-dash": refreshView(); break;
    case "filter": state.cat = t.dataset.cat; renderChips(); renderBoard(); break;
    case "logout": act(t, async () => { await api("POST", "/api/auth/logout", {}); state.me = null; renderNav(); closeModal(true); toast("Logout ho gaye."); go("#/"); }); break;
    case "reveal": {
      if (!state.me) return openAuth("login", { then: () => toast("Ab ‘Number dekho’ dabao.") });
      if (state.me.role === "labour") return toast("Labour ke number sirf ‘kaam dene wale’ account ko dikhte hain.");
      act(t, async () => { const r = await api("GET", `/api/workers/${encodeURIComponent(id)}/phone`); const el = document.createElement("a"); el.className = "tel"; el.href = telHref(r.phone); el.textContent = r.phone; t.replaceWith(el); });
      break;
    }
    case "resend": act(t, async () => { auth.devOtp = await requestOtp(auth.phone, auth.purpose); setModalBody(authHTML(auth.purpose === "reset" ? "reset" : "otp")); startResend(30); toast("Naya OTP bheja gaya."); }); break;
    case "edit-job": { const j = state.dashJobs.find((x) => x.id === id); if (j) openPost(j); break; }
    case "cancel-job": if (confirm("Ye kaam band karna hai? Wapas nahi khul payega.")) act(t, async () => { await api("POST", `/api/jobs/${encodeURIComponent(id)}/cancel`, {}); toast("Kaam band ho gaya."); refreshView(); }); break;
    case "complete-job": openComplete(id); break;
    case "release-job": if (confirm("Ye kaam chhod dena hai? Ye dobara board par chala jayega.")) act(t, async () => { await api("POST", `/api/jobs/${encodeURIComponent(id)}/release`, {}); toast("Kaam chhod diya."); refreshView(); }); break;
    case "adm-verify": act(t, async () => { await api("PATCH", `/api/admin/users/${encodeURIComponent(id)}`, { verified: t.dataset.val === "true" }); loadAdminUsers(); }); break;
    case "adm-block": if (t.dataset.val === "false" || confirm("Is user ko block karna hai? Wo turant logout ho jayega.")) act(t, async () => { await api("PATCH", `/api/admin/users/${encodeURIComponent(id)}`, { blocked: t.dataset.val === "true" }); loadAdminUsers(); }); break;
    case "adm-deluser": if (confirm("User hamesha ke liye delete karna hai? Uske khule kaam band ho jayenge.")) act(t, async () => { await api("DELETE", `/api/admin/users/${encodeURIComponent(id)}`); toast("User delete ho gaya."); loadAdminUsers(); }); break;
    case "adm-canceljob": act(t, async () => { await api("PATCH", `/api/admin/jobs/${encodeURIComponent(id)}`, { status: "cancelled" }); loadAdminJobs(); }); break;
    case "adm-deljob": if (confirm("Ye kaam delete karna hai?")) act(t, async () => { await api("DELETE", `/api/admin/jobs/${encodeURIComponent(id)}`); loadAdminJobs(); }); break;
    case "adm-purge": if (confirm("Saare demo users aur demo kaam hamesha ke liye hat jayenge. Pakka?")) act(t, async () => { const r = await api("POST", "/api/admin/purge-demo", {}); toast(r.users + " users aur " + r.jobs + " kaam hataye."); renderAdmin("overview"); }); break;
  }
});
document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.name === "role" && $("#labour-fields")) { $("#labour-fields").hidden = t.value !== "labour"; auth.role = t.value; }
  if (t.dataset && t.dataset.action === "toggle-avail") {
    api("PATCH", "/api/me", { available: t.checked }).then((r) => { state.me = r.user; toast(t.checked ? "Ab tum labour list me dikhoge." : "Ab tum labour list me nahi dikhoge."); renderDash("overview"); }, (err) => { t.checked = !t.checked; toast(err.message); });
  }
  if (t.id === "dir-skill") { state.dskill = t.value; loadWorkers(); }
  if (t.id === "a-urole") { adm.urole = t.value; loadAdminUsers(); }
  if (t.id === "a-ustatus") { adm.ustatus = t.value; loadAdminUsers(); }
  if (t.id === "a-jstatus") { adm.jstatus = t.value; loadAdminJobs(); }
  if (t.closest && t.closest(".rate-row")) $$(".rate-row label").forEach((l) => { const n = +l.querySelector("input").value; l.classList.toggle("on", n <= +t.value); });
});
document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.id === "search") { state.q = t.value; renderBoard(); }
  if (t.id === "dir-q") dirSearch(t.value);
  if (t.id === "a-uq") admUserSearch(t.value);
  if (t.id === "a-jq") admJobSearch(t.value);
  if (t.id === "f-otp-code") t.value = t.value.replace(/\D/g, "").slice(0, 6);
});
const dirSearch = debounce((v) => { state.dq = v; loadWorkers(); }, 300);
const admUserSearch = debounce((v) => { adm.uq = v; loadAdminUsers(); }, 300);
const admJobSearch = debounce((v) => { adm.jq = v; loadAdminJobs(); }, 300);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && modalOpen()) return closeModal();
  if (e.key === "Tab" && modalOpen()) {
    const f = focusables($("#modal-root .modal-panel")); if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});

/* ================= form submits ================= */
document.addEventListener("submit", async (e) => {
  const form = e.target, kind = form.dataset.form; if (!kind) return;
  e.preventDefault();
  const btn = form.querySelector('button[type="submit"]'), fid = form.id;
  clearErrs(fid);
  const bad = (field, msg) => { const el = $(`#e-${fid}-${field}`); if (el) { el.textContent = msg; el.hidden = false; } };
  try {
    if (kind === "login" || kind === "loginotp" || kind === "forgot") {
      const phone = val(fid + "-phone"); auth.phone = phone;
      const pe = phoneError(phone); if (pe) { bad("phone", pe); return $(`#${fid}-phone`).focus(); }
      busy(btn, true);
      if (kind === "login") {
        const pw = $(`#${fid}-password`).value;
        if (!pw) { bad("password", "Password likho."); return $(`#${fid}-password`).focus(); }
        try { loggedIn((await api("POST", "/api/auth/login", { phone, password: pw })).user); }
        catch (err) {
          if (err.data && err.data.needsVerify) { auth.devOtp = await requestOtp(phone, "register"); return gotoAuth("otp", { purpose: "register" }); }
          throw err;
        }
      } else {
        const purpose = kind === "forgot" ? "reset" : "login";
        auth.devOtp = await requestOtp(phone, purpose);
        gotoAuth(purpose === "reset" ? "reset" : "otp", { purpose });
      }
    } else if (kind === "register") {
      const role = ($('input[name="role"]:checked', form) || {}).value || "";
      const body = { role, name: val("f-reg-name"), phone: val("f-reg-phone"), password: $("#f-reg-password").value, skill: val("f-reg-skill"), area: val("f-reg-area") };
      let ok = true;
      if (body.name.length < 2) { bad("name", "Apna poora naam likho."); ok = false; }
      const pe = phoneError(body.phone); if (pe) { bad("phone", pe); ok = false; }
      if (role === "labour") { if (!body.skill) { bad("skill", "Kaam ki kism chuno."); ok = false; } if (!body.area) { bad("area", "Mohalla likho."); ok = false; } }
      if (body.password.length < 8) { bad("password", "Password kam se kam 8 akshar ka rakho."); ok = false; }
      if (!ok) return (($(`#${fid} .err:not([hidden])`) || {}).parentElement || form).querySelector("input,select")?.focus();
      busy(btn, true);
      const r = await api("POST", "/api/auth/register", body);
      auth.phone = body.phone; auth.role = role;
      gotoAuth("otp", { purpose: "register", devOtp: r.devOtp });
    } else if (kind === "otp") {
      const code = val("f-otp-code");
      if (code.length !== 6) { bad("code", "6 ank ka OTP likho."); return $("#f-otp-code").focus(); }
      busy(btn, true);
      loggedIn((await api("POST", "/api/auth/otp/verify", { phone: auth.phone, purpose: auth.purpose, code })).user);
    } else if (kind === "reset") {
      const code = val("f-otp-code"), pw = $("#f-otp-newPassword").value;
      if (code.length !== 6) { bad("code", "6 ank ka OTP likho."); return $("#f-otp-code").focus(); }
      if (pw.length < 8) { bad("newPassword", "Password kam se kam 8 akshar ka rakho."); return $("#f-otp-newPassword").focus(); }
      busy(btn, true);
      await api("POST", "/api/auth/reset", { phone: auth.phone, code, newPassword: pw });
      auth.notice = "Password badal gaya. Ab naye password se login karo."; auth.devOtp = undefined;
      gotoAuth("login");
    } else if (kind === "job") {
      const cat = ($('input[name="cat"]:checked', form) || {}).value || "";
      const body = { title: val("f-job-title"), cat, area: val("f-job-area"), pay: val("f-job-pay"), timing: val("f-job-timing"), note: val("f-job-note") };
      let ok = true;
      if (body.title.length < 4) { bad("title", "Kam se kam chaar akshar likho — jaise “putai, 2 kamre”."); ok = false; }
      if (!cat) { bad("cat", "Kaam ki kism chuno."); ok = false; }
      if (!body.area) { bad("area", "Jagah likho — mohalla ya gali."); ok = false; }
      if (!body.pay) { bad("pay", "Paisa likho (ya “baat karke” likh do)."); ok = false; }
      if (!ok) { const f = $(`#${fid} .err:not([hidden])`); const i = f && f.parentElement.querySelector("input"); if (i) i.focus(); return; }
      busy(btn, true);
      const editId = form.dataset.id;
      const r = editId ? await api("PATCH", `/api/jobs/${encodeURIComponent(editId)}`, body) : await api("POST", "/api/jobs", body);
      closeModal(true); toast(editId ? "Kaam badal diya." : "Slip board par lag gayi.");
      if (location.hash.startsWith("#/dashboard")) refreshView();
      else { state.cat = "all"; state.q = ""; $("#search").value = ""; await loadHome(true); renderBoard(r.job.id); const el = $(`#board-grid .slip[data-id="${r.job.id}"]`); if (el) { el.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" }); el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 1600); } }
    } else if (kind === "claim") {
      busy(btn, true);
      const r = await api("POST", `/api/jobs/${encodeURIComponent(form.dataset.id)}/claim`, {});
      closeModal(true); claimedModal(r.job); refreshView();
    } else if (kind === "complete") {
      const rating = ($('input[name="rating"]:checked', form) || {}).value;
      busy(btn, true);
      await api("POST", `/api/jobs/${encodeURIComponent(form.dataset.id)}/complete`, { rating: rating ? +rating : undefined, review: val("f-done-review") });
      closeModal(true); toast("Kaam pura mark ho gaya. Shukriya!"); refreshView();
    } else if (kind === "profile") {
      const body = { name: val("f-prof-name"), area: val("f-prof-area") };
      if (state.me.role === "labour") Object.assign(body, { skill: val("f-prof-skill"), experience: val("f-prof-experience") || 0, rate: val("f-prof-rate"), bio: val("f-prof-bio"), available: $("#f-prof-available").checked });
      busy(btn, true);
      state.me = (await api("PATCH", "/api/me", body)).user; renderNav(); toast("Profile save ho gayi."); renderDash("profile");
    } else if (kind === "password") {
      const o = $("#f-pw-oldPassword").value, n = $("#f-pw-newPassword").value;
      if (!o) { bad("oldPassword", "Purana password likho."); return; }
      if (n.length < 8) { bad("newPassword", "Password kam se kam 8 akshar ka rakho."); return; }
      busy(btn, true);
      await api("POST", "/api/me/password", { oldPassword: o, newPassword: n });
      form.reset(); toast("Password badal gaya.");
    }
  } catch (err) {
    const map = { code: "code" };
    showErrs(fid, err.fields, err.message, map);
  } finally { busy(btn, false); }
});

/* ================= boot ================= */
window.addEventListener("hashchange", () => { state.scrolled = false; route(); });
setInterval(() => { if (!document.hidden && !modalOpen() && !location.hash.startsWith("#/admin") && !location.hash.startsWith("#/dashboard")) loadHome(true); }, 45000);

(async function boot() {
  try {
    const [me, cfg] = await Promise.all([api("GET", "/api/auth/me"), api("GET", "/api/config")]);
    state.me = me.user; state.cfg = cfg;
  } catch {}
  $("#dir-skill").innerHTML = `<option value="all">Sab hunar</option>` + CATS.map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
  renderNav(); renderChips();
  route();
})();
})();

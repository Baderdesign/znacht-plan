// Znacht-Plan — gemeinsamer Wochenplan. Daten liegen als ein JSON-Dokument pro Haushalt in Supabase.
const SUPABASE_URL = "https://qpmnraeacexzjnnlvqhw.supabase.co";
const SUPABASE_KEY = "sb_publishable_BvKAH1kJTAZJSiwyIXAeJQ_YJ6_KATy";
const PUSH_ENABLED = false; // Mitteilungen später einschalten: auf true setzen (Supabase-Teil muss eingerichtet sein)
const VAPID_PUBLIC = "BIjizNMnsQn1so3r04bW1-IB0HEgyZnZa_R6AKm6bwMgVowRgJGIWgIlKOvVnhM6SE77LpBBHLj-4ZQWRBPkNWA";

const DAYS = ["Montag","Dienstag","Mittwoch","Donnerstag","Freitag","Samstag","Sonntag"];
const SHORT = ["Mo","Di","Mi","Do","Fr","Sa","So"];
const $ = id => document.getElementById(id);
const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

let code = null;
let S = { meals: [], plan: {}, shop: {} };   // was angezeigt wird = base + noch nicht übertragene Änderungen
let base = { meals: [], plan: {}, shop: {} };   // zuletzt vom Server bestätigter Stand
let queue = [];                                 // Änderungen, die noch übertragen werden müssen (überlebt Offline und Neustart)
let version = 0;
let lastSync = null;
let busy = false;

/* ---------- Kategorien & Abteilungen ---------- */
const TAGS = ["Vegi", "Fleisch", "Fisch", "Schnell", "Ofen", "Gäste"];
// Reihenfolge wie beim Gang durch einen typischen Laden
const AISLES = [
  ["Gemüse & Früchte", "salat rüebli karotte zwiebel knoblauch tomate kartoffel gschwellti peperoni zucchetti zucchini aubergine gurke lauch kürbis pastinake rosenkohl broccoli brokkoli blumenkohl spinat sellerie fenchel kohl champignon pilz apfel äpfel birne banane zitrone limette orange beeren ingwer kräuter petersilie basilikum schnittlauch koriander avocado mais erbsen randen radiesli"],
  ["Brot & Backwaren", "brot zopf gipfeli toast brötchen weggli tortilla wrap fladenbrot pita"],
  ["Fleisch & Fisch", "fleisch hack poulet huhn hähnchen chicken rind kalb schwein speck schinken wurst cervelat salami lachs fisch thon thunfisch crevetten geschnetzelt hackfleisch"],
  ["Milch, Käse & Eier", "milch rahm butter käse mozzarella parmesan gruyère emmentaler bergkäse raclette joghurt jogurt quark mascarpone ricotta feta ei eier crème fraiche sauerrahm halbrahm"],
  ["Teigwaren, Reis & Vorrat", "hörnli spaghetti penne nudel teigwaren pasta lasagne spätzli reis risotto couscous bulgur quinoa linsen bohnen kichererbsen mehl zucker hefe griess haferflocken teig kuchenteig blätterteig dose konserve passata tomatensauce kokosmilch"],
  ["Gewürze, Saucen & Öl", "salz pfeffer öl essig senf ketchup mayo bouillon brühe curry paprika zimt muskat sojasauce honig gewürz paste sauce"],
  ["Tiefkühl", "tiefkühl tk glace fischstäbli pommes"],
  ["Getränke", "wasser saft wein bier cola kaffee tee"],
  ["Haushalt", "abwaschmittel waschmittel toilettenpapier papier haushaltpapier alufolie backpapier schwamm"],
  ["Sonstiges", ""]
];
function guessAisle(text) {
  const t = (text || "").toLowerCase();
  for (const [name, words] of AISLES) if (words && words.split(" ").some(w => w && t.includes(w))) return name;
  return "Sonstiges";
}
function aisleOf(item) { return item.aisle || guessAisle(item.text); }
function aisleIndex(name) { const i = AISLES.findIndex(a => a[0] === name); return i < 0 ? AISLES.length : i; }

/* ---------- small helpers ---------- */
function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
function newCode() { const a = new Uint32Array(20); crypto.getRandomValues(a); let s = ""; a.forEach((n, i) => { s += ALPHA[n % ALPHA.length]; if (i % 4 === 3 && i < 19) s += "-"; }); return s; }
function normCode(s) { const c = (s || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); if (c.length < 20) return null; return c.match(/.{1,4}/g).join("-"); }
function monday(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
function key(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function isoWeek(d) { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7) + 3); const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 4)); return 1 + Math.round(((t - y) / 864e5 - 3 + ((y.getUTCDay() + 6) % 7)) / 7); }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function fmt(d) { return d.getDate() + "." + (d.getMonth() + 1) + "."; }
const today = new Date();
let wk = monday(today); if (today.getDay() === 0) wk.setDate(wk.getDate() + 7); // Sonntags: nächste Woche planen
const W = () => key(wk);

function cleanUrl(u) { u = (u || "").trim(); if (!u) return ""; if (!/^https?:\/\//i.test(u)) u = "https://" + u; try { const x = new URL(u); return x.protocol.startsWith("http") ? x.href : ""; } catch (e) { return ""; } }
function host(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return "Rezept"; } }
function bringLink(u) { return "https://api.getbring.com/rest/bringrecipes/deeplink?url=" + encodeURIComponent(u) + "&source=web"; }
function linkEl(href, text, cls) { const a = document.createElement("a"); a.href = href; a.target = "_blank"; a.rel = "noopener"; a.className = "lnk" + (cls ? " " + cls : ""); a.textContent = text; return a; }
function recipeLinks(u) { const w = document.createElement("div"); w.className = "links"; w.append(linkEl(u, "Rezept · " + host(u) + " ↗"), linkEl(bringLink(u), "Zutaten in Bring ↗", "br")); return w; }
function mealByName(n) { return S.meals.find(m => m.name === n); }
function urlFor(p) { return p.url || (mealByName(p.meal) || {}).url || ""; }
function weekPlan() { return S.plan[W()] || {}; }
function weekShop() { return S.shop[W()] || []; }

function toast(t) { const el = $("toast"); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, 2600); }
function status(t) { const el = $("status"); el.textContent = t || ""; el.hidden = !t; }

/* ---------- server ---------- */
async function rpc(fn, body) {
  // Nie länger als 8 Sekunden warten, sonst hängt die App bei schlechtem Empfang.
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 8000);
  const r = await fetch(SUPABASE_URL + "/rest/v1/rpc/" + fn, {
    method: "POST", signal: ctl.signal,
    headers: { "apikey": SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  clearTimeout(tm);
  const txt = await r.text();
  let j = null; try { j = txt ? JSON.parse(txt) : null; } catch (e) {}
  if (!r.ok) { const e = new Error((j && j.message) || ("HTTP " + r.status)); e.conflict = !!(j && j.message === "conflict"); throw e; }
  return j;
}
function normalize(d) { d = d || {}; return { meals: Array.isArray(d.meals) ? d.meals : [], plan: d.plan && typeof d.plan === "object" ? d.plan : {}, shop: d.shop && typeof d.shop === "object" ? d.shop : {} }; }
function clone(x) { return JSON.parse(JSON.stringify(x)); }
function persist() { ls("znacht.cache", JSON.stringify({ code, version, base, queue })); }

// Jede Änderung ist ein kleines Datenpaket. So kann sie offline gespeichert
// und später auf den neuesten Stand vom Server nochmal angewendet werden.
function applyOp(st, op) {
  const P = w => (st.plan[w] = st.plan[w] || {});
  const L = w => (st.shop[w] = st.shop[w] || []);
  const sameName = n => st.meals.some(m => m.name.toLowerCase() === n.toLowerCase());
  switch (op.t) {
    case "seed": if (!st.meals.length) st.meals = op.meals; break;
    case "day": {
      const p = P(op.w); if (op.body) p[op.i] = op.body; else delete p[op.i];
      if (op.newMeal && !sameName(op.newMeal.name)) st.meals.push(op.newMeal);
      break;
    }
    case "swap": { const p = P(op.w), a = p[op.a], b = p[op.b]; if (b) p[op.a] = b; else delete p[op.a]; if (a) p[op.b] = a; else delete p[op.b]; break; }
    case "fill": { const p = P(op.w); Object.entries(op.days).forEach(([i, body]) => { if (!(p[i] && p[i].meal)) p[i] = body; }); break; }
    case "mealAdd": if (!sameName(op.meal.name)) st.meals.push(op.meal); break;
    case "mealDel": st.meals = st.meals.filter(m => m.id !== op.id); break;
    case "mealEdit": {
      const x = st.meals.find(m => m.id === op.id); if (!x) break;
      const old = x.name; Object.assign(x, op.data);
      if (old !== x.name) Object.values(st.plan).forEach(wp => Object.values(wp).forEach(p => { if (p.meal === old) p.meal = x.name; }));
      break;
    }
    case "shopAdd": { const l = L(op.w); op.items.forEach(it => { if (!l.some(y => y.id === it.id || y.text.toLowerCase() === it.text.toLowerCase())) l.push(it); }); break; }
    case "shopToggle": { const it = L(op.w).find(y => y.id === op.id); if (it) it.done = op.done; break; }
    case "shopDel": st.shop[op.w] = L(op.w).filter(y => y.id !== op.id); break;
    case "shopAisle": { const it = L(op.w).find(y => y.id === op.id); if (it) it.aisle = op.aisle; break; }
    case "shopClear": st.shop[op.w] = L(op.w).filter(y => !y.done); break;
  }
  return st;
}
function applyAll(b, q) { const st = clone(b); q.forEach(x => applyOp(st, x.op)); return st; }

async function load(quiet) {
  if (!code) return;
  try {
    const res = await rpc("znacht_load", { p_code: code });
    if (res && typeof res.version === "number") {
      if (res.version !== version) { base = normalize(res.data); version = res.version; S = applyAll(base, queue); persist(); renderAll(); }
    } else if (version === 0 && !base.meals.length && !queue.some(x => x.op.t === "seed")) {
      // Neuer Haushalt: mit ein paar Ideen starten
      mutate({ t: "seed", meals: STARTER.map(m => ({ id: uid(), ...m })) });
    }
    lastSync = new Date(); renderSync();
    if (queue.length) await flush(); else status("");
  } catch (e) {
    console.warn(e); showPending(true);
  }
}

function showPending(offline) {
  if (queue.length) status((offline || navigator.onLine === false ? "Offline. " : "") + (queue.length === 1 ? "1 Änderung ist auf dem Handy gespeichert und wird" : queue.length + " Änderungen sind auf dem Handy gespeichert und werden") + " übertragen, sobald Internet da ist.");
  else if (offline || navigator.onLine === false) status("Offline. Ihr könnt trotzdem planen. Änderungen werden übertragen, sobald Internet da ist.");
  else status("");
}

// Änderung sofort anzeigen und auf dem Gerät merken, dann übertragen.
function mutate(op, desc) {
  queue.push({ op, desc: desc || "" });
  S = applyAll(base, queue); persist(); renderAll();
  flush();
  return true;
}

// Alle wartenden Änderungen übertragen. Hat der andere inzwischen gespeichert:
// neuesten Stand holen, unsere Änderungen darauf anwenden, nochmal speichern.
let flushing = false;
async function flush() {
  if (flushing || !code || !queue.length) { showPending(); return; }
  flushing = true;
  try {
    for (let attempt = 0; attempt < 6 && queue.length; attempt++) {
      const n = queue.length, draft = applyAll(base, queue.slice(0, n));
      try {
        const v = await rpc("znacht_save", { p_code: code, p_data: draft, p_version: version });
        const sent = queue.splice(0, n);
        base = draft; version = v; lastSync = new Date();
        S = applyAll(base, queue); persist(); renderAll(); renderSync();
        notifyOthers(sent.map(x => x.desc).filter(Boolean));
        attempt = -1;
      } catch (e) {
        if (!e.conflict) throw e;
        const res = await rpc("znacht_load", { p_code: code });
        base = normalize(res && res.data); version = res ? res.version : 0;
        S = applyAll(base, queue); persist(); renderAll();
      }
    }
  } catch (e) { console.warn(e); flushing = false; showPending(true); return; }
  flushing = false; showPending();
}

/* ---------- Push-Mitteilungen ---------- */
function deviceId() { let d = ls("znacht.device"); if (!d) { d = uid(); ls("znacht.device", d); } return d; }
let notifyBuf = [], notifyTimer = null;
function notifyOthers(descs) {
  if (!descs.length) return;
  notifyBuf.push(...descs); clearTimeout(notifyTimer);
  notifyTimer = setTimeout(sendNotify, 4000); // mehrere Änderungen kurz nacheinander = eine Mitteilung
}
function sendNotify() {
  clearTimeout(notifyTimer); if (!PUSH_ENABLED) { notifyBuf = []; return; } if (!notifyBuf.length || !code) return;
  const items = notifyBuf.splice(0), who = (ls("znacht.name") || "").trim();
  const body = items.slice(0, 4).join(" · ") + (items.length > 4 ? " · und " + (items.length - 4) + " mehr" : "");
  fetch(SUPABASE_URL + "/functions/v1/znacht-notify", {
    method: "POST", keepalive: true,
    headers: { "apikey": SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ code, device: deviceId(), title: (who ? who + " hat" : "Jemand hat") + " den Plan geändert", body })
  }).catch(() => {});
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") sendNotify(); });
function b64u(s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); const r = atob(s + "===".slice((s.length + 3) % 4)); return Uint8Array.from(r, c => c.charCodeAt(0)); }
function pushState(t) { $("pushstate").textContent = t; }
function renderPush() {
  $("pushbox").hidden = !PUSH_ENABLED; if (!PUSH_ENABLED) return;
  $("pushname").value = ls("znacht.name") || "";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    const ios = /iPhone|iPad/.test(navigator.userAgent);
    pushState(ios ? "Auf dem iPhone gehen Mitteilungen nur, wenn du die App vom Home-Bildschirm aus öffnest." : "Dieser Browser kann keine Mitteilungen anzeigen.");
    $("pushon").disabled = true; return;
  }
  $("pushon").disabled = false;
  if (Notification.permission === "denied") pushState("Mitteilungen sind in den Einstellungen des Handys blockiert.");
  else if (ls("znacht.push") === "on" && Notification.permission === "granted") { pushState("Mitteilungen sind an."); $("pushon").textContent = "Name speichern"; }
  else pushState("");
}
$("pushon").onclick = async () => {
  const name = $("pushname").value.trim(); if (!name) { $("pushname").focus(); toast("Gib zuerst deinen Namen ein."); return; }
  ls("znacht.name", name);
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { renderPush(); toast("Mitteilungen wurden nicht erlaubt."); return; }
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(VAPID_PUBLIC) }));
    await rpc("znacht_push_register", { p_code: code, p_device: deviceId(), p_sub: sub.toJSON() });
    ls("znacht.push", "on"); renderPush(); toast("Mitteilungen sind an");
  } catch (e) { console.warn(e); pushState("Hat nicht geklappt. Prüft das Internet und versucht es nochmal."); }
};

const STARTER = [
  { name: "Älplermagronen", url: "", ingredients: "Hörnli, Kartoffeln, Bergkäse, Rahm, Zwiebeln, Apfelmus", steps: "" },
  { name: "Spaghetti Bolognese", url: "", ingredients: "Spaghetti, Hackfleisch, Tomaten, Zwiebeln, Rüebli", steps: "" },
  { name: "Rösti mit Spiegelei", url: "", ingredients: "Kartoffeln, Eier, Butter", steps: "" },
  { name: "Gemüsecurry mit Reis", url: "", ingredients: "Reis, Kokosmilch, Currypaste, Peperoni, Zucchetti", steps: "" },
  { name: "Wähe mit Salat", url: "", ingredients: "Kuchenteig, Lauch, Speck, Eier, Milch, Salat", steps: "" }
];

/* ---------- render ---------- */
function renderSync() {
  $("sync").textContent = lastSync ? "Stand " + lastSync.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" }) : "";
}
function renderWeek() {
  const end = addDays(wk, 6), lb = $("weeklbl"); lb.textContent = "";
  const b = document.createElement("span"); b.textContent = "KW " + isoWeek(wk);
  const s = document.createElement("small"); s.textContent = fmt(wk) + " – " + fmt(end) + end.getFullYear();
  lb.append(b, s);
  $("shoph").textContent = "Einkaufsliste KW " + isoWeek(wk);
  const plan = weekPlan(), ul = $("days"); ul.textContent = ""; let planned = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(wk, i), p = plan[i] || {}; if (p.meal) planned++;
    const li = document.createElement("li"); li.className = "dayrow" + (key(d) === key(today) ? " today" : "");
    const bt = document.createElement("button"); bt.className = "day"; bt.setAttribute("aria-label", DAYS[i] + " bearbeiten");
    const dn = document.createElement("div"); dn.className = "dname"; dn.textContent = SHORT[i];
    const sm = document.createElement("small"); sm.textContent = fmt(d); dn.append(sm);
    const m = document.createElement("div"); m.className = "meal" + (p.meal ? "" : " empty"); m.textContent = p.meal || "+ Gericht wählen";
    if (p.note) { const n = document.createElement("span"); n.className = "n"; n.textContent = p.note; m.append(n); }
    const ch = document.createElement("span"); ch.className = "note chev"; ch.textContent = "›";
    bt.append(dn, m, ch); bt.onclick = () => { if (swapFrom !== null) { if (swapFrom !== i) swapDays(swapFrom, i); else cancelSwap(); } else openSheet(i); };
    li.dataset.day = i; if (swapFrom === i) li.classList.add("pick");
    const g = document.createElement("button"); g.className = "grip"; g.textContent = "⇅"; g.setAttribute("aria-label", DAYS[i] + " mit anderem Tag tauschen");
    attachGrip(g, i); li.append(bt, g);
    if (p.meal) {
      const u = urlFor(p), mm = mealByName(p.meal);
      if (u || mm) {
        const w = u ? recipeLinks(u) : Object.assign(document.createElement("div"), { className: "links" });
        if (mm) { const v = document.createElement("button"); v.className = "lnk v"; v.textContent = "Ansehen"; v.onclick = () => openRecipe(mm.id); w.prepend(v); }
        li.append(w);
      }
    }
    ul.append(li);
  }
  ul.classList.toggle("swapping", swapFrom !== null);
  $("swapbar").hidden = swapFrom === null;
  if (swapFrom !== null) $("swaptext").textContent = DAYS[swapFrom] + ": Mit welchem Tag tauschen?";
  $("fair").textContent = planned + " von 7 Tagen geplant";
  renderBring();
}
let ideasFilter = "", dayFilter = "", addTags = [], editTags = [];
function drawFilters(boxId, current, set) {
  const box = $(boxId); box.textContent = "";
  ["", ...TAGS].forEach(t => {
    const b = document.createElement("button"); b.textContent = t || "Alle";
    b.setAttribute("aria-pressed", String(current === t)); b.onclick = () => set(t);
    box.append(b);
  });
}
function drawTagPick(boxId, arr) {
  const box = $(boxId); box.textContent = "";
  TAGS.forEach(t => {
    const b = document.createElement("button"); b.textContent = t; b.type = "button";
    b.setAttribute("aria-pressed", String(arr.includes(t)));
    b.onclick = () => { const i = arr.indexOf(t); if (i < 0) arr.push(t); else arr.splice(i, 1); drawTagPick(boxId, arr); };
    box.append(b);
  });
}
function tagsEl(m) { const w = document.createElement("div"); w.className = "tags"; (m.tags || []).forEach(t => { const s = document.createElement("span"); s.className = "tag"; s.textContent = t; w.append(s); }); return w; }
function hasTag(m, t) { return !t || (m.tags || []).includes(t); }
function renderMeals() {
  const ul = $("meals"); ul.textContent = "";
  const q = $("mealsearch").value.trim().toLowerCase();
  drawFilters("mealfilter", ideasFilter, t => { ideasFilter = t; renderMeals(); });
  drawTagPick("mealtags", addTags);
  const list = S.meals.filter(m => hasTag(m, ideasFilter) && (!q || m.name.toLowerCase().includes(q) || (m.ingredients || "").toLowerCase().includes(q)));
  $("mealcount").textContent = (q || ideasFilter) ? list.length + " von " + S.meals.length : S.meals.length + " Gerichte";
  if (!S.meals.length) { const e = document.createElement("li"); e.className = "empty-state"; e.textContent = "Noch keine Gerichte. Fügt oben euer erstes hinzu."; ul.append(e); return; }
  if (!list.length) { const e = document.createElement("li"); e.className = "empty-state"; e.textContent = q ? "Nichts gefunden für «" + $("mealsearch").value.trim() + "»." : "Noch kein Gericht mit «" + ideasFilter + "». Unter «Ändern» könnt ihr Kategorien setzen."; ul.append(e); fitMealBox(); return; }
  list.sort((a, b) => a.name.localeCompare(b.name, "de")).forEach(m => {
    const li = document.createElement("li");
    const t = document.createElement("div"); t.className = "t";
    const nb = document.createElement("button"); nb.className = "mealbtn"; nb.textContent = m.name; nb.onclick = () => openRecipe(m.id); t.append(nb);
    if (m.ingredients) { const s = document.createElement("small"); s.textContent = m.ingredients; t.append(s); }
    if (m.url) { const s = document.createElement("small"); s.textContent = "Rezept: " + host(m.url); t.append(s); }
    if ((m.tags || []).length) t.append(tagsEl(m));
    const acts = document.createElement("div"); acts.className = "acts";
    const vb = document.createElement("button"); vb.className = "btn sm"; vb.textContent = "Ansehen"; vb.onclick = () => openRecipe(m.id);
    const eb = document.createElement("button"); eb.className = "btn sm primary"; eb.textContent = "Ändern"; eb.onclick = () => { rId = m.id; $("rscrim").hidden = false; startEdit(); };
    acts.append(vb, eb); li.append(t, acts); ul.append(li);
  });
  fitMealBox();
}
// Liste zeigt 7 Gerichte, der Rest scrollt in sich.
function fitMealBox() {
  const box = $("mealbox"), rows = [...$("meals").children];
  if (!box.offsetParent) return; // Tab nicht sichtbar: beim Öffnen messen
  box.style.maxHeight = "";
  if (rows.length > 7) { const top = rows[0].offsetTop, h = rows[7].offsetTop - top; box.style.maxHeight = (h + 6) + "px"; box.classList.add("more"); }
  else box.classList.remove("more");
}
window.addEventListener("resize", fitMealBox);
function renderShop() {
  const ul = $("shop"); ul.textContent = ""; const list = weekShop();
  if (!list.length) { const e = document.createElement("li"); e.className = "empty-state"; e.textContent = "Leer. Tippt auf «Zutaten aus dem Plan holen» oder schreibt selbst etwas."; ul.append(e); return; }
  const open = list.filter(s => !s.done), done = list.filter(s => s.done);
  const groups = {};
  open.forEach(s => { (groups[aisleOf(s)] = groups[aisleOf(s)] || []).push(s); });
  Object.keys(groups).sort((a, b) => aisleIndex(a) - aisleIndex(b)).forEach(g => {
    const h = document.createElement("li"); h.className = "aisle"; h.textContent = g; ul.append(h);
    groups[g].sort((a, b) => (a.created || 0) - (b.created || 0)).forEach(s => ul.append(shopRow(s)));
  });
  if (done.length) { const h = document.createElement("li"); h.className = "aisle"; h.textContent = "Erledigt"; ul.append(h); done.forEach(s => ul.append(shopRow(s))); }
}
function shopRow(s) {
  const li = document.createElement("li"); if (s.done) li.className = "done";
  const cb = document.createElement("input"); cb.type = "checkbox"; cb.id = "s-" + s.id; cb.checked = !!s.done;
  cb.onchange = () => mutate({ t: "shopToggle", w: W(), id: s.id, done: cb.checked });
  const t = document.createElement("label"); t.className = "t"; t.htmlFor = cb.id; t.textContent = s.text;
  const sel = document.createElement("select"); sel.className = "aislesel"; sel.setAttribute("aria-label", "Abteilung für " + s.text);
  AISLES.forEach(([n]) => { const o = document.createElement("option"); o.value = n; o.textContent = n; sel.append(o); });
  sel.value = aisleOf(s); sel.onchange = () => mutate({ t: "shopAisle", w: W(), id: s.id, aisle: sel.value });
  const x = document.createElement("button"); x.className = "x"; x.textContent = "✕"; x.setAttribute("aria-label", s.text + " entfernen");
  x.onclick = () => mutate({ t: "shopDel", w: W(), id: s.id });
  const sw = document.createElement("span"); sw.className = "aislewrap"; sw.title = "Abteilung ändern"; sw.textContent = "⇵"; sw.append(sel);
  li.append(cb, t); if (!s.done) li.append(sw); li.append(x);
  return li;
}
function renderBring() {
  const ul = $("bringrecipes"); ul.textContent = ""; const plan = weekPlan(); const rows = [];
  for (let i = 0; i < 7; i++) { const p = plan[i]; if (p && p.meal) { const u = urlFor(p); if (u) rows.push([i, p.meal, u]); } }
  if (!rows.length) { const e = document.createElement("li"); e.className = "empty-state"; e.textContent = "Diese Woche hat noch kein Gericht einen Rezept-Link."; ul.append(e); return; }
  rows.forEach(([i, name, u]) => { const li = document.createElement("li"); const t = document.createElement("div"); t.className = "t"; t.textContent = SHORT[i] + " · " + name; li.append(t, linkEl(bringLink(u), "In Bring ↗", "br")); ul.append(li); });
}
function renderInvite() {
  $("codeshow").textContent = code || "";
  $("invitelink").value = code ? location.origin + location.pathname + "#" + code : "";
}
function renderAll() {
  if (dragging) return;
  renderWeek(); renderMeals(); renderShop(); renderInvite();
  if (!$("rscrim").hidden && $("r-form").hidden) showRecipeView();
  if (!$("scrim").hidden) drawSugg();
}

/* ---------- Tage tauschen ---------- */
let swapFrom = null, dragging = false;
function cancelSwap() { swapFrom = null; renderWeek(); }
$("swapcancel").onclick = cancelSwap;
async function swapDays(a, b) {
  swapFrom = null;
  const ok = mutate({ t: "swap", w: W(), a, b }, DAYS[a] + " ⇄ " + DAYS[b]);
  renderWeek();
  if (ok) toast(DAYS[a] + " ⇄ " + DAYS[b] + " getauscht");
}
function rowAt(x, y) { const el = document.elementFromPoint(x, y); const r = el && el.closest(".dayrow"); return r ? +r.dataset.day : null; }
function attachGrip(g, i) {
  let sx = 0, sy = 0, moved = false, target = null, pid = null;
  const mark = t => { document.querySelectorAll(".dayrow.target").forEach(r => r.classList.remove("target")); if (t !== null && t !== i) { const r = document.querySelector('.dayrow[data-day="' + t + '"]'); if (r) r.classList.add("target"); } };
  g.addEventListener("pointerdown", e => { pid = e.pointerId; sx = e.clientX; sy = e.clientY; moved = false; target = null; try { g.setPointerCapture(pid); } catch (_) {} });
  g.addEventListener("pointermove", e => {
    if (pid !== e.pointerId) return;
    if (!moved && Math.hypot(e.clientX - sx, e.clientY - sy) > 8) { moved = true; dragging = true; swapFrom = i; renderWeekKeepGrip(); }
    if (moved) { e.preventDefault(); target = rowAt(e.clientX, e.clientY); mark(target); }
  });
  const end = e => {
    if (pid !== e.pointerId) return; pid = null;
    if (moved) { dragging = false; mark(null); if (target !== null && target !== i) swapDays(i, target); else cancelSwap(); }
    else if (e.type === "pointerup") { swapFrom = swapFrom === i ? null : i; renderWeek(); }
  };
  g.addEventListener("pointerup", end); g.addEventListener("pointercancel", end);
  g.addEventListener("click", e => e.preventDefault());
}
// Beim Ziehen nicht neu zeichnen (sonst verliert der Finger den Griff), nur markieren.
function renderWeekKeepGrip() {
  document.querySelectorAll(".dayrow").forEach(r => r.classList.toggle("pick", +r.dataset.day === swapFrom));
  // Nichts einblenden, sonst verrutschen die Zeilen unter dem Finger.
}
document.addEventListener("keydown", e => { if (e.key === "Escape" && swapFrom !== null) cancelSwap(); });

/* ---------- day sheet ---------- */
let editing = null;
function openSheet(i) {
  editing = i; dayFilter = ""; const p = weekPlan()[i] || {};
  $("sh-title").textContent = DAYS[i] + ", " + fmt(addDays(wk, i));
  $("sh-meal").value = p.meal || ""; $("sh-note").value = p.note || ""; $("sh-url").value = p.url || "";
  drawSugg(); $("scrim").hidden = false; $("sh-sugg").parentElement.scrollTop = 0; const sel = $("sh-sugg").querySelector(".sel"); if (sel) sel.scrollIntoView({ block: "nearest" });
}
function drawSugg() {
  const val = $("sh-meal").value.trim(), q = val.toLowerCase(), box = $("sh-sugg"); box.textContent = "";
  const exact = S.meals.find(m => m.name.toLowerCase() === q);
  // Passt der Text genau zu einem Gericht, alle zeigen (zum Wechseln); sonst filtern.
  drawFilters("shfilter", dayFilter, t => { dayFilter = t; drawSugg(); });
  const list = S.meals.filter(m => (exact && exact.id === m.id) || (hasTag(m, dayFilter) && (!q || exact || m.name.toLowerCase().includes(q) || (m.ingredients || "").toLowerCase().includes(q))))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));
  if (!list.length) { const e = document.createElement("li"); e.className = "empty-state note"; e.textContent = val ? "Kein Gericht gefunden. Mit «Speichern» wird «" + val + "» als neues Gericht angelegt." : "Keine Gerichte mit «" + dayFilter + "»."; box.append(e); return; }
  list.forEach(m => {
    const li = document.createElement("li"), b = document.createElement("button");
    b.textContent = m.name; if (exact && exact.id === m.id) b.className = "sel";
    if (m.ingredients) { const sm = document.createElement("small"); sm.textContent = m.ingredients; b.append(sm); }
    b.onclick = () => { $("sh-meal").value = m.name; $("sh-url").value = m.url || ""; drawSugg(); };
    li.append(b); box.append(li);
  });
  const sel = box.querySelector(".sel"); if (sel) sel.scrollIntoView({ block: "nearest" });
}
$("sh-meal").addEventListener("input", drawSugg);
function closeSheet() { $("scrim").hidden = true; editing = null; }
$("sh-cancel").onclick = closeSheet;
$("scrim").addEventListener("click", e => { if (e.target.id === "scrim") closeSheet(); });
$("sh-save").onclick = async () => {
  const i = editing, raw = $("sh-url").value.trim(), url = cleanUrl(raw);
  if (raw && !url) { toast("Der Link sieht nicht richtig aus. Er sollte mit https:// beginnen."); return; }
  const meal = $("sh-meal").value.trim(), note = $("sh-note").value.trim();
  closeSheet();
  const ok = mutate({ t: "day", w: W(), i, body: meal || note ? { meal, note, url } : null, newMeal: meal ? { id: uid(), name: meal, url, ingredients: "", steps: "" } : null },
    meal ? SHORT[i] + ": " + meal : DAYS[i] + " geändert");
  if (ok) toast(DAYS[i] + " gespeichert");
};
$("sh-clear").onclick = async () => { const i = editing; closeSheet(); if (mutate({ t: "day", w: W(), i, body: null }, DAYS[i] + " geleert")) toast(DAYS[i] + " geleert"); };

/* ---------- recipe sheet ---------- */
let rId = null;
function curMeal() { return S.meals.find(m => m.id === rId); }
function openRecipe(id) { rId = id; showRecipeView(); $("rscrim").hidden = false; }
function showRecipeView() {
  const m = curMeal(); if (!m) { closeRecipe(); return; }
  $("r-form").hidden = true; $("r-view").hidden = false; $("r-days").hidden = true;
  $("r-title").textContent = m.name;
  const L = $("r-links"); L.textContent = ""; if (m.url) L.append(recipeLinks(m.url));
  const T = $("r-tagshow"); T.replaceWith(Object.assign(tagsEl(m), { id: "r-tagshow" }));
  const ing = $("r-ing"), st = $("r-steps");
  const items = (m.ingredients || "").split(",").map(s => s.trim()).filter(Boolean);
  ing.textContent = items.length ? items.map(s => "• " + s).join("\n") : "Noch keine Zutaten eingetragen."; ing.className = "pre" + (items.length ? "" : " empty");
  st.textContent = m.steps || "Noch nichts notiert. Unter «Bearbeiten» könnt ihr Zubereitung oder Tipps festhalten."; st.className = "pre" + (m.steps ? "" : " empty");
}
function closeRecipe() { $("rscrim").hidden = true; rId = null; }
$("r-close").onclick = closeRecipe;
$("rscrim").addEventListener("click", e => { if (e.target.id === "rscrim") closeRecipe(); });
$("r-edit").onclick = () => startEdit();
function startEdit() {
  const m = curMeal(); if (!m) return;
  editTags = [...(m.tags || [])]; drawTagPick("r-tags", editTags);
  $("r-name").value = m.name; $("r-url").value = m.url || ""; $("r-ingin").value = m.ingredients || ""; $("r-stepsin").value = m.steps || "";
  $("r-view").hidden = true; $("r-form").hidden = false;
  const d = $("r-del"); d.classList.remove("confirm"); d.textContent = "Gericht löschen";
}
$("r-cancel").onclick = () => { if (curMeal()) showRecipeView(); };
$("r-del").onclick = async () => {
  const d = $("r-del"), m = curMeal(); if (!m) return;
  if (!d.classList.contains("confirm")) { d.classList.add("confirm"); d.textContent = "Wirklich löschen?"; return; }
  const id = m.id, name = m.name; closeRecipe();
  if (mutate({ t: "mealDel", id }, "Gericht gelöscht: " + name)) toast("«" + name + "» gelöscht");
};
$("r-save").onclick = async () => {
  const m = curMeal(); if (!m) return;
  const name = $("r-name").value.trim(); if (!name) { $("r-name").focus(); return; }
  if (S.meals.some(x => x.id !== m.id && x.name.toLowerCase() === name.toLowerCase())) { toast("Ein Gericht mit diesem Namen gibt's schon."); return; }
  const raw = $("r-url").value.trim(), url = cleanUrl(raw); if (raw && !url) { toast("Der Link sieht nicht richtig aus."); return; }
  const id = m.id, old = m.name, ingredients = $("r-ingin").value.trim(), steps = $("r-stepsin").value.trim();
  const ok = mutate({ t: "mealEdit", id, data: { name, url, ingredients, steps, tags: [...editTags] } }, "Rezept geändert: " + name);
  if (ok) { toast("Gespeichert"); showRecipeView(); }
};
$("r-plan").onclick = () => {
  const box = $("r-days"); if (!box.hidden) { box.hidden = true; return; }
  box.textContent = ""; const plan = weekPlan();
  for (let i = 0; i < 7; i++) {
    const b = document.createElement("button"), p = plan[i];
    b.textContent = SHORT[i] + " " + fmt(addDays(wk, i)) + (p && p.meal ? " ✓" : "");
    b.onclick = async () => {
      const m = curMeal(); if (!m) return; const name = m.name, url = m.url || "";
      closeRecipe();
      if (mutate({ t: "day", w: W(), i, body: { meal: name, note: (p && p.note) || "", url } }, SHORT[i] + ": " + name)) { toast(name + " am " + DAYS[i]); setTab("week"); }
    };
    box.append(b);
  }
  box.hidden = false;
};
document.addEventListener("keydown", e => { if (e.key === "Escape") { if (!$("rscrim").hidden) closeRecipe(); else if (!$("scrim").hidden) closeSheet(); } });

/* ---------- other actions ---------- */
$("dice").onclick = async () => {
  if (!S.meals.length) { toast("Erst ein paar Gerichte unter «Ideen» sammeln."); return; }
  const plan = weekPlan(), used = new Set(Object.values(plan).map(p => p.meal)), days = {};
  let pool = S.meals.filter(m => !used.has(m.name));
  for (let i = 0; i < 7; i++) {
    if (plan[i] && plan[i].meal) continue;
    if (!pool.length) pool = [...S.meals];
    const m = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    days[i] = { meal: m.name, note: (plan[i] && plan[i].note) || "", url: m.url || "" };
  }
  const filled = Object.keys(days).length;
  if (filled) mutate({ t: "fill", w: W(), days }, "Woche aufgefüllt (" + filled + " Tage)");
  toast(filled ? filled + " Tage gefüllt. Passt was nicht? Einfach antippen." : "Alle Tage sind schon geplant.");
};
$("addmeal").onclick = async () => {
  const name = $("mealname").value.trim(); if (!name) { $("mealname").focus(); return; }
  const raw = $("mealurl").value.trim(), url = cleanUrl(raw); if (raw && !url) { toast("Der Link sieht nicht richtig aus."); return; }
  if (S.meals.some(m => m.name.toLowerCase() === name.toLowerCase())) { toast("Gibt's schon in der Liste."); return; }
  const ingredients = $("mealing").value.trim();
  if (mutate({ t: "mealAdd", meal: { id: uid(), name, url, ingredients, steps: "", tags: [...addTags] } }, "Neues Gericht: " + name)) {
    addTags = []; $("mealname").value = ""; $("mealurl").value = ""; $("mealing").value = ""; toast("«" + name + "» hinzugefügt");
  }
};
$("mealsearch").addEventListener("input", renderMeals);
$("mealname").addEventListener("keydown", e => { if (e.key === "Enter") $("mealurl").focus(); });
$("mealurl").addEventListener("keydown", e => { if (e.key === "Enter") $("mealing").focus(); });
$("mealing").addEventListener("keydown", e => { if (e.key === "Enter") $("addmeal").click(); });

function shopItem(text) { return { id: uid(), text, done: false, created: Date.now() }; }
$("addshop").onclick = () => {
  const t = $("shopin").value.trim(); if (!t) return;
  if (weekShop().some(y => y.text.toLowerCase() === t.toLowerCase())) { toast("Steht schon auf der Liste."); return; }
  if (mutate({ t: "shopAdd", w: W(), items: [shopItem(t)] }, "Einkauf: " + t)) $("shopin").value = "";
};
$("shopin").addEventListener("keydown", e => { if (e.key === "Enter") $("addshop").click(); });
$("fromplan").onclick = async () => {
  const have = new Set(weekShop().map(s => s.text.toLowerCase())), items = [];
  Object.values(weekPlan()).forEach(p => {
    const m = mealByName(p.meal);
    if (m && m.ingredients) m.ingredients.split(",").map(s => s.trim()).filter(Boolean).forEach(z => { if (!have.has(z.toLowerCase())) { have.add(z.toLowerCase()); items.push(shopItem(z)); } });
  });
  const n = items.length;
  if (n) mutate({ t: "shopAdd", w: W(), items }, n + " Zutaten auf der Einkaufsliste");
  toast(n ? n + " Zutaten dazu" : "Keine neuen Zutaten. Tragt bei den Gerichten Zutaten ein oder nutzt Bring mit dem Rezept-Link.");
};
$("cleardone").onclick = async () => {
  if (!weekShop().some(s => s.done)) { toast("Nichts abgehakt."); return; }
  if (mutate({ t: "shopClear", w: W() })) toast("Erledigte entfernt");
};
async function copyText(text, fb, okMsg) {
  try { await navigator.clipboard.writeText(text); fb.hidden = true; toast(okMsg); }
  catch (e) { fb.value = text; fb.hidden = false; fb.focus(); fb.select(); toast("Text markiert. Jetzt kopieren."); }
}
$("copybring").onclick = () => {
  const text = weekShop().filter(s => !s.done).sort((a, b) => aisleIndex(aisleOf(a)) - aisleIndex(aisleOf(b))).map(s => s.text).join("\n");
  if (!text) { toast("Keine offenen Artikel."); return; }
  copyText(text, $("copyfallback"), "Kopiert. Jetzt in Bring einfügen.");
};
$("shareinvite").onclick = async () => {
  const url = $("invitelink").value;
  if (navigator.share) { try { await navigator.share({ title: "Unser Znacht-Plan", text: "Unser gemeinsamer Essensplan:", url }); return; } catch (e) { if (e.name === "AbortError") return; } }
  copyText(url, $("invitelink"), "Link kopiert. Schick ihn deiner Frau.");
};
$("leave").onclick = () => {
  const b = $("leave");
  if (!b.classList.contains("confirm")) { b.classList.add("confirm"); b.textContent = "Sicher? Den Code vorher notieren."; return; }
  ls("znacht.code", null); ls("znacht.cache", null); location.hash = ""; location.reload();
};

/* ---------- tabs & weeks ---------- */
function setTab(t) { setTimeout(fitMealBox, 0);
  ["week", "ideas", "shop"].forEach(k => { $("tab-" + k).setAttribute("aria-selected", String(k === t)); $("v-" + k).hidden = k !== t; }); window.scrollTo(0, 0); }
["week", "ideas", "shop"].forEach(k => $("tab-" + k).onclick = () => setTab(k));
$("prev").onclick = () => { swapFrom = null; wk = addDays(wk, -7); renderAll(); };
$("next").onclick = () => { swapFrom = null; wk = addDays(wk, 7); renderAll(); };
$("refresh").onclick = async () => { $("refresh").disabled = true; await load(); $("refresh").disabled = false; toast("Aktualisiert"); };

/* ---------- setup & start ---------- */
function start(c) {
  code = c; ls("znacht.code", c);
  if (location.hash.slice(1) !== c) history.replaceState(null, "", "#" + c); // Code bleibt im Link, damit «Zum Home-Bildschirm» ihn mitnimmt
  $("setup").hidden = true; $("app").hidden = false;
  try {
    const cached = JSON.parse(ls("znacht.cache") || "null");
    if (cached && cached.code === c) {
      base = normalize(cached.base || cached.S); version = cached.version || 0;
      queue = Array.isArray(cached.queue) ? cached.queue : [];
    }
  } catch (e) {}
  S = applyAll(base, queue);
  renderAll(); renderPush(); showPending(); load();
  setInterval(() => { if (document.visibilityState === "visible" && $("scrim").hidden && $("rscrim").hidden) load(true); }, 20000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") load(true); });
  window.addEventListener("online", () => load(true));
  window.addEventListener("offline", () => showPending(true));
}
$("newplan").onclick = () => start(newCode());
$("joinplan").onclick = () => { const c = normCode($("joincode").value); if (!c) { toast("Der Code hat 20 Zeichen, z.B. ABCD-EFGH-…"); return; } start(c); };
$("joincode").addEventListener("keydown", e => { if (e.key === "Enter") $("joinplan").click(); });

(function boot() {
  if (SUPABASE_URL.startsWith("__")) { $("setup").hidden = false; status("Die Datenbank-Adresse fehlt noch in app.js."); return; }
  const fromHash = normCode(decodeURIComponent(location.hash.slice(1)));
  const saved = normCode(ls("znacht.code"));
  const c = fromHash || saved;
  if (c) start(c); else $("setup").hidden = false;
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then(r => r.update()).catch(() => {});
    // Neue Version installiert: einmal neu laden, damit alles zusammenpasst.
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (reloaded || !$("scrim").hidden || !$("rscrim").hidden) return; reloaded = true; location.reload(); });
  }
})();

// Znacht-Plan — gemeinsamer Wochenplan. Daten liegen als ein JSON-Dokument pro Haushalt in Supabase.
const SUPABASE_URL = "https://qpmnraeacexzjnnlvqhw.supabase.co";
const SUPABASE_KEY = "sb_publishable_BvKAH1kJTAZJSiwyIXAeJQ_YJ6_KATy";

const DAYS = ["Montag","Dienstag","Mittwoch","Donnerstag","Freitag","Samstag","Sonntag"];
const SHORT = ["Mo","Di","Mi","Do","Fr","Sa","So"];
const $ = id => document.getElementById(id);
const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

let code = null;
let S = { meals: [], plan: {}, shop: {} };
let version = 0;
let lastSync = null;
let busy = false;

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
function cacheLocal() { ls("znacht.cache", JSON.stringify({ code, version, S })); }

async function load(quiet) {
  if (!code) return;
  try {
    const res = await rpc("znacht_load", { p_code: code });
    if (res && typeof res.version === "number") {
      if (res.version !== version) { S = normalize(res.data); version = res.version; renderAll(); }
    } else if (version === 0 && !S.meals.length) {
      // Neuer Haushalt: mit ein paar Ideen starten
      await mutate(s => { s.meals = STARTER.map(m => ({ id: uid(), ...m })); }, true);
    }
    lastSync = new Date(); cacheLocal(); status(""); renderSync();
  } catch (e) {
    console.warn(e);
    status(navigator.onLine === false ? "Offline: Ihr seht den zuletzt geladenen Plan. Ändern geht wieder, sobald Internet da ist." : (quiet ? "" : "Keine Verbindung. Ihr seht den zuletzt geladenen Plan. Ändern geht wieder, sobald Internet da ist."));
  }
}

// Änderung anwenden und speichern. Wenn der andere gleichzeitig gespeichert hat:
// neuesten Stand holen, Änderung nochmal darauf anwenden, erneut speichern.
async function mutate(fn, silent) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const draft = JSON.parse(JSON.stringify(S));
    fn(draft);
    try {
      const v = await rpc("znacht_save", { p_code: code, p_data: draft, p_version: version });
      S = draft; version = v; lastSync = new Date(); cacheLocal(); renderAll(); renderSync(); status("");
      return true;
    } catch (e) {
      if (e.conflict) {
        const res = await rpc("znacht_load", { p_code: code }).catch(() => null);
        if (res) { S = normalize(res.data); version = res.version; }
        continue;
      }
      console.warn(e);
      if (!silent) toast(navigator.onLine === false ? "Offline: Ändern geht erst wieder mit Internet." : "Nicht gespeichert. Prüft die Internetverbindung und versucht es nochmal.");
      return false;
    }
  }
  toast("Gerade speichert ihr beide gleichzeitig. Bitte nochmal tippen.");
  renderAll();
  return false;
}

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
function renderMeals() {
  const ul = $("meals"); ul.textContent = "";
  if (!S.meals.length) { const e = document.createElement("li"); e.className = "empty-state"; e.textContent = "Noch keine Gerichte. Fügt oben euer erstes hinzu."; ul.append(e); return; }
  [...S.meals].sort((a, b) => a.name.localeCompare(b.name, "de")).forEach(m => {
    const li = document.createElement("li");
    const t = document.createElement("div"); t.className = "t";
    const nb = document.createElement("button"); nb.className = "mealbtn"; nb.textContent = m.name; nb.onclick = () => openRecipe(m.id); t.append(nb);
    if (m.ingredients) { const s = document.createElement("small"); s.textContent = m.ingredients; t.append(s); }
    if (m.url) { const s = document.createElement("small"); s.textContent = "Rezept: " + host(m.url); t.append(s); }
    const acts = document.createElement("div"); acts.className = "acts";
    const vb = document.createElement("button"); vb.className = "btn sm"; vb.textContent = "Ansehen"; vb.onclick = () => openRecipe(m.id);
    const eb = document.createElement("button"); eb.className = "btn sm primary"; eb.textContent = "Ändern"; eb.onclick = () => { rId = m.id; $("rscrim").hidden = false; startEdit(); };
    acts.append(vb, eb); li.append(t, acts); ul.append(li);
  });
}
function renderShop() {
  const ul = $("shop"); ul.textContent = ""; const list = weekShop();
  if (!list.length) { const e = document.createElement("li"); e.className = "empty-state"; e.textContent = "Leer. Tippt auf «Zutaten aus dem Plan holen» oder schreibt selbst etwas."; ul.append(e); return; }
  [...list].sort((a, b) => (a.done - b.done) || ((a.created || 0) - (b.created || 0))).forEach(s => {
    const li = document.createElement("li"); if (s.done) li.className = "done";
    const cb = document.createElement("input"); cb.type = "checkbox"; cb.id = "s-" + s.id; cb.checked = !!s.done;
    cb.onchange = () => mutate(st => { const it = (st.shop[W()] || []).find(x => x.id === s.id); if (it) it.done = cb.checked; });
    const t = document.createElement("label"); t.className = "t"; t.htmlFor = cb.id; t.textContent = s.text;
    const x = document.createElement("button"); x.className = "x"; x.textContent = "✕"; x.setAttribute("aria-label", s.text + " entfernen");
    x.onclick = () => mutate(st => { st.shop[W()] = (st.shop[W()] || []).filter(y => y.id !== s.id); });
    li.append(cb, t, x); ul.append(li);
  });
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
  const ok = await mutate(st => {
    const w = W(); const plan = st.plan[w] = st.plan[w] || {};
    const pa = plan[a], pb = plan[b];
    if (pb) plan[a] = pb; else delete plan[a];
    if (pa) plan[b] = pa; else delete plan[b];
  });
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
  editing = i; const p = weekPlan()[i] || {};
  $("sh-title").textContent = DAYS[i] + ", " + fmt(addDays(wk, i));
  $("sh-meal").value = p.meal || ""; $("sh-note").value = p.note || ""; $("sh-url").value = p.url || "";
  drawSugg(); $("scrim").hidden = false; setTimeout(() => $("sh-meal").focus(), 50);
}
function drawSugg() {
  const q = $("sh-meal").value.trim().toLowerCase(), box = $("sh-sugg"); box.textContent = "";
  S.meals.filter(m => (!q || m.name.toLowerCase().includes(q)) && m.name.toLowerCase() !== q).slice(0, 8).forEach(m => {
    const b = document.createElement("button"); b.textContent = m.name;
    b.onclick = () => { $("sh-meal").value = m.name; if (!$("sh-url").value && m.url) $("sh-url").value = m.url; drawSugg(); };
    box.append(b);
  });
}
$("sh-meal").addEventListener("input", drawSugg);
function closeSheet() { $("scrim").hidden = true; editing = null; }
$("sh-cancel").onclick = closeSheet;
$("scrim").addEventListener("click", e => { if (e.target.id === "scrim") closeSheet(); });
function setDay(st, i, body) { const w = W(); st.plan[w] = st.plan[w] || {}; if (body) st.plan[w][i] = body; else delete st.plan[w][i]; }
$("sh-save").onclick = async () => {
  const i = editing, raw = $("sh-url").value.trim(), url = cleanUrl(raw);
  if (raw && !url) { toast("Der Link sieht nicht richtig aus. Er sollte mit https:// beginnen."); return; }
  const meal = $("sh-meal").value.trim(), note = $("sh-note").value.trim();
  closeSheet();
  const ok = await mutate(st => {
    setDay(st, i, meal || note ? { meal, note, url } : null);
    if (meal && !st.meals.some(m => m.name.toLowerCase() === meal.toLowerCase())) st.meals.push({ id: uid(), name: meal, url, ingredients: "", steps: "" });
  });
  if (ok) toast(DAYS[i] + " gespeichert");
};
$("sh-clear").onclick = async () => { const i = editing; closeSheet(); if (await mutate(st => setDay(st, i, null))) toast(DAYS[i] + " geleert"); };

/* ---------- recipe sheet ---------- */
let rId = null;
function curMeal() { return S.meals.find(m => m.id === rId); }
function openRecipe(id) { rId = id; showRecipeView(); $("rscrim").hidden = false; }
function showRecipeView() {
  const m = curMeal(); if (!m) { closeRecipe(); return; }
  $("r-form").hidden = true; $("r-view").hidden = false; $("r-days").hidden = true;
  $("r-title").textContent = m.name;
  const L = $("r-links"); L.textContent = ""; if (m.url) L.append(recipeLinks(m.url));
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
  $("r-name").value = m.name; $("r-url").value = m.url || ""; $("r-ingin").value = m.ingredients || ""; $("r-stepsin").value = m.steps || "";
  $("r-view").hidden = true; $("r-form").hidden = false;
  const d = $("r-del"); d.classList.remove("confirm"); d.textContent = "Gericht löschen";
}
$("r-cancel").onclick = () => { if (curMeal()) showRecipeView(); };
$("r-del").onclick = async () => {
  const d = $("r-del"), m = curMeal(); if (!m) return;
  if (!d.classList.contains("confirm")) { d.classList.add("confirm"); d.textContent = "Wirklich löschen?"; return; }
  const id = m.id, name = m.name; closeRecipe();
  if (await mutate(st => { st.meals = st.meals.filter(x => x.id !== id); })) toast("«" + name + "» gelöscht");
};
$("r-save").onclick = async () => {
  const m = curMeal(); if (!m) return;
  const name = $("r-name").value.trim(); if (!name) { $("r-name").focus(); return; }
  if (S.meals.some(x => x.id !== m.id && x.name.toLowerCase() === name.toLowerCase())) { toast("Ein Gericht mit diesem Namen gibt's schon."); return; }
  const raw = $("r-url").value.trim(), url = cleanUrl(raw); if (raw && !url) { toast("Der Link sieht nicht richtig aus."); return; }
  const id = m.id, old = m.name, ingredients = $("r-ingin").value.trim(), steps = $("r-stepsin").value.trim();
  const ok = await mutate(st => {
    const x = st.meals.find(y => y.id === id); if (!x) return;
    Object.assign(x, { name, url, ingredients, steps });
    if (old !== name) Object.values(st.plan).forEach(wp => Object.values(wp).forEach(p => { if (p.meal === old) p.meal = name; }));
  });
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
      if (await mutate(st => setDay(st, i, { meal: name, note: (p && p.note) || "", url }))) { toast(name + " am " + DAYS[i]); setTab("week"); }
    };
    box.append(b);
  }
  box.hidden = false;
};
document.addEventListener("keydown", e => { if (e.key === "Escape") { if (!$("rscrim").hidden) closeRecipe(); else if (!$("scrim").hidden) closeSheet(); } });

/* ---------- other actions ---------- */
$("dice").onclick = async () => {
  if (!S.meals.length) { toast("Erst ein paar Gerichte unter «Ideen» sammeln."); return; }
  let filled = 0;
  await mutate(st => {
    filled = 0; const w = W(); st.plan[w] = st.plan[w] || {}; const plan = st.plan[w];
    const used = new Set(Object.values(plan).map(p => p.meal));
    let pool = st.meals.filter(m => !used.has(m.name));
    for (let i = 0; i < 7; i++) {
      if (plan[i] && plan[i].meal) continue;
      if (!pool.length) pool = [...st.meals];
      const m = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      plan[i] = { meal: m.name, note: (plan[i] && plan[i].note) || "", url: m.url || "" }; filled++;
    }
  });
  toast(filled ? filled + " Tage gefüllt. Passt was nicht? Einfach antippen." : "Alle Tage sind schon geplant.");
};
$("addmeal").onclick = async () => {
  const name = $("mealname").value.trim(); if (!name) { $("mealname").focus(); return; }
  const raw = $("mealurl").value.trim(), url = cleanUrl(raw); if (raw && !url) { toast("Der Link sieht nicht richtig aus."); return; }
  if (S.meals.some(m => m.name.toLowerCase() === name.toLowerCase())) { toast("Gibt's schon in der Liste."); return; }
  const ingredients = $("mealing").value.trim();
  if (await mutate(st => st.meals.push({ id: uid(), name, url, ingredients, steps: "" }))) {
    $("mealname").value = ""; $("mealurl").value = ""; $("mealing").value = ""; toast("«" + name + "» hinzugefügt");
  }
};
$("mealname").addEventListener("keydown", e => { if (e.key === "Enter") $("mealurl").focus(); });
$("mealurl").addEventListener("keydown", e => { if (e.key === "Enter") $("mealing").focus(); });
$("mealing").addEventListener("keydown", e => { if (e.key === "Enter") $("addmeal").click(); });

function pushShop(st, text) { const w = W(); st.shop[w] = st.shop[w] || []; st.shop[w].push({ id: uid(), text, done: false, created: Date.now() }); }
$("addshop").onclick = async () => { const t = $("shopin").value.trim(); if (!t) return; if (await mutate(st => pushShop(st, t))) $("shopin").value = ""; };
$("shopin").addEventListener("keydown", e => { if (e.key === "Enter") $("addshop").click(); });
$("fromplan").onclick = async () => {
  let n = 0;
  await mutate(st => {
    n = 0; const have = new Set((st.shop[W()] || []).map(s => s.text.toLowerCase()));
    Object.values(st.plan[W()] || {}).forEach(p => {
      const m = st.meals.find(x => x.name === p.meal);
      if (m && m.ingredients) m.ingredients.split(",").map(s => s.trim()).filter(Boolean).forEach(z => { if (!have.has(z.toLowerCase())) { have.add(z.toLowerCase()); pushShop(st, z); n++; } });
    });
  });
  toast(n ? n + " Zutaten dazu" : "Keine neuen Zutaten. Tragt bei den Gerichten Zutaten ein oder nutzt Bring mit dem Rezept-Link.");
};
$("cleardone").onclick = async () => {
  if (!weekShop().some(s => s.done)) { toast("Nichts abgehakt."); return; }
  if (await mutate(st => { st.shop[W()] = (st.shop[W()] || []).filter(s => !s.done); })) toast("Erledigte entfernt");
};
async function copyText(text, fb, okMsg) {
  try { await navigator.clipboard.writeText(text); fb.hidden = true; toast(okMsg); }
  catch (e) { fb.value = text; fb.hidden = false; fb.focus(); fb.select(); toast("Text markiert. Jetzt kopieren."); }
}
$("copybring").onclick = () => {
  const text = weekShop().filter(s => !s.done).map(s => s.text).join("\n");
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
function setTab(t) { ["week", "ideas", "shop"].forEach(k => { $("tab-" + k).setAttribute("aria-selected", String(k === t)); $("v-" + k).hidden = k !== t; }); window.scrollTo(0, 0); }
["week", "ideas", "shop"].forEach(k => $("tab-" + k).onclick = () => setTab(k));
$("prev").onclick = () => { swapFrom = null; wk = addDays(wk, -7); renderAll(); };
$("next").onclick = () => { swapFrom = null; wk = addDays(wk, 7); renderAll(); };
$("refresh").onclick = async () => { $("refresh").disabled = true; await load(); $("refresh").disabled = false; toast("Aktualisiert"); };

/* ---------- setup & start ---------- */
function start(c) {
  code = c; ls("znacht.code", c);
  if (location.hash.slice(1) !== c) history.replaceState(null, "", "#" + c); // Code bleibt im Link, damit «Zum Home-Bildschirm» ihn mitnimmt
  $("setup").hidden = true; $("app").hidden = false;
  try { const cached = JSON.parse(ls("znacht.cache") || "null"); if (cached && cached.code === c) { S = normalize(cached.S); version = cached.version || 0; } } catch (e) {}
  renderAll(); load();
  setInterval(() => { if (document.visibilityState === "visible" && $("scrim").hidden && $("rscrim").hidden) load(true); }, 20000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") load(true); });
  window.addEventListener("online", () => load(true));
  window.addEventListener("offline", () => status("Offline: Ihr seht den zuletzt geladenen Plan. Ändern geht wieder, sobald Internet da ist."));
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
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js?v=4").catch(() => {});
})();

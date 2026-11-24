/* Hulla hulla FC – mobilní aplikace (PWA) */
import { createStore } from "./store.js";

const CFG = self.HH_CONFIG || {};
const TEAM = CFG.team || "Hulla hulla FC";
const MIN = CFG.minPlayers || 6;
const DAYS = ["Ne", "Po", "Út", "St", "Čt", "Pá", "So"];
const MONTHS_GEN = ["ledna", "února", "března", "dubna", "května", "června", "července", "srpna", "září", "října", "listopadu", "prosince"];

let store = null;
let D = null;
const UI = {
  me: lsGet("hh-me"), sort: "g", statSeason: "all", open: new Set(),
  pushOn: !!lsGet("hh-push"), pushSupported: false, pushError: null, installEvt: null, pending: false, fatal: null
};

/* ---------- pomocné ---------- */
function lsGet(k) { try { return localStorage.getItem(k) || null; } catch (e) { return null; } }
function lsSet(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) {} }
const $ = s => document.querySelector(s);
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids.flat(Infinity)) { if (kid == null || kid === false) continue; el.append(kid instanceof Node ? kid : String(kid)); }
  return el;
}
let toastTimer;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3800); }
function plural(n, one, few, many) { return n === 1 ? one : n >= 2 && n <= 4 ? few : many; }
function surname(n) { const i = String(n).lastIndexOf(" "); return i > 0 ? n.slice(i + 1) : n; }
function dt(m) { return new Date(m.date + "T" + (m.time || "12:00") + ":00"); }
function fmtDate(m) { const d = dt(m); return DAYS[d.getDay()] + " " + d.getDate() + ". " + (d.getMonth() + 1) + "."; }
function fmtLong(m) { const d = dt(m); return DAYS[d.getDay()] + " " + d.getDate() + ". " + MONTHS_GEN[d.getMonth()]; }
function relDays(m) {
  const a = new Date(); a.setHours(0, 0, 0, 0);
  const b = dt(m); b.setHours(0, 0, 0, 0);
  const n = Math.round((b - a) / 86400000);
  if (n < 0) return "čeká na výsledek";
  if (n === 0) return "dnes";
  if (n === 1) return "zítra";
  if (n === 2) return "pozítří";
  return "za " + n + (n < 5 ? " dny" : " dní");
}
function scoreOf(m) { return (m.override && m.override.score) || m.score || null; }
function htOf(m) { return m.override ? (m.override.ht || null) : (m.ht || null); }
function result(m) {
  const s = scoreOf(m); if (!s) return null;
  const [a, b] = s.split(":").map(Number);
  const gf = m.home ? a : b, ga = m.home ? b : a;
  return { gf, ga, r: gf > ga ? "V" : gf < ga ? "P" : "R" };
}
const RES_WORD = { V: "výhra", R: "remíza", P: "prohra" };
function teamsLine(m) {
  const us = h("strong", { text: TEAM }), op = h("span", { text: m.opp });
  return m.home ? [us, " – ", op] : [op, " – ", us];
}
function roundLabel(m) { return m.round ? m.round + ". kolo" : "Zápas"; }

const COLORS = [["žlut", "#f2d027"], ["růžov", "#f29ac0"], ["čern", "#1b1b1b"], ["bíl", "#ffffff"], ["modr", "#2f6fd6"], ["červen", "#d23b2b"],
  ["zelen", "#2e8b57"], ["oranž", "#f28c28"], ["fialov", "#7d4cc2"], ["šed", "#9aa3a0"], ["hněd", "#7a5230"], ["tyrkys", "#1fb5b5"],
  ["vínov", "#7b1f35"], ["zlat", "#d4a017"], ["stříbr", "#c0c0c0"], ["béžov", "#d8c3a0"], ["khaki", "#a39b6b"], ["azur", "#4fa3e0"]];
function swatch(name) {
  const cols = String(name || "").toLowerCase().split(/[-\s/]+/).map(p => (COLORS.find(([k]) => p.startsWith(k)) || [])[1]).filter(Boolean);
  if (!cols.length) return null;
  if (cols.length === 1) return cols[0];
  return "linear-gradient(135deg," + cols.map((c, i) => c + " " + (i * 100 / cols.length) + "% " + ((i + 1) * 100 / cols.length) + "%").join(",") + ")";
}

/* ---------- odvozená data ---------- */
function derive() {
  const players = D.players.slice().sort((a, b) => surname(a.name).localeCompare(surname(b.name), "cs") || a.name.localeCompare(b.name, "cs"));
  const active = players.filter(p => p.active !== false);
  const hidden = players.filter(p => p.active === false);
  const byPsmf = new Map(); for (const p of players) if (p.psmfName) byPsmf.set(p.psmfName, p);
  const seasons = D.seasons.slice().sort((a, b) => b.sortKey - a.sortKey).slice(0, 5);
  const current = (D.config && D.config.currentSeason) || (seasons[0] && seasons[0].id) || null;
  const matches = D.matches.slice().sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
  const upcoming = matches.filter(m => !scoreOf(m) && dt(m).getTime() + 3 * 3600e3 > Date.now());
  const me = UI.me && players.find(p => p.id === UI.me) ? UI.me : null;
  return { players, active, hidden, byPsmf, seasons, current, matches, upcoming, me };
}
function displayName(X, psmfName) { const p = X.byPsmf.get(psmfName); return p ? p.name : psmfName; }
function status(mid, pid) { return D.attendance.get(mid + "__" + pid) || null; }
function counts(m, X) {
  let yes = 0, no = 0, none = 0;
  for (const p of X.active) { const s = status(m.id, p.id); if (s === "yes") yes++; else if (s === "no") no++; else none++; }
  const sd = D.subs.get(m.id) || {};
  const subs = [0, 1, 2].filter(i => typeof sd["s" + i] === "string" && sd["s" + i].trim()).length;
  return { yes, no, none, subs, going: yes + subs, total: X.active.length };
}
function readiness(c) {
  if (c.going >= MIN) return h("span", { class: "pill ok", text: "Sestava je" });
  return h("span", { class: "pill short", text: "Chybí " + (MIN - c.going) });
}

/* ---------- akce ---------- */
async function setAtt(mid, pid, st) {
  try { await store.setAttendance(mid, pid, st === "none" ? null : st); }
  catch (e) { console.error(e); toast("Uložení se nepovedlo. Zkontroluj připojení a zkus to znovu."); }
}
function chooseMe(pid) {
  UI.me = pid || null; lsSet("hh-me", UI.me);
  if (store && UI.pushOn) store.updatePushPlayer(UI.me || "");
  render();
}
function tri(m, p, big) {
  const cur = status(m.id, p.id) || "none";
  const opts = [["yes", "Jdu"], ["no", "Nejdu"], ["none", "Nehlásil se"]];
  return h("div", { class: "tri" + (big ? " big" : ""), role: "group", "aria-label": "Účast: " + p.name + ", " + m.opp },
    opts.map(([v, t]) => h("button", {
      type: "button", class: v, id: "t-" + m.id + "-" + p.id + "-" + v + (big ? "-b" : ""),
      "aria-pressed": String(cur === v), onclick: () => { if (cur !== v) setAtt(m.id, p.id, v); }, text: t
    })));
}

/* ---------- dialog ---------- */
function openSheet(title, body, actions) {
  const dlg = $("#sheet");
  $("#sheet-title").textContent = title;
  $("#sheet-body").replaceChildren(...[].concat(body));
  $("#sheet-actions").replaceChildren(...actions.map(a => h("button", {
    type: a.submit ? "submit" : "button", class: "btn " + (a.cls || ""), value: a.value || "",
    onclick: a.onclick ? (e) => { e.preventDefault(); a.onclick(); } : null, text: a.label
  })));
  if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
  const first = dlg.querySelector("input"); if (first) setTimeout(() => first.focus(), 30);
}
function closeSheet() { const d = $("#sheet"); if (d.open) d.close(); }

function editPlayer(p) {
  const name = h("input", { class: "input", id: "sheet-name", maxlength: "60", autocomplete: "off" }); name.value = p.name;
  const psmf = h("input", { class: "input", id: "sheet-psmf", maxlength: "60", autocomplete: "off" }); psmf.value = p.psmfName || "";
  openSheet("Upravit hráče", [
    h("label", { class: "field", for: "sheet-name" }, "Jméno v aplikaci", name),
    h("label", { class: "field", for: "sheet-psmf" }, "Jméno v zápisech PSMF", psmf),
    h("p", { class: "hint", text: "Podle jména v zápisech PSMF se hráči přiřazují zápasy a góly. Měň ho jen tehdy, když se v zápisu jmenuje jinak." })
  ], [
    { label: p.active === false ? "Vrátit do docházky" : "Skrýt z docházky", cls: "ghost", onclick: async () => {
      closeSheet();
      try { await store.updatePlayer(p.id, { active: p.active === false }); toast(p.active === false ? "Hráč je zpět v docházce." : "Hráč je skrytý. Vrátit ho můžeš dole v docházce."); }
      catch (e) { toast("Změna se nepovedla."); }
    } },
    { label: "Zrušit", cls: "ghost", onclick: closeSheet },
    { label: "Uložit", onclick: async () => {
      const n = name.value.trim().replace(/\s+/g, " "), ps = psmf.value.trim().replace(/\s+/g, " ");
      if (!n) { toast("Jméno nesmí být prázdné."); return; }
      closeSheet();
      try { await store.updatePlayer(p.id, { name: n.slice(0, 60), psmfName: (ps || n).slice(0, 60) }); toast("Uloženo."); }
      catch (e) { toast("Uložení se nepovedlo."); }
    } }
  ]);
}
function addPlayer() {
  const name = h("input", { class: "input", id: "sheet-new", maxlength: "60", autocomplete: "off", placeholder: "Jméno Příjmení" });
  openSheet("Přidat hráče", [h("label", { class: "field", for: "sheet-new" }, "Jméno a příjmení", name),
    h("p", { class: "hint", text: "Piš jméno stejně jako v zápisech PSMF, aby se mu počítaly zápasy a góly." })], [
    { label: "Zrušit", cls: "ghost", onclick: closeSheet },
    { label: "Přidat", onclick: async () => {
      const n = name.value.trim().replace(/\s+/g, " ");
      if (n.length < 2) { toast("Napiš jméno hráče."); return; }
      closeSheet();
      try { await store.addPlayer(n.slice(0, 60)); toast("Hráč přidán."); } catch (e) { toast("Přidání se nepovedlo."); }
    } }
  ]);
}
function editScore(m) {
  const sc = h("input", { class: "input", id: "sheet-score", inputmode: "numeric", placeholder: "např. 4:2", maxlength: "5" }); sc.value = scoreOf(m) || "";
  const ht = h("input", { class: "input", id: "sheet-ht", inputmode: "numeric", placeholder: "např. 2:1", maxlength: "5" }); ht.value = htOf(m) || "";
  const actions = [{ label: "Zrušit", cls: "ghost", onclick: closeSheet }, { label: "Uložit", onclick: async () => {
    const s = sc.value.trim().replace(/\s/g, ""), hs = ht.value.trim().replace(/\s/g, "");
    if (!/^\d{1,2}:\d{1,2}$/.test(s) || (hs && !/^\d{1,2}:\d{1,2}$/.test(hs))) { toast("Výsledek zapiš jako domácí:hosté, třeba 4:2."); return; }
    closeSheet();
    try { await store.setOverride(m.id, { score: s, ht: hs || null }); toast("Výsledek opraven."); } catch (e) { toast("Uložení se nepovedlo."); }
  } }];
  if (m.override) actions.unshift({ label: "Vrátit podle PSMF", cls: "danger", onclick: async () => { closeSheet(); try { await store.setOverride(m.id, null); toast("Platí zase výsledek z PSMF."); } catch (e) { toast("Změna se nepovedla."); } } });
  openSheet("Opravit výsledek", [
    h("p", { class: "hint" }, teamsLine(m)),
    h("label", { class: "field", for: "sheet-score" }, "Výsledek (domácí:hosté)", sc),
    h("label", { class: "field", for: "sheet-ht" }, "Poločas (nepovinné)", ht),
    h("p", { class: "hint", text: "Ruční oprava má přednost před údajem z PSMF, dokud ji nezrušíš." })
  ], actions);
}

/* ---------- pohled: Zápasy ---------- */
function whoCard(X) {
  const sel = h("select", { class: "input", id: "who", onchange: e => chooseMe(e.target.value) },
    h("option", { value: "", text: "Vyber své jméno…" }), X.active.map(p => h("option", { value: p.id, text: p.name })));
  return h("div", { class: "card" }, h("h3", { text: "Kdo jsi?" }),
    h("p", { text: "Vyber se jednou ze soupisky. Aplikace si tě zapamatuje a ty pak jen klikáš, jestli na zápas jdeš." }),
    h("label", { class: "sr", for: "who", text: "Kdo jsi" }), sel);
}
function boardCard(m, X) {
  const c = counts(m, X);
  const tot = Math.max(c.total + c.subs, 1);
  const pct = n => (n / tot * 100).toFixed(1) + "%";
  const me = X.me && X.players.find(p => p.id === X.me);
  const shirts = [];
  if (m.ourColor) shirts.push(h("span", { class: "shirt" }, h("i", { style: "background:" + (swatch(m.ourColor) || "transparent") }), "my " + m.ourColor));
  if (m.oppColor) shirts.push(h("span", { class: "shirt" }, h("i", { style: "background:" + (swatch(m.oppColor) || "transparent") }), "soupeř " + m.oppColor));
  return h("section", { class: "board", "aria-label": "Nejbližší zápas" },
    h("div", { class: "meta" }, h("b", { text: roundLabel(m) }), h("span", { text: fmtDate(m) }), m.time ? h("span", { text: m.time }) : null,
      m.venue ? h("span", { text: "hřiště " + m.venue }) : null, h("span", { text: m.home ? "doma" : "venku" })),
    h("h2", { class: "teams" },
      h("span", { class: m.home ? "us" : "", text: m.home ? TEAM : m.opp }),
      h("span", { class: "vs", text: "proti" }),
      h("span", { class: m.home ? "" : "us", text: m.home ? m.opp : TEAM })),
    h("div", { class: "sub" }, h("span", { class: "when", text: relDays(m) }), shirts),
    h("div", { class: "tally" },
      h("span", { class: "big num", text: String(c.going) }),
      h("span", { class: "of" }, plural(c.going, "jde", "jdou", "jde") + " z ", h("b", { text: String(c.total + c.subs) })),
      readiness(c)),
    h("div", { class: "bar", role: "img", "aria-label": c.yes + " jde, " + c.subs + " náhradníci, " + c.no + " nejde, " + c.none + " se nehlásilo" },
      h("span", { class: "b-yes", style: "width:" + pct(c.yes) }), h("span", { class: "b-sub", style: "width:" + pct(c.subs) }), h("span", { class: "b-no", style: "width:" + pct(c.no) })),
    h("div", { class: "legend" },
      h("span", null, h("i", { style: "background:var(--yes)" }), "jde " + c.yes),
      c.subs ? h("span", null, h("i", { style: "background:repeating-linear-gradient(135deg,var(--yes) 0 3px,transparent 3px 5px)" }), "náhradníci " + c.subs) : null,
      h("span", null, h("i", { style: "background:var(--no)" }), "nejde " + c.no),
      h("span", null, h("i", { style: "background:rgba(255,255,255,.25)" }), "nehlásil se " + c.none)),
    me ? [h("p", { class: "me-label", text: "Tvoje účast (" + me.name + ")" }), tri(m, me, true)] : null,
    h("a", { class: "more", href: "#dochazka/" + m.id, text: "Celá docházka a náhradníci →" }));
}
function upcomingItem(m, X) {
  const c = counts(m, X);
  const me = X.me && X.players.find(p => p.id === X.me);
  return h("div", { class: "item", style: "flex-wrap:wrap" },
    h("div", { class: "date" }, h("b", { text: fmtDate(m) }), h("span", { text: (m.time || "") + (m.venue ? " · " + m.venue : "") })),
    h("div", { class: "grow" }, h("div", { class: "teams-line" }, teamsLine(m)),
      h("a", { class: "small", href: "#dochazka/" + m.id, text: roundLabel(m) + " · jde " + c.going + " z " + (c.total + c.subs) + " · " + relDays(m) })),
    me ? h("div", { style: "width:100%;display:flex;justify-content:flex-end" }, tri(m, me, false)) : null);
}
function pushCard() {
  if (UI.pushOn || store.mode === "demo") return null;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  if (ios && !standalone) {
    return h("div", { class: "card" }, h("h3", { text: "Připomínky zápasů" }),
      h("p", { text: "Na iPhonu chodí připomínky jen z aplikace na ploše. V Safari klepni na Sdílet a pak na Přidat na plochu. Aplikaci otevři z plochy a připomínky zapni tady." }));
  }
  if (IS_SAMSUNG) return h("div", { class: "card" }, h("h3", { text: "Připomínky zápasů" }), samsungNote());
  if (!UI.pushSupported) return null;
  return h("div", { class: "card" }, h("h3", { text: "Zapni si připomínky" }),
    h("p", { text: "Ve 12:00 tři, dva a jeden den před každým zápasem ti přijde upozornění, abys nezapomněl dát vědět." }),
    h("button", { class: "btn", type: "button", onclick: enablePush, text: "Zapnout připomínky" }), pushStatus());
}
const IS_SAMSUNG = /SamsungBrowser/i.test(navigator.userAgent);
const IS_ANDROID = /Android/i.test(navigator.userAgent);
function chromeLink() {
  return "intent://" + location.host + location.pathname + "#Intent;scheme=https;package=com.android.chrome;end";
}
function samsungNote() {
  return h("div", null,
    h("p", { style: "color:var(--no);font-size:14px", text: "Prohlížeč Samsung Internet připomínky nepodporuje. Otevři aplikaci v Chromu, přidej si ji z Chromu na plochu a připomínky zapni tam. Docházka funguje v obou prohlížečích." }),
    h("a", { class: "btn", href: chromeLink(), text: "Otevřít v Chromu" }));
}
const PERM_WORD = { granted: "povolená", denied: "zablokovaná v telefonu", default: "zatím nevybraná" };
const BLOCKED_HELP = "Oznámení jsou pro tuhle aplikaci v telefonu zablokovaná. Android: podrž prst na ikoně aplikace → Informace o aplikaci → Oznámení → povolit. iPhone: Nastavení → Oznámení → Hulla hulla. Pak aplikaci zavři, otevři a zkus to znovu.";
async function enablePush() {
  if (!("Notification" in window)) { toast("Tenhle prohlížeč upozornění nepodporuje."); return; }
  const ask = Notification.requestPermission();
  const perm = Promise.race([Promise.resolve(ask), new Promise(res => setTimeout(() => res("timeout"), 20000))]);
  UI.pushError = null;
  toast("Čekám na povolení oznámení…");
  try {
    const r = await store.enablePush(perm, UI.me || "");
    if (r.ok) { UI.pushOn = true; toast("Připomínky jsou zapnuté."); }
    else if (r.reason === "denied") UI.pushError = BLOCKED_HELP;
    else if (r.reason === "default") UI.pushError = "Okno s povolením se zavřelo bez volby. Zkus to znovu a zvol Povolit.";
    else if (r.reason === "timeout") UI.pushError = "Prohlížeč nezobrazil žádost o povolení oznámení. " + (IS_ANDROID ? "Na Androidu použij Chrome: otevři v něm adresu aplikace, přidej ji na plochu a zkus to znovu." : "Povol oznámení pro tuto stránku v nastavení prohlížeče a zkus to znovu.");
    else if (r.reason === "unsupported") UI.pushError = "Tenhle prohlížeč připomínky nepodporuje. Zkus Chrome na Androidu nebo Safari na iPhonu.";
    else UI.pushError = "Připomínky se nepodařilo zapnout. Krok: " + (r.stage || "neznámý") + ". Chyba: " + (r.detail || r.reason);
  } catch (e) { UI.pushError = "Připomínky se nepodařilo zapnout. Chyba: " + String((e && e.message) || e); }
  if (UI.pushError) toast(UI.pushError.length > 110 ? "Připomínky se nepodařilo zapnout, podrobnosti jsou v kartě Připomínky." : UI.pushError);
  render();
}
function pushStatus() {
  const out = [];
  if ("Notification" in window) out.push(h("p", { class: "hint", text: "Oprávnění k oznámením: " + (PERM_WORD[Notification.permission] || Notification.permission) + "." }));
  if (UI.pushError) out.push(h("p", { style: "color:var(--no);font-size:14px;user-select:text", text: UI.pushError }));
  else if ("Notification" in window && Notification.permission === "denied") out.push(h("p", { style: "color:var(--no);font-size:14px", text: BLOCKED_HELP }));
  return out;
}
function viewHome(X) {
  const out = [];
  if (!X.me && X.active.length) out.push(whoCard(X));
  const next = X.upcoming[0];
  if (next) out.push(boardCard(next, X));
  else out.push(h("div", { class: "card" }, h("h3", { text: "Žádný zápas v rozpisu" }),
    h("p", { text: "Jakmile PSMF zveřejní rozpis další části sezóny, zápasy se tu objeví samy." })));
  const pc = pushCard(); if (pc) out.push(pc);
  if (X.upcoming.length > 1) out.push(h("h2", { class: "section-title", text: "Další zápasy" }), h("div", { class: "list" }, X.upcoming.slice(1).map(m => upcomingItem(m, X))));
  const last = X.matches.filter(m => scoreOf(m)).pop();
  if (last) out.push(h("h2", { class: "section-title", text: "Poslední výsledek" }), h("div", { class: "list" }, matchDetails(last, X)));
  return out;
}

/* ---------- pohled: Docházka ---------- */
function viewAttendance(X, id) {
  const out = [];
  let m = (id && X.matches.find(x => x.id === id)) || X.upcoming[0];
  if (!m) return [h("div", { class: "card" }, h("h3", { text: "Žádný zápas v rozpisu" }), h("p", { text: "Docházka se otevře, jakmile bude v rozpisu další zápas." }))];
  if (X.upcoming.length > 1 || !X.upcoming.includes(m)) {
    out.push(h("nav", { class: "chips", "aria-label": "Výběr zápasu" }, X.upcoming.map(u => h("a", {
      class: "chip", href: "#dochazka/" + u.id, "aria-current": String(u.id === m.id)
    }, h("b", { text: fmtDate(u) }), h("span", { text: u.opp })))));
  }
  const c = counts(m, X);
  out.push(h("div", { class: "att-head" },
    h("h2", { text: m.opp }),
    h("p", { class: "hint", text: (m.home ? "Doma" : "Venku") + " · " + fmtLong(m) + (m.time ? " v " + m.time : "") + (m.venue ? " · hřiště " + m.venue : "") + " · " + roundLabel(m) + " · " + relDays(m) }),
    h("div", { class: "counts" }, readiness(c),
      h("span", null, "Jde ", h("b", { class: "num", text: String(c.going) }), c.subs ? " (z toho " + c.subs + " " + plural(c.subs, "náhradník", "náhradníci", "náhradníků") + ")" : ""),
      h("span", null, "Nejde ", h("b", { class: "num", text: String(c.no) })),
      h("span", null, "Nehlásil se ", h("b", { class: "num", text: String(c.none) })))));

  const me = X.me;
  out.push(h("div", { class: "list" }, X.active.map(p => h("div", { class: "player" + (p.id === me ? " me" : "") },
    h("button", { type: "button", class: "pname", onclick: () => editPlayer(p), "aria-label": "Upravit hráče " + p.name },
      h("b", { text: p.name }), h("span", { text: p.id === me ? "to jsi ty · upravit" : "upravit" })),
    tri(m, p, false)))));

  const sd = D.subs.get(m.id) || {};
  out.push(h("div", { class: "card" }, h("h3", { text: "Náhradníci" }),
    h("p", { class: "hint", text: "Dopiš, kdo přijde navíc. Každý vyplněný náhradník se počítá jako hráč, který jde." }),
    h("div", { class: "subs", style: "margin-top:10px" }, [0, 1, 2].map(i => {
      const inp = h("input", { class: "input", id: "sub-" + m.id + "-" + i, maxlength: "40", autocomplete: "off", placeholder: "Jméno náhradníka", "aria-label": "Náhradník " + (i + 1) });
      inp.value = typeof sd["s" + i] === "string" ? sd["s" + i] : "";
      const mark = h("span", { class: "saved", "aria-hidden": "true" });
      const save = async () => {
        const v = inp.value.trim().replace(/\s+/g, " ").slice(0, 40);
        if (v === (sd["s" + i] || "").trim()) return;
        try { await store.setSub(m.id, i, v); mark.textContent = "✓"; } catch (e) { toast("Náhradníka se nepodařilo uložit."); }
      };
      inp.addEventListener("change", save);
      inp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); inp.blur(); } });
      return h("label", null, h("span", { text: String(i + 1) }), inp, mark);
    }))));

  out.push(h("div", { class: "row" }, h("button", { type: "button", class: "btn ghost", onclick: addPlayer, text: "+ Přidat hráče" })));
  if (X.hidden.length) {
    out.push(h("details", { class: "more" }, h("summary", { text: "Skrytí hráči (" + X.hidden.length + ")" }),
      h("div", { class: "list", style: "margin-top:8px" }, X.hidden.map(p => h("div", { class: "player" },
        h("button", { type: "button", class: "pname", onclick: () => editPlayer(p) }, h("b", { text: p.name }), h("span", { text: "skrytý v docházce" })),
        h("button", { type: "button", class: "btn small ghost", onclick: async () => { try { await store.updatePlayer(p.id, { active: true }); } catch (e) { toast("Změna se nepovedla."); } }, text: "Vrátit" }))))));
  }
  return out;
}

/* ---------- pohled: Výsledky ---------- */
function outcomeOf(X, s) {
  const asc = X.seasons.slice().reverse();
  const i = asc.findIndex(x => x.id === s.id);
  const next = asc[i + 1];
  if (!next) return X.matches.some(m => m.season === s.id && !scoreOf(m)) ? { cls: "live", text: "Probíhá" } : { cls: "stay", text: "Sezóna skončila" };
  if (next.level < s.level) return { cls: "up", text: "Postup do " + next.level + ". ligy" };
  if (next.level > s.level) return { cls: "down", text: "Sestup do " + next.level + ". ligy" };
  return { cls: "stay", text: "Zůstali v " + s.level + ". lize" };
}
function goalsText(X, m) {
  const goals = m.goals || [];
  if (!goals.length) return scoreOf(m) && result(m).gf === 0 ? "Bez gólu" : "";
  const by = new Map();
  for (const g of goals) { const k = g.name || "_og"; if (!by.has(k)) by.set(k, []); by.get(k).push(g.min); }
  return "Góly: " + [...by.entries()].sort((a, b) => b[1].length - a[1].length || a[1][0] - b[1][0])
    .map(([k, mins]) => (k === "_og" ? "vlastní gól soupeře" : surname(displayName(X, k))) + (mins.length > 1 ? " " + mins.length + "×" : "") + " (" + mins.map(x => x + ".").join(", ") + ")").join(", ");
}
function matchDetails(m, X) {
  const r = result(m);
  const det = h("details", { class: "match", open: UI.open.has(m.id) });
  det.addEventListener("toggle", () => { if (det.open) UI.open.add(m.id); else UI.open.delete(m.id); });
  const gt = r ? goalsText(X, m) : "";
  det.append(h("summary", null, h("div", { class: "item" },
    h("div", { class: "date" }, h("b", { text: fmtDate(m) }), h("span", { text: (m.time || "") + (m.venue ? " · " + m.venue : "") })),
    h("div", { class: "grow" }, h("div", { class: "teams-line" }, teamsLine(m)), h("div", { class: "small ellipsis", text: gt || roundLabel(m) })),
    r ? h("div", { class: "score num", text: scoreOf(m) }) : h("div", { class: "small", text: relDays(m) }),
    r ? h("span", { class: "res res-" + r.r, title: RES_WORD[r.r], text: r.r }) : null)));
  const body = h("div", { class: "detail" });
  body.append(h("p", null, h("span", { class: "lbl", text: roundLabel(m) + " · " }), fmtLong(m) + (m.time ? " v " + m.time : "") + (m.venue ? ", hřiště " + m.venue : "")));
  if (r) {
    body.append(h("p", null, h("span", { class: "lbl", text: "Výsledek: " }), scoreOf(m) + (htOf(m) ? " (poločas " + htOf(m) + ")" : "") + (m.forfeit ? ", kontumace" : "") + (m.override ? " · opraveno ručně" : "")));
    if (gt) body.append(h("p", { text: gt }));
    if (m.lineup && m.lineup.length) {
      body.append(h("p", null, h("span", { class: "lbl", text: "Sestava (" + m.lineup.length + "): " }),
        m.lineup.map((l, i) => [i ? ", " : "", displayName(X, l.name), l.gk ? " (brankář)" : "", l.captain ? " (K)" : "", l.best ? " ★" : ""])));
    }
    if (m.cards && m.cards.length) body.append(h("p", null, h("span", { class: "lbl", text: "Karty: " }),
      m.cards.map((c, i) => [i ? ", " : "", h("i", { class: c.color === "red" ? "card-r" : "card-y", "aria-hidden": "true" }), displayName(X, c.name) + (c.min ? " " + c.min + "." : "") + (c.color === "red" ? " (červená)" : c.color === "yellow" ? " (žlutá)" : "")])));
    if (m.report) body.append(h("p", null, h("span", { class: "lbl", text: "Popis: " }), m.report));
    if (m.referee) body.append(h("p", null, h("span", { class: "lbl", text: "Rozhodčí: " }), m.referee));
    if (m.lineup && m.lineup.length) body.append(h("p", { class: "small", text: "★ nejlepší hráč zápasu, (K) kapitán, podle zápisu PSMF" }));
  }
  if (m.ourColor) body.append(h("p", null, h("span", { class: "lbl", text: "Dresy: " }), "my " + m.ourColor + (m.oppColor ? ", soupeř " + m.oppColor : "")));
  body.append(h("div", { class: "row" }, h("button", { type: "button", class: "btn small ghost", onclick: () => editScore(m), text: r ? "Opravit výsledek" : "Zadat výsledek ručně" })));
  det.append(body);
  return det;
}
function viewResults(X, sid) {
  if (!X.seasons.length) return [h("div", { class: "card" }, h("h3", { text: "Zatím bez dat" }), h("p", { text: "Výsledky se načtou po prvním stažení z PSMF." }))];
  const s = X.seasons.find(x => x.id === sid) || X.seasons.find(x => x.id === X.current) || X.seasons[0];
  const out = [];
  out.push(h("nav", { class: "chips", "aria-label": "Výběr sezóny" }, X.seasons.map(x => h("a", { class: "chip", href: "#vysledky/" + x.id, "aria-current": String(x.id === s.id) },
    h("b", { text: x.label }), h("span", { text: x.level + ". liga · " + x.group })))));
  const us = s.us || (s.table || []).find(r => r.us) || null;
  const oc = outcomeOf(X, s);
  const place = s.finalPlace || (us && us.pos);
  out.push(h("div", { class: "season-sum" },
    h("div", null, h("b", { class: "num", text: place ? place + "." : "–" }), h("span", { text: s.finalPlace ? "konečné místo" : "místo" })),
    h("div", null, h("b", { class: "num", text: us ? us.v + "–" + us.r + "–" + us.p : "–" }), h("span", { text: "V–R–P" })),
    h("div", null, h("b", { class: "num", text: us ? us.score : "–" }), h("span", { text: "skóre" })),
    h("div", null, h("b", { class: "num", text: us ? String(us.pts) : "–" }), h("span", { text: "bodů" }))));
  out.push(h("div", { class: "row" }, h("span", { class: "out " + oc.cls, text: oc.text }),
    h("a", { class: "small", href: s.url, target: "_blank", rel: "noopener", text: "Skupina " + s.group + " na psmf.cz" })));

  const ms = X.matches.filter(m => m.season === s.id);
  const up = ms.filter(m => !scoreOf(m));
  const played = ms.filter(m => scoreOf(m)).reverse();
  if (ms.length) out.push(h("h2", { class: "section-title", text: "Zápasy" }), h("div", { class: "list" }, up.concat(played).map(m => matchDetails(m, X))));
  if (s.table && s.table.length > 1) {
    out.push(h("h2", { class: "section-title", text: "Tabulka skupiny " + s.group }),
      h("div", { class: "list scroll-x", style: "padding:4px 8px" }, h("table", { class: "standings" },
        h("thead", null, h("tr", null, ["#", "Tým", "Z", "V–R–P", "Skóre", "B"].map(t => h("th", { scope: "col", text: t })))),
        h("tbody", null, s.table.map(r => h("tr", { class: r.us ? "us" : null },
          h("td", { class: "num", text: r.pos + "." }), h("td", { text: r.team }), h("td", { class: "num", text: String(r.z) }),
          h("td", { class: "num", text: r.v + "–" + r.r + "–" + r.p }), h("td", { class: "num", text: r.score }), h("td", { class: "num", text: String(r.pts) })))))),
      s.finalPlace && us && s.finalPlace !== us.pos ? h("p", { class: "hint", text: "Tabulka je seřazená podle skóre. Konečné pořadí podle PSMF (rozhodují vzájemné zápasy) je " + s.finalPlace + ". místo." }) : null);
  }
  return out;
}

/* ---------- pohled: Hráči ---------- */
function computeStats(X, seasonIds) {
  const rows = new Map();
  const add = name => { if (!rows.has(name)) rows.set(name, { name, z: 0, g: 0, best: 0, y: 0, r: 0 }); return rows.get(name); };
  let played = 0;
  for (const m of X.matches) {
    if (!seasonIds.includes(m.season) || !m.lineup || !m.lineup.length) continue;
    played++;
    for (const l of m.lineup) { const r = add(l.name); r.z++; if (l.best) r.best++; }
    for (const g of (m.goals || [])) if (g.name) add(g.name).g++;
    for (const c of (m.cards || [])) { const r = add(c.name); if (c.color === "red") r.r++; else r.y++; }
  }
  for (const p of X.active) if (p.psmfName && !rows.has(p.psmfName)) add(p.psmfName);
  return { rows: [...rows.values()], played };
}
function viewPlayers(X) {
  const out = [];
  if (!X.seasons.length) return [h("div", { class: "card" }, h("p", { text: "Statistiky se načtou po prvním stažení z PSMF." }))];
  const ids = UI.statSeason === "all" ? X.seasons.map(s => s.id) : [UI.statSeason];
  out.push(h("nav", { class: "chips", "aria-label": "Období" },
    [{ id: "all", label: "2 roky", sub: X.seasons.length + " sezón" }].concat(X.seasons.map(s => ({ id: s.id, label: s.label, sub: s.level + ". liga" })))
      .map(o => h("button", { type: "button", class: "chip", "aria-current": String(UI.statSeason === o.id), onclick: () => { UI.statSeason = o.id; render(); } },
        h("b", { text: o.label }), h("span", { text: o.sub })))));
  const { rows, played } = computeStats(X, ids);
  const top = rows.filter(r => r.g > 0).sort((a, b) => b.g - a.g || b.z - a.z).slice(0, 3);
  if (top.length) out.push(h("div", { class: "tops" }, top.map(r => h("div", { class: "top" },
    h("span", { class: "g num", text: String(r.g) }), h("span", { class: "n", text: displayName(X, r.name) }), h("span", { class: "s", text: plural(r.g, "gól", "góly", "gólů") + " · " + r.z + " " + plural(r.z, "zápas", "zápasy", "zápasů") })))));
  const key = UI.sort;
  const val = r => key === "z" || key === "u" ? r.z : key === "b" ? r.best : key === "y" ? r.y : r.g;
  const sorted = rows.slice().sort((a, b) => key === "n" ? surname(displayName(X, a.name)).localeCompare(surname(displayName(X, b.name)), "cs") : (val(b) - val(a) || b.g - a.g || b.z - a.z));
  const meP = X.me && X.players.find(p => p.id === X.me);
  const th = (k, label, title) => h("th", { scope: "col" }, h("button", { type: "button", "aria-pressed": String(key === k), title, onclick: () => { UI.sort = k; render(); }, text: label }));
  out.push(h("div", { class: "list scroll-x", style: "padding:4px 8px" }, h("table", { class: "stats" },
    h("thead", null, h("tr", null, th("n", "Hráč", "Řadit podle jména"), th("z", "Z", "Zápasy"), th("g", "G", "Góly"), th("b", "★", "Nejlepší hráč zápasu"), th("y", "ŽK", "Žluté karty"), th("u", "Účast", "Podíl zápasů"))),
    h("tbody", null, sorted.map(r => h("tr", { class: meP && meP.psmfName === r.name ? "me" : null },
      h("td", { text: displayName(X, r.name) }), h("td", { class: "num", text: String(r.z) }), h("td", { class: "num", text: String(r.g) }),
      h("td", { class: "num", text: String(r.best) }), h("td", { class: "num", text: String(r.y + r.r) }),
      h("td", { class: "num", text: played ? Math.round(r.z / played * 100) + " %" : "–" })))))));
  out.push(h("p", { class: "hint", text: "Podle zápisů PSMF, " + played + " " + plural(played, "zápas", "zápasy", "zápasů") + " se sestavou. ★ = nejlepší hráč zápasu. Kontumace bez sestavy se nepočítají." }));
  if (X.seasons.length > 1) out.push(h("h2", { class: "section-title", text: "Cesta ligami" }), ladder(X));
  return out;
}
function ladder(X) {
  const chron = X.seasons.slice().reverse();
  const levels = [...new Set(chron.map(s => s.level))].sort((a, b) => a - b);
  const W = 420, rowH = 52, top = 40, H = top + rowH * (levels.length - 1) + 46;
  const x0 = 84, x1 = 392, step = chron.length > 1 ? (x1 - x0) / (chron.length - 1) : 0;
  const NS = "http://www.w3.org/2000/svg";
  const sv = (t, a, txt) => { const e = document.createElementNS(NS, t); for (const [k, v] of Object.entries(a)) e.setAttribute(k, v); if (txt != null) e.textContent = txt; return e; };
  const yOf = lv => top + levels.indexOf(lv) * rowH;
  const svg = sv("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": chron.map(s => s.label + ": " + s.level + ". liga, " + (s.finalPlace || (s.us && s.us.pos) || "?") + ". místo").join("; ") });
  for (const lv of levels) { svg.append(sv("line", { class: "guide", x1: x0 - 22, x2: W - 6, y1: yOf(lv), y2: yOf(lv) }), sv("text", { class: "lv", x: 2, y: yOf(lv) + 5 }, lv + ". LIGA")); }
  const pts = chron.map((s, i) => ({ x: x0 + i * step, y: yOf(s.level), s }));
  let d = "M" + pts[0].x + "," + pts[0].y;
  for (let i = 1; i < pts.length; i++) { const mid = (pts[i - 1].x + pts[i].x) / 2; d += " H" + mid + " V" + pts[i].y + " H" + pts[i].x; }
  svg.append(sv("path", { class: "path", d }));
  pts.forEach((p, i) => {
    const place = p.s.finalPlace || (p.s.us && p.s.us.pos);
    svg.append(sv("circle", { class: "dot" + (i === pts.length - 1 ? " now" : ""), cx: p.x, cy: p.y, r: 7 }));
    if (place) svg.append(sv("text", { class: "pl", x: p.x, y: p.y - 15, "text-anchor": "middle" }, place + "."));
    svg.append(sv("text", { x: p.x, y: H - 10, "text-anchor": "middle" }, p.s.label.replace("Podzim ", "Podz. ").replace(/20(\d\d)$/, "$1")));
  });
  return h("div", { class: "card ladder" }, svg);
}

/* ---------- pohled: Nastavení ---------- */
function viewSettings(X) {
  const out = [h("h1", { class: "section-title", text: "Nastavení" })];
  const sel = h("select", { class: "input", id: "who2", onchange: e => chooseMe(e.target.value) },
    h("option", { value: "", text: "Nevybráno" }), X.active.map(p => h("option", { value: p.id, text: p.name, selected: p.id === X.me })));
  out.push(h("div", { class: "card" }, h("h3", { text: "Kdo jsi" }), h("p", { class: "hint", text: "Podle toho aplikace ví, za koho se hlásíš na hlavní obrazovce." }),
    h("label", { class: "sr", for: "who2", text: "Kdo jsi" }), sel));

  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const pushBody = [];
  if (store.mode === "demo") pushBody.push(h("p", { text: "V ukázkovém režimu připomínky nefungují. Zapnou se po nastavení Firebase podle návodu." }));
  else if (UI.pushOn) pushBody.push(h("p", { text: "Zapnuté. Ve 12:00 tři, dva a jeden den před zápasem ti přijde upozornění." }),
    h("button", { class: "btn ghost", type: "button", onclick: async () => { await store.disablePush(); UI.pushOn = false; toast("Připomínky jsou vypnuté."); render(); }, text: "Vypnout připomínky" }));
  else if (IS_SAMSUNG) pushBody.push(samsungNote());
  else if (ios && !standalone) pushBody.push(h("p", { text: "Na iPhonu nejdřív přidej aplikaci na plochu (Safari → Sdílet → Přidat na plochu) a otevři ji odtamtud. Pak tu připomínky zapneš." }));
  else if (!UI.pushSupported) pushBody.push(h("p", { text: "Tenhle prohlížeč upozornění nepodporuje. Zkus Chrome na Androidu nebo Safari na iPhonu (iOS 16.4 a novější)." }));
  else pushBody.push(h("p", { text: "Ve 12:00 tři, dva a jeden den před zápasem ti přijde upozornění." }), h("button", { class: "btn", type: "button", onclick: enablePush, text: "Zapnout připomínky" }), pushStatus());
  out.push(h("div", { class: "card" }, h("h3", { text: "Připomínky" }), pushBody));

  const inst = [h("h3", { text: "Aplikace na ploše" })];
  if (standalone) inst.push(h("p", { text: "Aplikaci máš nainstalovanou." }));
  else {
    if (UI.installEvt) inst.push(h("p", { text: "Přidej si aplikaci na plochu, otevře se jako běžná aplikace." }),
      h("button", { class: "btn", type: "button", onclick: async () => { UI.installEvt.prompt(); await UI.installEvt.userChoice; UI.installEvt = null; render(); }, text: "Nainstalovat" }));
    inst.push(h("p", { class: "hint", text: "iPhone: v Safari klepni na Sdílet a pak na Přidat na plochu." }),
      h("p", { class: "hint", text: "Android: v Chromu otevři nabídku ⋮ a zvol Přidat na plochu (nebo Instalovat aplikaci)." }));
  }
  out.push(h("div", { class: "card" }, inst));

  const share = async () => {
    const url = location.origin + location.pathname;
    try { if (navigator.share) await navigator.share({ title: TEAM, text: "Docházka a zápasy " + TEAM, url }); else { await navigator.clipboard.writeText(url); toast("Odkaz zkopírován."); } } catch (e) {}
  };
  out.push(h("div", { class: "card" }, h("h3", { text: "Pozvat spoluhráče" }), h("p", { text: "Pošli týmu odkaz na aplikaci. Nikdo se nemusí registrovat." }),
    h("button", { class: "btn ghost", type: "button", onclick: share, text: "Sdílet odkaz" })));

  const cfg = D.config || {};
  const cur = X.seasons.find(s => s.id === X.current);
  const last = cfg.lastSync ? new Date(cfg.lastSync) : null;
  out.push(h("div", { class: "card" }, h("h3", { text: "Data z PSMF" }),
    h("p", { text: last ? "Naposledy staženo " + last.getDate() + ". " + (last.getMonth() + 1) + ". v " + last.getHours() + ":" + String(last.getMinutes()).padStart(2, "0") + "." : "Zatím nestaženo." }),
    cfg.syncError ? h("p", { style: "color:var(--no)", text: "Poslední stažení selhalo: " + cfg.syncError }) : null,
    h("p", { class: "hint", text: "Rozpis, výsledky, sestavy a tabulku stahuje automat z psmf.cz několikrát denně." }),
    cur ? h("a", { href: cur.url, target: "_blank", rel: "noopener", text: "Stránka týmu na psmf.cz" }) : null));
  out.push(h("p", { class: "hint", style: "text-align:center", text: store.mode === "demo" ? "Ukázkový režim" : "Hulla hulla FC" }));
  return out;
}

/* ---------- vykreslení ---------- */
function route() {
  const raw = decodeURIComponent((location.hash || "").replace(/^#/, ""));
  const [name, arg] = raw.split("/");
  if (name === "zapas") return { name: "dochazka", arg };
  if (["dochazka", "vysledky", "hraci", "nastaveni", "zapasy"].includes(name)) return { name, arg };
  return { name: "zapasy" };
}
function render() {
  UI.pending = false;
  const main = $("#view");
  if (UI.fatal) { main.replaceChildren(UI.fatal); return; }
  if (!D || !store) return;
  const ae = document.activeElement;
  if (ae && main.contains(ae) && ae.tagName === "INPUT") { UI.pending = true; return; }
  const focusId = ae && main.contains(ae) ? ae.id : null;
  const X = derive();
  const r = route();
  document.querySelectorAll(".tabbar a").forEach(a => { if (a.dataset.tab === r.name) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  const sl = $("#settings-link"); if (r.name === "nastaveni") sl.setAttribute("aria-current", "page"); else sl.removeAttribute("aria-current");
  const cur = X.seasons.find(s => s.id === X.current);
  $("#brand-sub").textContent = cur ? "Hanspaulská liga · " + cur.group + " · " + cur.label : "Hanspaulská liga";
  const banner = $("#banner"); banner.replaceChildren();
  if (store.mode === "demo") banner.append(h("div", { class: "banner", text: "Ukázkový režim: změny se neukládají. Naostro to poběží po nastavení podle návodu." }));
  else if (D.error) banner.append(h("div", { class: "banner err", text: "Data se nepodařilo načíst (" + D.error + "). Zkontroluj připojení." }));
  let content;
  if (r.name === "dochazka") content = viewAttendance(X, r.arg);
  else if (r.name === "vysledky") content = viewResults(X, r.arg);
  else if (r.name === "hraci") content = viewPlayers(X);
  else if (r.name === "nastaveni") content = viewSettings(X);
  else content = viewHome(X);
  main.replaceChildren(...[].concat(content).flat(Infinity).filter(x => x instanceof Node));
  if (focusId) { const f = document.getElementById(focusId); if (f) f.focus({ preventScroll: true }); }
}
let raf = 0;
function scheduleRender() { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; render(); }); }
document.addEventListener("focusout", () => { if (UI.pending) setTimeout(() => { if (UI.pending) render(); }, 0); });
window.addEventListener("hashchange", () => { closeSheet(); render(); window.scrollTo(0, 0); });
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); UI.installEvt = e; });

async function boot() {
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("./sw.js").catch(() => {});
  try {
    store = await createStore(CFG, data => { D = data; scheduleRender(); }, payload => {
      const n = (payload && payload.notification) || {};
      if (n.title) toast(n.title);
    });
    UI.pushSupported = await store.pushSupported();
    render();
  } catch (e) {
    console.error(e);
    UI.fatal = h("div", { class: "card" }, h("h3", { text: "Aplikaci se nepodařilo spustit" }),
      h("p", { text: "Zkontroluj připojení k internetu a nastavení v souboru config.js. Podrobnosti: " + (e && (e.code || e.message) || e) }),
      h("button", { class: "btn", type: "button", onclick: () => location.reload(), text: "Zkusit znovu" }));
    render();
  }
}
boot();

/*
 * Hulla hulla FC – synchronizace z psmf.cz a připomínky zápasů.
 *
 * Spouští ho GitHub Actions několikrát denně:
 *  1. najde aktuální stránku týmu na psmf.cz (vyhledávání „Najdi svůj tým“),
 *  2. stáhne rozpis, výsledky, sestavy, góly, karty a tabulku skupiny do Firestore,
 *  3. po 12:00 pražského času pošle jednou denně připomínku všem hráčům
 *     3, 2 a 1 den před každým zápasem.
 *
 * Volby:
 *   --dry      jen stáhne a vypíše data, nic nezapisuje (nepotřebuje Firebase)
 *   --notify   pošle připomínku hned (test), i když není poledne
 * Proměnné prostředí:
 *   FIREBASE_SERVICE_ACCOUNT  JSON klíč servisního účtu Firebase (tajný)
 *   APP_URL                   adresa aplikace, např. https://jmeno.github.io/hulla-hulla/
 *   FORCE_NOTIFY=true         totéž co --notify
 */
"use strict";
const { JSDOM } = require("jsdom");
const PSMF = require("./psmf");
const CONF = require("./seasons.json");

const BASE = "https://www.psmf.cz";
const TEAM = CONF.team;
const SLUG = CONF.slug;
const TZ = "Europe/Prague";
const NOTIFY_HOUR = 12;
const REMIND_DAYS = [3, 2, 1];
const DRY = process.argv.includes("--dry");
const FORCE_NOTIFY = process.argv.includes("--notify") || process.env.FORCE_NOTIFY === "true";
const APP_URL = (process.env.APP_URL || "").trim().replace(/([^/])$/, "$1/");

const sleep = ms => new Promise(r => setTimeout(r, ms));
const DAYS = ["ne", "po", "út", "st", "čt", "pá", "so"];

async function fetchDoc(path) {
  const url = /^https?:/.test(path) ? path : BASE + path;
  const res = await fetch(url, { headers: { "User-Agent": "HullaHullaFC-tymova-aplikace/1.0", "Accept-Language": "cs" } });
  if (!res.ok) throw new Error("psmf.cz vrátil " + res.status + " pro " + url);
  const html = await res.text();
  return { doc: new JSDOM(html).window.document, url: res.url };
}

/* Najde stránku týmu v nejnovější sezóně přes vyhledávání na psmf.cz */
async function discoverCurrent() {
  try {
    const { doc, url } = await fetchDoc("/vyhledavani/?query=" + encodeURIComponent(TEAM));
    const found = PSMF.findTeamLinks(doc, SLUG);
    const direct = PSMF.seasonFromUrl(url);
    if (direct && url.includes("/tymy/" + SLUG + "/")) found.push({ url: new URL(url).pathname, season: direct });
    found.sort((a, b) => b.season.sortKey - a.season.sortKey);
    return found[0] || null;
  } catch (e) {
    console.warn("Vyhledání týmu na psmf.cz selhalo:", e.message);
    return null;
  }
}

function pragueNow() {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(new Date()).map(x => [x.type, x.value]));
  return { date: p.year + "-" + p.month + "-" + p.day, hour: +p.hour };
}
function dayDiff(from, to) {
  const a = from.split("-").map(Number), b = to.split("-").map(Number);
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000);
}
function fmtDay(date) {
  const [y, m, d] = date.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return DAYS[wd] + " " + d + ". " + m + ".";
}
function slugify(s) {
  return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "hrac";
}
function stripUndefined(o) { return JSON.parse(JSON.stringify(o)); }

function initFirebase() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("Chybí tajný klíč FIREBASE_SERVICE_ACCOUNT (nastav ho v GitHubu: Settings → Secrets and variables → Actions).");
  let cred;
  try { cred = JSON.parse(raw); } catch (e) { throw new Error("FIREBASE_SERVICE_ACCOUNT není platný JSON. Vlož do tajemství celý obsah staženého souboru s klíčem."); }
  const admin = require("firebase-admin");
  admin.initializeApp({ credential: admin.credential.cert(cred) });
  const db = admin.firestore();
  db.settings({ ignoreUndefinedProperties: true });
  return { admin, db };
}

/* ---------- 1. a 2.: stažení a uložení dat ---------- */
async function syncSeasons(db) {
  const known = CONF.seasons.map(s => Object.assign({}, s, { season: PSMF.seasonFromUrl(s.url) })).filter(s => s.season);
  const cfgRef = db && db.doc("config/app");
  const cfg = db ? ((await cfgRef.get()).data() || {}) : {};

  let current = await discoverCurrent();
  if (!current && cfg.currentUrl) current = { url: cfg.currentUrl, season: PSMF.seasonFromUrl(cfg.currentUrl) };
  if (!current) current = known[known.length - 1];
  console.log("Aktuální sezóna:", current.season.label, current.season.group, current.url);

  const list = new Map(known.map(s => [s.season.id, s]));
  // sezóny z databáze, které ještě mají neodehrané zápasy (např. konec minulé části), se stahují dál
  if (db) {
    const open = await db.collection("seasons").where("hasUpcoming", "==", true).get();
    for (const d of open.docs) {
      const v = d.data();
      const path = String(v.url || "").replace(/^https?:\/\/[^/]+/, "");
      const season = PSMF.seasonFromUrl(path);
      if (season && !list.has(season.id)) list.set(season.id, { url: path, season, finalPlace: v.finalPlace || undefined });
    }
  }
  if (!list.has(current.season.id)) list.set(current.season.id, { url: current.url, season: current.season });
  else list.get(current.season.id).url = current.url;

  const seasonsSorted = Array.from(list.values()).sort((a, b) => a.season.sortKey - b.season.sortKey);
  const results = [];
  for (const s of seasonsSorted) {
    let stored = null;
    if (db) stored = (await db.doc("seasons/" + s.season.id).get()).data() || null;
    const needed = s.season.id === current.season.id || !stored || !stored.imported || stored.hasUpcoming;
    if (!needed) continue;
    console.log("Stahuji", s.season.label, s.url);
    const { doc } = await fetchDoc(s.url);
    const parsed = PSMF.parseTeamPage(doc, s.url, TEAM);
    const played = parsed.matches.filter(m => m.score).length;
    const upcoming = parsed.matches.filter(m => !m.score).length;
    if (!parsed.matches.length) throw new Error("Na stránce " + s.url + " jsem nenašel žádné zápasy. Možná se změnil vzhled webu PSMF.");
    console.log("  zápasů:", parsed.matches.length, "odehráno:", played, "čeká:", upcoming, "sestavy:", parsed.matches.filter(m => m.lineup && m.lineup.length).length);
    results.push({ meta: s, parsed });
    await sleep(800);
  }

  if (!db) return { current, results };

  for (const { meta, parsed } of results) {
    const sid = parsed.season.id;
    const batch = db.batch();
    const ids = new Set();
    for (const m of parsed.matches) {
      const id = sid + "-" + m.key;
      ids.add(id);
      batch.set(db.doc("matches/" + id), stripUndefined({
        season: sid, key: m.key, round: m.round, date: m.date, time: m.time || null, venue: m.venue || null,
        home: m.home, opp: m.opp, score: m.score || null, ht: m.ht || null, forfeit: !!m.forfeit, gameId: m.gameId || null,
        ourColor: m.ourColor || null, oppColor: m.oppColor || null, report: m.report || null, referee: m.referee || null,
        lineup: m.lineup || [], goals: m.goals || [], cards: m.cards || [], updatedAt: new Date().toISOString()
      }), { merge: true });
    }
    const us = parsed.table.find(r => r.us) || null;
    batch.set(db.doc("seasons/" + sid), stripUndefined({
      id: sid, label: parsed.season.label, year: parsed.season.year, half: parsed.season.half, level: parsed.season.level,
      group: parsed.season.group, sortKey: parsed.season.sortKey, url: BASE + meta.url,
      table: parsed.table, us, finalPlace: meta.finalPlace || null,
      imported: true, hasUpcoming: parsed.matches.some(m => !m.score), updatedAt: new Date().toISOString()
    }), { merge: true });
    await batch.commit();

    // zrušené zápasy bez výsledku, které už na PSMF nejsou
    const old = await db.collection("matches").where("season", "==", sid).get();
    for (const d of old.docs) if (!ids.has(d.id) && !d.data().score) { console.log("  mažu zrušený zápas", d.id); await d.ref.delete(); }
  }

  await ensurePlayers(db);
  await cfgRef.set({ currentSeason: current.season.id, currentUrl: current.url, lastSync: new Date().toISOString(), syncError: null }, { merge: true });
  return { current, results };
}

/* Hráče ze sestav posledních dvou sezón přidá do soupisky, pokud tam ještě nejsou */
async function ensurePlayers(db) {
  const seasons = (await db.collection("seasons").get()).docs.map(d => d.data()).sort((a, b) => b.sortKey - a.sortKey).slice(0, 2);
  const names = new Set();
  for (const s of seasons) {
    const ms = await db.collection("matches").where("season", "==", s.id).get();
    for (const d of ms.docs) for (const l of (d.data().lineup || [])) if (l && l.name) names.add(l.name);
  }
  const players = (await db.collection("players").get()).docs;
  const knownNames = new Set(players.map(d => d.data().psmfName).filter(Boolean));
  const ids = new Set(players.map(d => d.id));
  for (const n of names) {
    if (knownNames.has(n)) continue;
    let id = slugify(n);
    while (ids.has(id)) id = slugify(n) + "-" + Math.random().toString(36).slice(2, 6);
    ids.add(id);
    await db.doc("players/" + id).set({ name: n, psmfName: n, active: true, createdAt: new Date().toISOString(), auto: true });
    console.log("  nový hráč v soupisce:", n);
  }
}

/* ---------- 3.: připomínky ---------- */
async function sendReminders(db, admin) {
  const now = pragueNow();
  const cfgRef = db.doc("config/app");
  const cfg = (await cfgRef.get()).data() || {};
  if (!FORCE_NOTIFY) {
    if (now.hour < NOTIFY_HOUR) { console.log("Připomínky: ještě není " + NOTIFY_HOUR + ":00 (" + now.hour + " h)."); return; }
    if (cfg.lastNotify === now.date) { console.log("Připomínky: dnes už odeslány."); return; }
  }

  const upcoming = (await db.collection("matches").where("score", "==", null).get()).docs
    .map(d => Object.assign({ id: d.id }, d.data()))
    .filter(m => m.date >= now.date)
    .sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
  let due = upcoming.map(m => Object.assign(m, { inDays: dayDiff(now.date, m.date) })).filter(m => REMIND_DAYS.includes(m.inDays));
  let test = false;
  if (!due.length && FORCE_NOTIFY && upcoming.length) { due = [upcoming[0]]; due[0].inDays = dayDiff(now.date, due[0].date); test = true; }

  const tokensSnap = await db.collection("tokens").get();
  const tokens = tokensSnap.docs.map(d => d.id);
  console.log("Připomínky: zápasů k připomenutí", due.length, "zařízení", tokens.length);

  if (due.length && tokens.length) {
    const players = (await db.collection("players").get()).docs.map(d => Object.assign({ id: d.id }, d.data())).filter(p => p.active !== false);
    const activeIds = new Set(players.map(p => p.id));
    for (const m of due) {
      const att = await db.collection("attendance").where("match", "==", m.id).get();
      const yes = att.docs.filter(d => d.data().status === "yes" && activeIds.has(d.data().player)).length;
      const subsDoc = (await db.doc("subs/" + m.id).get()).data() || {};
      const subs = ["s0", "s1", "s2"].filter(k => typeof subsDoc[k] === "string" && subsDoc[k].trim()).length;
      const going = yes + subs;
      const when = m.inDays === 0 ? "Dnes" : m.inDays === 1 ? "Zítra" : m.inDays === 2 ? "Pozítří" : "Za " + m.inDays + (m.inDays < 5 ? " dny" : " dní");
      const teams = m.home ? TEAM + " – " + m.opp : m.opp + " – " + TEAM;
      const title = (test ? "Test: " : "") + when + " hrajeme: " + teams;
      const body = fmtDay(m.date) + (m.time ? " v " + m.time : "") + (m.venue ? ", hřiště " + m.venue : "") + ". "
        + "Jde zatím " + going + " z " + (players.length + subs) + ". "
        + (m.ourColor ? "Dresy: " + m.ourColor + ". " : "")
        + "Ťukni a dej vědět, jestli dorazíš.";
      const message = {
        notification: { title, body },
        data: { match: m.id },
        webpush: {
          notification: { icon: APP_URL ? APP_URL + "icons/icon-192.png" : undefined, badge: APP_URL ? APP_URL + "icons/badge-96.png" : undefined, tag: m.id + "-" + now.date, renotify: true },
          fcmOptions: APP_URL ? { link: APP_URL + "#zapas/" + m.id } : undefined
        }
      };
      await sendToAll(db, admin, tokens, stripUndefined(message));
      console.log("  odesláno:", title, "|", body);
    }
  }
  if (!FORCE_NOTIFY) await cfgRef.set({ lastNotify: now.date }, { merge: true });
}

async function sendToAll(db, admin, tokens, message) {
  for (let i = 0; i < tokens.length; i += 500) {
    const chunk = tokens.slice(i, i + 500);
    const res = await admin.messaging().sendEachForMulticast(Object.assign({ tokens: chunk }, message));
    for (let j = 0; j < res.responses.length; j++) {
      const r = res.responses[j];
      if (!r.success) {
        const code = r.error && r.error.code;
        if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token" || code === "messaging/invalid-argument") {
          await db.doc("tokens/" + chunk[j]).delete().catch(() => {});
        } else console.warn("  chyba doručení:", code);
      }
    }
    console.log("  doručeno", res.successCount, "z", chunk.length);
  }
}

async function main() {
  if (DRY) {
    const { results } = await syncSeasons(null);
    for (const { parsed } of results) {
      console.log("\n" + parsed.season.label, parsed.season.group);
      for (const m of parsed.matches) console.log(" ", m.key, m.date, m.time, m.home ? "doma" : "venku", m.opp, m.score || "–", (m.lineup || []).length + " hráčů", (m.goals || []).length + " gólů");
    }
    return;
  }
  const { admin, db } = initFirebase();
  try {
    await syncSeasons(db);
  } catch (e) {
    console.error("Synchronizace selhala:", e.message);
    await db.doc("config/app").set({ syncError: e.message.slice(0, 300), syncErrorAt: new Date().toISOString() }, { merge: true });
    process.exitCode = 1;
  }
  try {
    await sendReminders(db, admin);
  } catch (e) {
    console.error("Odeslání připomínek selhalo:", e.message);
    process.exitCode = 1;
  }
}

if (require.main === module) main();
module.exports = { dayDiff, fmtDay, slugify, pragueNow };

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
const ICS = require("./ics");
const fs = require("fs");
const path = require("path");
const ICS_DIR = process.env.ICS_DIR || path.join(__dirname, "..", "kalendar");
const MATCH_MINUTES = 90;
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
/* Ruční výsledek zapsaný dřív, než ho PSMF zveřejnilo (zápas tehdy ještě neměl skóre z PSMF), se po zveřejnění nahradí
   výsledkem z PSMF. Ruční oprava výsledku, který na PSMF už byl, zůstává, dokud ji někdo v aplikaci nevrátí. */
function shouldDropOverride(prev, psmfScore) {
  return !!(prev && prev.override && !prev.score && psmfScore);
}

async function writeSeason(db, meta, parsed) {
  const sid = parsed.season.id;
  const old = await db.collection("matches").where("season", "==", sid).get();
  const prevById = new Map(old.docs.map(d => [d.id, d.data()]));
  const batch = db.batch();
  const ids = new Set();
  for (const m of parsed.matches) {
    const id = sid + "-" + m.key;
    ids.add(id);
    const data = {
      season: sid, key: m.key, round: m.round, date: m.date, time: m.time || null, venue: m.venue || null,
      home: m.home, opp: m.opp, score: m.score || null, ht: m.ht || null, forfeit: !!m.forfeit, gameId: m.gameId || null,
      ourColor: m.ourColor || null, oppColor: m.oppColor || null, report: m.report || null, referee: m.referee || null,
      lineup: m.lineup || [], goals: m.goals || [], cards: m.cards || [], updatedAt: new Date().toISOString()
    };
    if (shouldDropOverride(prevById.get(id), m.score)) {
      data.override = null;
      console.log("  " + id + ": výsledek zapsaný ručně před zveřejněním nahrazuji výsledkem z PSMF " + m.score);
    }
    batch.set(db.doc("matches/" + id), stripUndefined(data), { merge: true });
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
  for (const d of old.docs) if (!ids.has(d.id) && !d.data().score) { console.log("  mažu zrušený zápas", d.id); await d.ref.delete(); }
}

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

  for (const { meta, parsed } of results) await writeSeason(db, meta, parsed);

  await ensurePlayers(db);
  const venues = await annotateVenues(db);
  await writeCalendarFiles(db, venues);
  await cfgRef.set({ currentSeason: current.season.id, currentUrl: current.url, lastSync: new Date().toISOString(), syncError: null }, { merge: true });
  return { current, results };
}

/* K nadcházejícím zápasům doplní název a adresu hřiště z psmf.cz/hriste/ (pro kalendář a navigaci) */
async function annotateVenues(db) {
  let venues;
  try { venues = PSMF.parseVenues((await fetchDoc("/hriste/")).doc); }
  catch (e) { console.warn("Seznam hřišť se nepodařilo stáhnout:", e.message); return null; }
  console.log("Hřišť v seznamu PSMF:", Object.keys(venues).length);
  const upcoming = await db.collection("matches").where("score", "==", null).get();
  for (const d of upcoming.docs) {
    const m = d.data();
    const v = m.venue && venues[String(m.venue).toUpperCase()];
    if (!v) { if (m.venue) console.log("  hřiště bez adresy:", m.venue); continue; }
    if (m.venueAddress === v.address && m.venueName === v.name && m.venueLat === v.lat) continue;
    await d.ref.set({ venueName: v.name, venueAddress: v.address, venueLat: v.lat, venueLng: v.lng }, { merge: true });
  }
  return venues;
}

/* Kalendářové soubory pro iPhone: kalendar/<zápas>.ics, na webu aplikace. Mění se jen, když se změní zápas. */
async function writeCalendarFiles(db, venues) {
  const seasons = Object.fromEntries((await db.collection("seasons").get()).docs.map(d => [d.id, d.data()]));
  const today = pragueNow().date;
  const upcoming = (await db.collection("matches").where("score", "==", null).get()).docs
    .map(d => Object.assign({ id: d.id }, d.data()))
    .filter(m => m.date >= today && m.time);
  fs.mkdirSync(ICS_DIR, { recursive: true });
  const stripStamp = t => t.replace(/^DTSTAMP:.*\r?\n/m, "");
  let changed = 0;
  for (const m of upcoming) {
    const v = m.venueAddress
      ? { name: m.venueName || "", address: m.venueAddress, lat: m.venueLat, lng: m.venueLng }
      : (venues && m.venue && venues[String(m.venue).toUpperCase()]) || null;
    const teams = m.home ? TEAM + " - " + m.opp : m.opp + " - " + TEAM;
    const start = ICS.pragueToDate(m.date, m.time);
    const season = seasons[m.season];
    const body = ICS.buildIcs({
      uid: m.id + "@hulla-hulla-fc",
      title: "Hanspaulka " + teams + (m.venue ? " (" + m.venue + ")" : ""),
      start, end: new Date(start.getTime() + MATCH_MINUTES * 60000),
      location: v ? v.address : "", lat: v ? v.lat : null, lng: v ? v.lng : null,
      description: [
        (m.round ? m.round + ". kolo" : "Zápas") + (season ? ", skupina " + season.group : ""),
        m.venue ? "Hřiště " + m.venue + (v && v.name ? " – " + v.name : "") : "",
        m.ourColor ? "Dresy: " + m.ourColor + (m.oppColor ? ", soupeř " + m.oppColor : "") : "",
        APP_URL ? "Docházka: " + APP_URL : ""
      ].filter(Boolean).join("\n")
    });
    const file = path.join(ICS_DIR, m.id + ".ics");
    if (fs.existsSync(file) && stripStamp(fs.readFileSync(file, "utf8")) === stripStamp(body)) continue;
    fs.writeFileSync(file, body);
    changed++;
  }
  // úklid: soubory zápasů starších než 30 dní
  const limit = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10).replace(/-/g, "");
  for (const f of fs.readdirSync(ICS_DIR)) {
    if (!f.endsWith(".ics")) continue;
    const m = fs.readFileSync(path.join(ICS_DIR, f), "utf8").match(/^DTSTART:(\d{8})/m);
    if (m && m[1] < limit) { fs.unlinkSync(path.join(ICS_DIR, f)); changed++; }
  }
  console.log("Kalendářové soubory: nové nebo změněné", changed, "z", upcoming.length);
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
module.exports = { dayDiff, fmtDay, slugify, pragueNow, writeCalendarFiles, ICS_DIR, shouldDropOverride, writeSeason };

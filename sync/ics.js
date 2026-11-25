/*
 * Kalendářové soubory (.ics) pro zápasy. Automat je ukládá do složky kalendar/,
 * odkud si je iPhone otevře z webu aplikace a nabídne „Přidat do kalendáře“.
 */
"use strict";

const TZ = "Europe/Prague";

/* Datum a čas podle pražského času → skutečný okamžik (UTC), správně i při změně letního času */
function pragueToDate(date, time) {
  const [y, mo, d] = date.split("-").map(Number);
  const [hh, mm] = (time || "12:00").split(":").map(Number);
  const want = Date.UTC(y, mo - 1, d, hh, mm);
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  let guess = want;
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(fmt.formatToParts(new Date(guess)).map(x => [x.type, x.value]));
    const shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    if (shown === want) break;
    guess += want - shown;
  }
  return new Date(guess);
}

function stamp(d) { return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); }

function text(v) {
  return String(v || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/* Řádky delší než 75 bajtů se podle normy lámou, aniž by se rozdělil znak s diakritikou */
function fold(line) {
  const out = [];
  let cur = "", bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch, "utf8");
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ""; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}

function buildIcs(e) {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Hulla hulla FC//Dochazka//CS", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    "UID:" + e.uid,
    "DTSTAMP:" + stamp(e.dtstamp || new Date()),
    "DTSTART:" + stamp(e.start),
    "DTEND:" + stamp(e.end),
    "SUMMARY:" + text(e.title),
    e.location ? "LOCATION:" + text(e.location) : null,
    (e.lat != null && e.lng != null) ? "GEO:" + e.lat + ";" + e.lng : null,
    e.description ? "DESCRIPTION:" + text(e.description) : null,
    "END:VEVENT", "END:VCALENDAR"
  ].filter(Boolean).map(fold);
  return lines.join("\r\n") + "\r\n";
}

module.exports = { pragueToDate, stamp, text, fold, buildIcs };

/*
 * Čtení stránky týmu na psmf.cz.
 * Pracuje nad standardním DOM, takže běží v prohlížeči i v Node (jsdom).
 * Výstup: sezóna, zápasy (výsledky, rozpis, sestavy, góly, karty) a tabulka skupiny.
 */
(function (root) {
  "use strict";

  function clean(s) {
    return String(s == null ? "" : s)
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/ /g, " ").replace(/\s+/g, " ").trim();
  }
  function parseDate(s) {
    const m = clean(s).match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{2,4})/);
    if (!m) return null;
    let y = +m[3]; if (y < 100) y += 2000;
    return y + "-" + String(+m[2]).padStart(2, "0") + "-" + String(+m[1]).padStart(2, "0");
  }
  function parseRound(s) { const m = clean(s).match(/(\d+)/); return m ? +m[1] : null; }
  function parseScore(s) { const m = clean(s).match(/(\d+)\s*:\s*(\d+)/); return m ? m[1] + ":" + m[2] : null; }
  function parseTime(s) { const m = clean(s).match(/(\d{1,2}):(\d{2})/); return m ? m[1].padStart(2, "0") + ":" + m[2] : null; }

  function seasonFromUrl(url) {
    const m = String(url || "").match(/souteze\/(\d{4})-([a-z-]+?)-(jaro|podzim)\/(\d+)-([a-z0-9]+)\//i);
    if (!m) return null;
    const year = +m[1], half = m[3].toLowerCase(), level = +m[4], grp = m[5].toUpperCase();
    return {
      id: year + (half === "jaro" ? "j" : "p"),
      year, half, level, group: level + grp, comp: m[2],
      label: (half === "jaro" ? "Jaro " : "Podzim ") + year,
      sortKey: year * 10 + (half === "jaro" ? 1 : 2)
    };
  }

  function ownRows(table) {
    return Array.from(table.querySelectorAll("tr")).filter(tr => tr.closest("table") === table);
  }
  function ownCells(tr) {
    if (!tr) return [];
    return Array.from(tr.children).filter(c => c.tagName === "TD" || c.tagName === "TH");
  }
  function teamLinks(td) {
    if (!td) return [];
    return Array.from(td.querySelectorAll("a"))
      .filter(a => !a.classList.contains("component__table-shirt") && /\/tymy\//.test(a.getAttribute("href") || ""))
      .map(a => clean(a.getAttribute("title") || a.textContent));
  }
  function shirtColors(td) {
    const out = {};
    if (!td) return out;
    td.querySelectorAll("a.component__table-shirt").forEach(a => {
      const t = clean(a.getAttribute("data-dctitle")), c = clean(a.getAttribute("data-dccolor") || a.getAttribute("title"));
      if (t && c) out[t] = c;
    });
    return out;
  }

  /* Tabulka zápasů: games-old-table (odehrané) nebo games-new-table (nadcházející) */
  function parseGames(table, team, played) {
    const out = [];
    if (!table) return out;
    for (const tr of ownRows(table)) {
      const c = ownCells(tr);
      if (c.length < 5 || c[0].tagName === "TH") continue;
      const date = parseDate(c[0].textContent);
      const teams = teamLinks(c[3]);
      if (!date || teams.length < 2) continue;
      const isHome = teams[0] === team;
      if (!isHome && teams[1] !== team) continue;
      const m = {
        date, time: parseTime(c[1].textContent), venue: clean(c[2].textContent) || null,
        home: isHome, opp: isHome ? teams[1] : teams[0], round: parseRound(c[4].textContent)
      };
      const colors = shirtColors(c[3]);
      if (colors[team]) m.ourColor = colors[team];
      if (colors[m.opp]) m.oppColor = colors[m.opp];
      if (played && c[5]) {
        const txt = clean(c[5].textContent);
        m.score = parseScore(txt);
        m.forfeit = /\bk\./.test(txt);
        const info = c[5].querySelector("[data-gameid]");
        if (info) m.gameId = info.getAttribute("data-gameid");
      }
      out.push(m);
    }
    return out;
  }

  function parseLineup(td) {
    if (!td) return [];
    const flags = new Map();
    td.querySelectorAll("span").forEach(sp => {
      const cls = sp.className || "";
      flags.set(clean(sp.textContent), { best: /is-best/.test(cls), captain: /captain/.test(cls) });
    });
    let text = clean(td.textContent).replace(/^[–-]\s*/, "");
    let gk = null, rest = text;
    const parts = text.split(/\s+[–]\s+|\s+-\s+/);
    if (parts.length >= 2) { gk = clean(parts[0]); rest = parts.slice(1).join(", "); }
    const names = [gk].concat(rest.split(",")).map(clean).filter(Boolean);
    return names.map((n, i) => {
      const f = flags.get(n) || {};
      return { name: n, gk: i === 0 && !!gk, best: !!f.best, captain: !!f.captain };
    });
  }

  function parseGoals(td) {
    if (!td) return [];
    const out = [];
    for (const chunk of td.innerHTML.split(/<br\s*\/?>/i)) {
      const line = clean(chunk.replace(/<[^>]+>/g, " "));
      if (!line) continue;
      const m = line.match(/^((?:\d+\.\s*,?\s*)+)(.*)$/);
      if (!m) continue;
      const mins = (m[1].match(/\d+/g) || []).map(Number);
      const name = clean(m[2]);
      const og = !name || /^OG$/i.test(name) || /vlastn/i.test(name);
      for (const min of mins) out.push({ name: og ? null : name, min });
    }
    return out;
  }

  function parseCards(td) {
    if (!td) return [];
    return Array.from(td.querySelectorAll(".component__table-card")).map(sp => {
      const t = clean(sp.textContent);
      const m = t.match(/^(\d+)\.\s*(.*)$/);
      const cls = sp.className || "";
      return { name: m ? clean(m[2]) : t, min: m ? +m[1] : null, color: /is-red/.test(cls) ? "red" : /is-yellow/.test(cls) ? "yellow" : "other" };
    });
  }

  /* Detaily utkání: obalová tabulka s vnitřními tabulkami (hlavička, popis, sestavy, góly a karty) */
  function parseDetails(doc, team) {
    const out = [];
    const wrappers = Array.from(doc.querySelectorAll("table.has-wrapper")).filter(t => t.querySelector("table.is-inside"));
    for (const w of wrappers) {
      const inner = Array.from(w.querySelectorAll("table.is-inside"));
      const head = inner.find(t => { const h = clean((ownRows(t)[0] || {}).textContent); return /Datum/.test(h) && /Výsledek/.test(h); });
      if (!head) continue;
      const hc = ownCells(ownRows(head)[1]);
      if (hc.length < 6) continue;
      const teams = teamLinks(hc[3]);
      if (teams.length < 2) continue;
      const isHome = teams[0] === team;
      if (!isHome && teams[1] !== team) continue;
      const pg = hc[5].querySelector(".period-goals");
      const pgText = pg ? clean(pg.textContent) : "";
      const d = {
        date: parseDate(hc[0].textContent), round: parseRound(hc[4].textContent), home: isHome,
        score: parseScore(clean(hc[5].textContent).replace(pgText, "")), ht: pg ? parseScore(pgText) : null
      };
      const rep = inner.find(t => /Popis zápasu/.test(clean((ownRows(t)[0] || {}).textContent)));
      if (rep) {
        const rc = ownCells(ownRows(rep)[1]);
        d.report = clean(rc[0] && rc[0].textContent) || null;
        d.referee = clean(rc[1] && rc[1].textContent) || null;
      }
      const smaller = inner.filter(t => t.classList.contains("has-smaller-text"));
      const goalsT = smaller.find(t => /Góly/.test(clean((ownRows(t)[0] || {}).textContent)));
      const lineT = smaller.find(t => t !== goalsT);
      if (lineT) {
        const lc = ownCells(ownRows(lineT)[1]);
        d.lineup = parseLineup(isHome ? lc[0] : lc[2]);
      }
      if (goalsT) {
        const gc = ownCells(ownRows(goalsT)[1]);
        d.goals = parseGoals(isHome ? gc[0] : gc[3]);
        d.cards = parseCards(isHome ? gc[1] : gc[4]);
      }
      out.push(d);
    }
    return out;
  }

  function parseTable(doc, team) {
    const t = doc.querySelector("table.tables-table");
    if (!t) return [];
    return ownRows(t).map(ownCells).filter(c => c.length >= 8 && c[0].tagName === "TD").map(c => {
      const name = clean(c[1].textContent);
      return {
        pos: parseRound(c[0].textContent), team: name,
        z: +clean(c[2].textContent) || 0, v: +clean(c[3].textContent) || 0, r: +clean(c[4].textContent) || 0, p: +clean(c[5].textContent) || 0,
        score: clean(c[6].textContent), pts: +clean(c[7].textContent) || 0, us: name === team
      };
    });
  }

  function matchKey(m) { return m.round != null ? "k" + m.round : "d" + m.date; }

  function parseTeamPage(doc, url, team) {
    const season = seasonFromUrl(url);
    const played = parseGames(doc.querySelector("table.games-old-table"), team, true);
    const upcoming = parseGames(doc.querySelector("table.games-new-table"), team, false);
    const details = parseDetails(doc, team);
    const byKey = new Map();
    for (const m of upcoming.concat(played)) byKey.set(matchKey(m), Object.assign(byKey.get(matchKey(m)) || {}, m));
    for (const d of details) {
      const k = matchKey(d);
      const m = byKey.get(k);
      if (!m) continue;
      if (d.ht) m.ht = d.ht;
      if (!m.score && d.score) m.score = d.score;
      for (const f of ["report", "referee", "lineup", "goals", "cards"]) if (d[f] !== undefined) m[f] = d[f];
    }
    const matches = Array.from(byKey.values()).sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
    for (const m of matches) m.key = matchKey(m);
    return { season, matches, table: parseTable(doc, team) };
  }

  /* Seznam hřišť z psmf.cz/hriste/: kód → název, adresa (první řádek) a GPS z odkazu na Mapy.cz */
  function parseVenues(doc) {
    const out = {};
    for (const tr of doc.querySelectorAll("table tr")) {
      const c = Array.from(tr.children).filter(x => x.tagName === "TD");
      if (c.length < 3) continue;
      const links = Array.from(c[1].querySelectorAll("a[name]"));
      if (!links.length) continue;
      const address = clean(c[2].innerHTML.split(/<br\s*\/?>/i)[0].replace(/<[^>]+>/g, " "));
      const name = clean(c[0].textContent);
      for (const a of links) {
        const code = clean(a.getAttribute("name")).toUpperCase();
        let href = a.getAttribute("href") || "";
        try { href = decodeURIComponent(href); } catch (e) {}
        const m = href.match(/GPS:\s*(-?\d+\.\d+)\s+(-?\d+\.\d+)/);
        if (code) out[code] = { name, address, lat: m ? +m[1] : null, lng: m ? +m[2] : null };
      }
    }
    return out;
  }

  /* Najde odkaz na stránku týmu v nejnovější sezóně (např. ve výsledcích vyhledávání) */
  function findTeamLinks(doc, teamSlug) {
    const urls = new Set();
    doc.querySelectorAll("a[href]").forEach(a => {
      const h = a.getAttribute("href") || "";
      if (h.indexOf("/tymy/" + teamSlug + "/") !== -1 && /\/souteze\//.test(h)) urls.add(h.replace(/^https?:\/\/[^/]+/, ""));
    });
    return Array.from(urls).map(u => ({ url: u, season: seasonFromUrl(u) })).filter(x => x.season)
      .sort((a, b) => b.season.sortKey - a.season.sortKey);
  }

  const api = { clean, parseDate, parseScore, parseTime, seasonFromUrl, parseLineup, parseGoals, parseCards, parseTeamPage, findTeamLinks, parseVenues };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PSMF = api;
})(typeof self !== "undefined" ? self : this);

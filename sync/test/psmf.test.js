"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const PSMF = require("../psmf");
const { dayDiff, fmtDay, slugify } = require("../sync");

const URL = "/souteze/2026-hanspaulska-liga-podzim/6-e/tymy/hulla-hulla-fc/";
const doc = new JSDOM(fs.readFileSync(path.join(__dirname, "fixture.html"), "utf8")).window.document;
const p = PSMF.parseTeamPage(doc, URL, "Hulla hulla FC");

test("sezóna z adresy", () => {
  assert.deepStrictEqual(
    { id: p.season.id, label: p.season.label, group: p.season.group, level: p.season.level },
    { id: "2026p", label: "Podzim 2026", group: "6E", level: 6 });
  assert.strictEqual(PSMF.seasonFromUrl("/souteze/2027-hanspaulska-liga-jaro/5-a/tymy/x/").id, "2027j");
});

test("zápasy: výsledky, rozpis a kontumace", () => {
  const byKey = Object.fromEntries(p.matches.map(m => [m.key, m]));
  assert.strictEqual(p.matches.length, 4);
  assert.deepStrictEqual(
    [byKey.k10.date, byKey.k10.time, byKey.k10.venue, byKey.k10.home, byKey.k10.opp, byKey.k10.score, byKey.k10.ht, byKey.k10.gameId],
    ["2026-11-17", "18:00", "HANSP", false, "Forejt FC", "5:7", "1:2", "311479"]);
  assert.strictEqual(byKey.k9.home, true);
  assert.strictEqual(byKey.k5.forfeit, true);
  assert.strictEqual(byKey.k5.score, "6:0");
  assert.strictEqual(byKey.k8.score, undefined);
  assert.strictEqual(byKey.k8.ourColor, "žlutá");
  assert.strictEqual(byKey.k8.oppColor, "růžová");
});

test("sestava: brankář, kapitán, nejlepší hráč", () => {
  const l = p.matches.find(m => m.key === "k10").lineup;
  assert.strictEqual(l.length, 9);
  assert.deepStrictEqual(l[0], { name: "Tomáš Pavelka", gk: true, best: false, captain: false });
  assert.strictEqual(l.find(x => x.name === "Martin Hajný").captain, true);
  assert.strictEqual(l.find(x => x.name === "Lukáš Kolouch").best, true);
  const l2 = p.matches.find(m => m.key === "k9").lineup;
  assert.strictEqual(l2.find(x => x.name === "Jiří Studený").captain, true);
});

test("góly a karty jen našeho týmu", () => {
  const g = p.matches.find(m => m.key === "k10").goals;
  assert.strictEqual(g.length, 7);
  assert.strictEqual(g.filter(x => x.name === "Lukáš Kolouch").length, 4);
  assert.deepStrictEqual(g.filter(x => x.name === "Lukáš Kolouch").map(x => x.min), [29, 44, 48, 60]);
  const m9 = p.matches.find(m => m.key === "k9");
  assert.strictEqual(m9.goals.length, 4);
  assert.deepStrictEqual(m9.cards, [{ name: "Vladislav Kocián", min: 10, color: "yellow" }]);
  assert.strictEqual(m9.report, "Vyrovnané utkání, které rozhodla lepší koncovka týmu Hulla hulla.");
});

test("vlastní gól soupeře se nepřipíše nikomu", () => {
  const td = new JSDOM("<table><tr><td> 12. OG<br> 30., 41. Jan Novák </td></tr></table>").window.document.querySelector("td");
  assert.deepStrictEqual(PSMF.parseGoals(td), [{ name: null, min: 12 }, { name: "Jan Novák", min: 30 }, { name: "Jan Novák", min: 41 }]);
});

test("tabulka skupiny", () => {
  assert.strictEqual(p.table.length, 2);
  const us = p.table.find(r => r.us);
  assert.deepStrictEqual([us.pos, us.z, us.v, us.r, us.p, us.score, us.pts], [5, 9, 5, 0, 4, "38:33", 10]);
});

test("hledání stránky týmu vybere nejnovější sezónu", () => {
  const d = new JSDOM('<a href="/souteze/2026-hanspaulska-liga-jaro/7-g/tymy/hulla-hulla-fc/">a</a><a href="/souteze/2026-hanspaulska-liga-podzim/6-e/tymy/hulla-hulla-fc/">b</a><a href="/souteze/2026-hanspaulska-liga-podzim/6-e/tymy/jiny/">c</a>').window.document;
  const r = PSMF.findTeamLinks(d, "hulla-hulla-fc");
  assert.strictEqual(r.length, 2);
  assert.strictEqual(r[0].season.id, "2026p");
});

test("pomocné funkce pro připomínky", () => {
  assert.strictEqual(dayDiff("2026-11-21", "2026-11-24"), 3);
  assert.strictEqual(dayDiff("2026-03-28", "2026-03-30"), 2);
  assert.strictEqual(dayDiff("2026-12-31", "2027-01-01"), 1);
  assert.strictEqual(fmtDay("2026-11-24"), "út 24. 11.");
  assert.strictEqual(slugify("Jiří Studený"), "jiri-studeny");
});

# Hulla hulla FC

Týmová aplikace pro Hanspaulskou ligu: docházka na zápasy (Jdu / Nejdu / Nehlásil se, tři pole pro náhradníky), rozpis, výsledky, sestavy, tabulky a statistiky za poslední dva roky. Připomínky chodí ve 12:00 tři, dva a jeden den před zápasem.

- `index.html`, `app.js`, `app.css`, `store.js` – aplikace (běží na GitHub Pages, data ve Firebase)
- `config.js` – nastavení Firebase
- `sw.js`, `manifest.webmanifest`, `icons/` – instalace na plochu a připomínky
- `sync/` – automat, který stahuje data z psmf.cz a posílá připomínky (spouští ho `.github/workflows/sync.yml`)
- `firestore.rules` – pravidla databáze

Postup nastavení je v souboru **NAVOD.md**. Ukázku bez nastavení otevřeš přidáním `?demo` za adresu.

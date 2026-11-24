# Hulla hulla FC – návod na spuštění aplikace

Aplikace běží zdarma na GitHub Pages, data ukládá do Firebase (Google) a každý den si sama stahuje rozpis a výsledky z psmf.cz. Nastavení zabere zhruba 30 minut a dělá se jen jednou.

Potřebuješ:

- účet Google (pro Firebase),
- účet na GitHubu (založíš zdarma na https://github.com),
- rozbalený tento balíček.

Dokud nastavení nedokončíš, aplikace běží v **ukázkovém režimu**. Ukazuje data k 24. 11. 2026 a nic neukládá.

---

## 1. Firebase: databáze a připomínky

1. Otevři https://console.firebase.google.com a přihlas se.
2. **Create a project** → název `hulla-hulla` → Google Analytics vypni → **Create project**.
3. Vlevo **Build → Firestore Database → Create database**. Umístění zvol `eur3 (europe-west)`, režim **Start in production mode** → **Create**.
4. Ve Firestore otevři záložku **Rules**. Smaž, co tam je, vlož celý obsah souboru `firestore.rules` z balíčku a klikni **Publish**.
5. Vlevo **Build → Authentication → Get started → Sign-in method → Anonymous → Enable → Save**.

## 2. Propojení aplikace s Firebase (soubor config.js)

1. Klikni na ozubené kolo vedle „Project Overview“ → **Project settings → General**.
2. Dole u „Your apps“ klikni na ikonu **`</>`** (Web). Název `Hulla web`, Firebase Hosting nezaškrtávej → **Register app**.
3. Objeví se blok `firebaseConfig`. Otevři soubor `config.js` v Poznámkovém bloku (TextEditu) a přepiš hodnoty `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId` a `appId` místo „VLOZ…“.
4. **Project settings → Cloud Messaging → Web configuration → Web Push certificates → Generate key pair.** Zkopíruj vygenerovaný klíč do `config.js` jako `vapidKey`.
5. **Project settings → Service accounts → Generate new private key.** Stáhne se soubor `.json`. **Je tajný**: nenahrávej ho na GitHub mezi soubory, použiješ ho jen v kroku 3.5.

## 3. GitHub: umístění aplikace na web

1. Na GitHubu klikni **New** (nový repozitář). Název `hulla-hulla`, **Public** → **Create repository**.
2. Klikni na odkaz **uploading an existing file**. Otevři rozbalenou složku `hulla-hulla` a přetáhni do okna **její obsah** (soubory `index.html`, `app.js` a další a složky `icons`, `fonts`, `sync`), ne celou složku. Nahoře nic nepřejmenovávej. Dole **Commit changes**.
3. Složka `.github` je skrytá a přetažením se většinou nenahraje. Vytvoř ji proto ručně: **Add file → Create new file**, do názvu napiš přesně `.github/workflows/sync.yml`, do obsahu vlož celý text ze souboru `github-akce-sync.yml` z balíčku → **Commit changes**.
4. **Settings → Pages**: Source **Deploy from a branch**, Branch **main**, složka **/ (root)** → **Save**. Za minutu až dvě poběží aplikace na adrese `https://TVOJE-JMENO.github.io/hulla-hulla/`.
5. **Settings → Secrets and variables → Actions**:
   - záložka **Secrets → New repository secret**: Name `FIREBASE_SERVICE_ACCOUNT`, do pole Secret vlož **celý obsah** staženého souboru `.json` (otevři ho v Poznámkovém bloku a zkopíruj všechno),
   - záložka **Variables → New repository variable**: Name `APP_URL`, Value `https://TVOJE-JMENO.github.io/hulla-hulla/`.
6. Zpátky ve Firebase: **Authentication → Settings → Authorized domains → Add domain** → `TVOJE-JMENO.github.io`.

## 4. První stažení dat z PSMF

1. Na GitHubu otevři záložku **Actions**. Když se ptá, povol spouštění („I understand my workflows, go ahead and enable them“).
2. Vlevo vyber **Data z PSMF a připomínky → Run workflow → Run workflow**.
3. Za minutu až dvě má běh zelenou fajfku. Do databáze se stáhly zápasy, výsledky, sestavy a tabulky za poslední dva roky a soupiska hráčů.
4. Otevři aplikaci. Žlutý pruh „Ukázkový režim“ zmizí a uvidíš ostrá data.

## 5. Telefony

- **Android (Chrome):** otevři adresu aplikace → nabídka ⋮ → **Přidat na plochu** (nebo Instalovat aplikaci) → otevři z plochy → vyber své jméno → **Nastavení → Zapnout připomínky**.
- **iPhone (Safari, iOS 16.4 a novější):** otevři adresu → **Sdílet → Přidat na plochu** → otevři aplikaci z plochy → vyber své jméno → **Zapnout připomínky → Povolit**.
- Odkaz pošli týmu přes **Nastavení → Sdílet odkaz**. Nikdo se nemusí registrovat.

## Test připomínek

**Actions → Data z PSMF a připomínky → Run workflow**, zaškrtni **Poslat testovací připomínku hned** → Run. Všem, kdo mají připomínky zapnuté, přijde upozornění k nejbližšímu zápasu.

---

## Jak aplikace funguje

- **Docházka:** u každého zápasu stavy Jdu / Nejdu / Nehlásil se. Pod soupiskou jsou tři volná pole pro náhradníky. Vyplněný náhradník se počítá jako hráč, který jde.
- **Jména hráčů** může přepsat kdokoli z týmu: v Docházce klepni na jméno. Tam jde hráče i skrýt nebo přidat nového. Pole „Jméno v zápisech PSMF“ měň jen tehdy, když se hráč v zápisu jmenuje jinak. Podle něj se mu přiřazují zápasy a góly.
- **Připomínky** chodí ve 12:00 tři, dva a jeden den před každým zápasem, všem, kdo je mají zapnuté.
- **Data z PSMF** stahuje automat několikrát denně: ráno, v poledne, odpoledne a večer po zápasech. Novou sezónu najde sám přes vyhledávání na psmf.cz.
- **Ruční oprava výsledku:** ve Výsledcích rozbal zápas → Opravit výsledek. Oprava má přednost před PSMF, dokud ji nezrušíš.
- **Minimum hráčů** (teď 6) změníš v `config.js` v položce `minPlayers`.
- **Statistiky** se počítají ze zápisů PSMF za poslední dva roky: zápasy, góly, nejlepší hráč zápasu (★), žluté karty a účast.

## Když něco nefunguje

- **Pořád „Ukázkový režim“:** v `config.js` zůstalo slovo VLOZ, nebo telefon drží starou verzi. Zavři aplikaci a otevři ji znovu.
- **Běh v Actions je červený:** otevři ho a přečti chybu. Nejčastěji chybí `FIREBASE_SERVICE_ACCOUNT` nebo je vložený jen kus souboru.
- **„Data se nepodařilo načíst (permission-denied)“:** nejsou vložená pravidla z `firestore.rules`, nebo není zapnuté anonymní přihlášení.
- **Nechodí připomínky:** zkontroluj `vapidKey` v `config.js`, proměnnou `APP_URL` a povolená oznámení v telefonu. Na iPhonu fungují jen z aplikace na ploše.
- **PSMF změní vzhled webu:** běh v Actions zčervená a v aplikaci (Nastavení → Data z PSMF) se ukáže chyba. Docházka funguje dál, jen se nestahují nové výsledky.

Firebase v bezplatném tarifu (Spark) dovoluje 50 000 čtení a 20 000 zápisů denně. Pro tým o deseti lidech je to s velkou rezervou.

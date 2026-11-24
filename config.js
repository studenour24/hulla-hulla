/*
 * Nastavení aplikace Hulla hulla FC.
 * Hodnoty doplň podle návodu (NAVOD.md, krok 2). Dokud tu zůstane „VLOZ“, aplikace běží v ukázkovém režimu.
 * Tyto údaje nejsou tajné, mohou být veřejně na GitHubu.
 */
self.HH_CONFIG = {
  firebase: {
    apiKey: "VLOZ_API_KEY",
    authDomain: "VLOZ.firebaseapp.com",
    projectId: "VLOZ",
    storageBucket: "VLOZ.appspot.com",
    messagingSenderId: "VLOZ",
    appId: "VLOZ"
  },
  // Firebase → Nastavení projektu → Cloud Messaging → Web Push certificates → Key pair
  vapidKey: "VLOZ_VAPID_KLIC",
  team: "Hulla hulla FC",
  // Kolik hráčů je potřeba na zápas (5 v poli + brankář)
  minPlayers: 6
};

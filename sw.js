/* Service worker: offline režim aplikace a připomínky (Firebase Cloud Messaging). */
importScripts("./config.js");

const CACHE = "hulla-v1";
const SHELL = [
  "./", "./index.html", "./app.css", "./app.js", "./store.js", "./demo-data.js", "./config.js", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/badge-96.png",
  "./fonts/archivo-latin-400-normal.woff2", "./fonts/archivo-latin-ext-400-normal.woff2",
  "./fonts/archivo-latin-600-normal.woff2", "./fonts/archivo-latin-ext-600-normal.woff2",
  "./fonts/saira-extra-condensed-latin-800-normal.woff2", "./fonts/saira-extra-condensed-latin-ext-800-normal.woff2"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Vlastní soubory: nejdřív síť (aby se aktualizace projevily hned), bez signálu z mezipaměti.
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match("./index.html")))
  );
});

// Připomínky z Firebase. Zprávy s polem „notification“ zobrazí SDK samo, i když je aplikace zavřená.
const cfg = self.HH_CONFIG || {};
if (cfg.firebase && cfg.firebase.apiKey && !/VLOZ/.test(cfg.firebase.apiKey)) {
  importScripts(
    "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js",
    "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js"
  );
  firebase.initializeApp(cfg.firebase);
  firebase.messaging();
}

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const d = e.notification.data || {};
  const fcm = d.FCM_MSG || {};
  const link = (fcm.notification && fcm.notification.click_action) || (fcm.data && fcm.data.match ? "./#zapas/" + fcm.data.match : null) || "./";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const w of list) { if ("focus" in w) { if ("navigate" in w) w.navigate(link); return w.focus(); } }
    return self.clients.openWindow(link);
  }));
});

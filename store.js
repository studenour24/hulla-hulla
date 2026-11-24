/*
 * Datová vrstva aplikace: Firebase (Firestore, anonymní přihlášení, připomínky)
 * nebo ukázkový režim s daty v paměti, dokud není vyplněný config.js.
 */
const FB = "https://www.gstatic.com/firebasejs/10.12.2/";

export function isConfigured(cfg) {
  return !!(cfg && cfg.firebase && cfg.firebase.apiKey && !/VLOZ/.test(cfg.firebase.apiKey));
}

function slugify(s) {
  return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "hrac";
}
function emptyState() {
  return { players: [], matches: [], attendance: new Map(), subs: new Map(), seasons: [], config: {}, loaded: new Set(), error: null };
}

export async function createStore(cfg, onChange, onMessage) {
  const forceDemo = new URLSearchParams(location.search).has("demo");
  if (forceDemo || !isConfigured(cfg)) return createDemoStore(onChange);
  return createFirebaseStore(cfg, onChange, onMessage);
}

/* ---------------- Firebase ---------------- */
async function createFirebaseStore(cfg, onChange, onMessage) {
  const [appM, fs, au] = await Promise.all([import(FB + "firebase-app.js"), import(FB + "firebase-firestore.js"), import(FB + "firebase-auth.js")]);
  const app = appM.initializeApp(cfg.firebase);
  let db;
  try { db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) }); }
  catch (e) { db = fs.getFirestore(app); }

  const auth = au.getAuth(app);
  const user = await new Promise(res => { const off = au.onAuthStateChanged(auth, u => { off(); res(u); }); });
  if (!user) await au.signInAnonymously(auth);

  const state = emptyState();
  const emit = () => onChange(state);
  const listen = (name, ref, apply) => fs.onSnapshot(ref, snap => { apply(snap); state.loaded.add(name); emit(); },
    err => { state.error = err && (err.code || err.message); emit(); });

  // Načítá se jen poslední zhruba dva roky, aby aplikace zůstala rychlá a v bezplatném limitu Firebase.
  const fromYear = String(new Date().getFullYear() - 2);
  listen("players", fs.collection(db, "players"), s => { state.players = s.docs.map(d => Object.assign({ id: d.id }, d.data())); });
  listen("matches", fs.query(fs.collection(db, "matches"), fs.where("season", ">=", fromYear)), s => { state.matches = s.docs.map(d => Object.assign({ id: d.id }, d.data())); });
  listen("attendance", fs.query(fs.collection(db, "attendance"), fs.where("match", ">=", String(new Date().getFullYear() - 1))), s => {
    const m = new Map();
    s.docs.forEach(d => { const v = d.data(); if (v.status === "yes" || v.status === "no") m.set(v.match + "__" + v.player, v.status); });
    state.attendance = m;
  });
  listen("subs", fs.collection(db, "subs"), s => { const m = new Map(); s.docs.forEach(d => m.set(d.id, d.data())); state.subs = m; });
  listen("seasons", fs.query(fs.collection(db, "seasons"), fs.where("id", ">=", fromYear)), s => { state.seasons = s.docs.map(d => Object.assign({ id: d.id }, d.data())); });
  listen("config", fs.doc(db, "config", "app"), s => { state.config = s.exists() ? s.data() : {}; });

  let messaging = null, msgM = null;
  async function loadMessaging() {
    if (messaging) return messaging;
    msgM = await import(FB + "firebase-messaging.js");
    if (!(await msgM.isSupported())) return null;
    messaging = msgM.getMessaging(app);
    msgM.onMessage(messaging, p => onMessage && onMessage(p));
    return messaging;
  }
  async function saveToken(token, playerId) {
    await fs.setDoc(fs.doc(db, "tokens", token), { token, player: playerId || "", ua: navigator.userAgent.slice(0, 200), updatedAt: fs.serverTimestamp() });
  }

  return {
    mode: "firebase",
    setAttendance(matchId, playerId, status) {
      const ref = fs.doc(db, "attendance", matchId + "__" + playerId);
      return status ? fs.setDoc(ref, { match: matchId, player: playerId, status, at: fs.serverTimestamp() }) : fs.deleteDoc(ref);
    },
    setSub(matchId, slot, name) {
      return fs.setDoc(fs.doc(db, "subs", matchId), { ["s" + slot]: name }, { merge: true });
    },
    addPlayer(name) {
      const id = slugify(name) + "-" + Math.random().toString(36).slice(2, 6);
      return fs.setDoc(fs.doc(db, "players", id), { name, psmfName: name, active: true, manual: true, createdAt: new Date().toISOString() });
    },
    updatePlayer(id, patch) { return fs.updateDoc(fs.doc(db, "players", id), patch); },
    setOverride(matchId, override) { return fs.updateDoc(fs.doc(db, "matches", matchId), { override: override || null }); },
    async pushSupported() {
      if (!("serviceWorker" in navigator) || !("Notification" in window) || !("PushManager" in window)) return false;
      try { return !!(await loadMessaging()); } catch (e) { return false; }
    },
    /* permission = výsledek Notification.requestPermission() vyvolaného přímo kliknutím */
    async enablePush(permission, playerId) {
      const perm = await permission;
      if (perm !== "granted") return { ok: false, reason: perm };
      const m = await loadMessaging();
      if (!m) return { ok: false, reason: "unsupported" };
      const reg = (await navigator.serviceWorker.getRegistration("./")) || (await navigator.serviceWorker.register("./sw.js"));
      await navigator.serviceWorker.ready;
      const token = await msgM.getToken(m, { vapidKey: cfg.vapidKey, serviceWorkerRegistration: reg });
      if (!token) return { ok: false, reason: "no-token" };
      await saveToken(token, playerId);
      try { localStorage.setItem("hh-push", token); } catch (e) {}
      return { ok: true };
    },
    async updatePushPlayer(playerId) {
      let token = null; try { token = localStorage.getItem("hh-push"); } catch (e) {}
      if (token) await saveToken(token, playerId).catch(() => {});
    },
    async disablePush() {
      try { const m = await loadMessaging(); if (m) await msgM.deleteToken(m); } catch (e) {}
      try { localStorage.removeItem("hh-push"); } catch (e) {}
    }
  };
}

/* ---------------- Ukázkový režim ---------------- */
async function createDemoStore(onChange) {
  const { DEMO } = await import("./demo-data.js");
  const state = emptyState();
  state.players = DEMO.players.map(p => Object.assign({}, p));
  state.matches = DEMO.matches.map(m => Object.assign({}, m));
  state.seasons = DEMO.seasons.map(s => Object.assign({}, s));
  state.config = Object.assign({}, DEMO.config);
  for (const [k, v] of Object.entries(DEMO.attendance)) state.attendance.set(k, v);
  for (const [k, v] of Object.entries(DEMO.subs)) state.subs.set(k, Object.assign({}, v));
  ["players", "matches", "attendance", "subs", "seasons", "config"].forEach(n => state.loaded.add(n));
  state.demo = true;
  const emit = () => setTimeout(() => onChange(state), 0);
  emit();
  return {
    mode: "demo",
    async setAttendance(matchId, playerId, status) {
      const k = matchId + "__" + playerId;
      if (status) state.attendance.set(k, status); else state.attendance.delete(k);
      emit();
    },
    async setSub(matchId, slot, name) {
      const cur = Object.assign({}, state.subs.get(matchId) || {}); cur["s" + slot] = name; state.subs.set(matchId, cur); emit();
    },
    async addPlayer(name) {
      state.players = state.players.concat([{ id: slugify(name) + "-" + Math.random().toString(36).slice(2, 6), name, psmfName: name, active: true, manual: true }]); emit();
    },
    async updatePlayer(id, patch) { state.players = state.players.map(p => p.id === id ? Object.assign({}, p, patch) : p); emit(); },
    async setOverride(matchId, override) { state.matches = state.matches.map(m => m.id === matchId ? Object.assign({}, m, { override: override || null }) : m); emit(); },
    async pushSupported() { return false; },
    async enablePush() { return { ok: false, reason: "demo" }; },
    async updatePushPlayer() {},
    async disablePush() {}
  };
}

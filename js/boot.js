// PaP: Firebase との接続・起動時のペア選び・新しい版の確認・テーマ
// index.html から順番に読み込みます(前のファイルで決めた名前を使います)。

// ---------- ?add=1&url=… (bookmarklet) / ?title=…&text=…&url=… (Android share sheet) ----------
function readPending(){
  const q = new URLSearchParams(location.search);
  let p = null;
  if (q.has("add") || q.has("url") || q.has("text") || q.has("title")){
    let url = q.get("url") || "", text = q.get("text") || "", title = q.get("title") || "";
    // share sheets often put the link inside the text
    if (!/^https?:\/\//.test(url)){ url = ""; const m = text.match(URL_RE); if (m){ url = m[0]; text = text.replace(m[0], "").trim(); } }
    if (url || text || title) p = { url, text, title, popup:q.has("add") };
    try { history.replaceState(null, "", location.pathname); } catch {}
  }
  if (!p){
    try { p = JSON.parse(sessionStorage.getItem("pap.pending") || "null"); sessionStorage.removeItem("pap.pending"); } catch {}
  }
  return p;
}
// #p=<code>: opened from another device's QR
function readCode(){
  const m = location.hash.match(/[#&]p=([A-Za-z0-9-]+)/);
  if (!m) return null;
  try { history.replaceState(null, "", location.pathname + location.search); } catch {}
  return m[1];
}
async function sendPending(){
  const p = pendingAdd; pendingAdd = null;
  const n = p.url ? await sendAll({ page:p }) : await sendAll({ text:[p.title, p.text].filter(Boolean).join("\n") });
  // the bookmarklet's little window closes itself once sent
  if (n && p.popup && window.opener){ toast("送りました。このウィンドウは閉じます"); setTimeout(() => window.close(), 1300); }
}

// ---------- new-version check (GitHub Pages) ----------
let pageSig = null;
const sigOf = t => { let x = 0; for (let i = 0; i < t.length; i++) x = (x * 31 + t.charCodeAt(i)) | 0; return t.length + ":" + x; };
const pageFiles = () => [location.pathname, ...[...document.querySelectorAll('script[src^="js/"], link[href^="css/"]')].map(e => e.getAttribute("src") || e.getAttribute("href"))];
async function fetchSig(){
  const texts = await Promise.all(pageFiles().map(async f => { const r = await fetch(f, { cache:"no-store" }); if (!r.ok) throw new Error(f); return r.text(); }));
  return sigOf(texts.join("\n"));
}
document.addEventListener("visibilitychange", async () => {
  if (document.hidden || !pageSig) return;
  let now = null; try { now = await fetchSig(); } catch {}
  if (now && now !== pageSig && !S.sending && !$("txt").value.trim()) location.reload();
});

// ---------- theme ----------
function applyTheme(){
  const t = ls.get("theme", "auto");
  if (t === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  document.querySelectorAll("#themePick button").forEach(b => { const on = b.dataset.t === t; b.classList.toggle("on", on); b.setAttribute("aria-checked", String(on)); });
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#15171c";
}
$("themePick").addEventListener("click", e => { const b = e.target.closest("button[data-t]"); if (!b) return; ls.set("theme", b.dataset.t); applyTheme(); });
matchMedia("(prefers-color-scheme: light)").addEventListener("change", applyTheme);
applyTheme();

// ---------- connection banner ----------
function updateOnline(){ $("offline").hidden = navigator.onLine !== false; }
window.addEventListener("online", updateOnline);
window.addEventListener("offline", updateOnline);
updateOnline();

// ---------- boot ----------
function boot(){
  fetchSig().then(x => { pageSig = x; }).catch(() => {});
  // local testing against the Firebase emulators: http://localhost:8080/?emu (read before the address is cleaned up)
  const emu = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && /(^|[?&])emu\b/.test(location.search);
  pendingAdd = readPending();
  const code = readCode();
  render();
  const slow = setTimeout(() => { $("slowNote").hidden = false; }, 8000);
  const cfg = window.FIREBASE_CONFIG;
  if (!window.firebase || !cfg || (!cfg.apiKey && !emu)){
    clearTimeout(slow);
    return fail("Firebaseの設定が読み込めませんでした。firebase-config.js に設定を貼り付けたか確認してください。");
  }
  try {
    firebase.initializeApp(emu ? { apiKey:"demo-key", projectId:"demo-pap", authDomain:"localhost" } : cfg);
    // App Check proves requests come from this page; must start before any other Firebase call
    const siteKey = window.APPCHECK_SITE_KEY;
    if (siteKey && firebase.appCheck && !emu){
      if (/^(localhost|127.0.0.1)$/.test(location.hostname)) self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
      firebase.appCheck().activate(new firebase.appCheck.ReCaptchaEnterpriseProvider(siteKey), true);
    }
    const auth = firebase.auth(), fs = firebase.firestore();
    if (emu){
      auth.useEmulator("http://127.0.0.1:9099", { disableWarnings:true }); fs.useEmulator("127.0.0.1", 8085);
      // stands in for the Google popup: window.emuSub picks the account
      window.emuGoogle = () => auth.signInWithCredential(firebase.auth.GoogleAuthProvider.credential(JSON.stringify({ sub:window.emuSub || "g1", email:(window.emuSub || "g1") + "@example.com", email_verified:true })));
    }
    S.db = fs;
    auth.getRedirectResult().catch(e => { console.warn(e); toast("ログインできませんでした。もう一度どうぞ", true); });
    let started = false, signedOut = false;
    auth.onAuthStateChanged(u => {
      // every device has a hidden anonymous account; Google is only for guarding a pair
      if (!u){
        signedOut = started;
        auth.signInAnonymously().catch(e => { console.warn(e); fail("サーバーにつながりませんでした。README の手順2(匿名ログイン)を確認してください。"); });
        return;
      }
      S.user = u;
      clearTimeout(slow);
      if (!started){ started = true; return start(code); }
      if (signedOut){ signedOut = false; openPair(); }   // signed out of Google on this device
    });
  } catch (e){
    console.warn(e);
    clearTimeout(slow);
    return fail("サーバーにつながりませんでした。通信を確認して再読み込みしてください。");
  }
}
async function start(code){
  let back = false;
  try { back = !!sessionStorage.getItem("pap.google"); } catch {}
  if (code){ await useCode(code); if (S.pair === undefined) openPair(); return; }
  if (back && isGoogle()) return afterGoogle();             // came back from the Google page
  if (!ls.get("key", null) && isGoogle()) return afterGoogle();
  openPair();
}
boot();

// PaP: ペア(つなぐ・コード・QR・Google で守る・作り直す)
// index.html から順番に読み込みます(前のファイルで決めた名前を使います)。

// ふだんは QR / コードでつなぐ。鍵(pairs/<key>)を知っている端末だけが中を開ける。
// 「Google で守る」をオンにすると、鍵に加えてその Google アカウントのログインが必要になる。
const CODE_ABC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // no I / O / 0 / 1 (keep in step with codes in firestore.rules)
const CODE_LIFE = 10 * 60e3;
function randomFrom(abc, n){ const a = new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a, b => abc[b % abc.length]).join(""); }
const newKey = () => randomFrom("abcdefghijklmnopqrstuvwxyz0123456789", 28);
const codeText = c => c.slice(0, 4) + "-" + c.slice(4);
const cleanCode = s => (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/O/g, "0").replace(/I/g, "1");
const isGoogle = () => !!(S.user && S.user.providerData.some(p => p.providerId === "google.com"));

// ---------- opening a pair ----------
// S.pair: null (none on this device) | "loading" | "locked" (guarded by a Google account this device isn't signed in to) | "ok"
async function openPair(){
  stopSubs();
  S.key = ls.get("key", null);
  if (!S.key){ S.pair = null; return render(); }
  S.pair = "loading"; render();
  let s;
  try { s = await S.db.doc("pairs/" + S.key).get(); }
  catch (e){ console.warn(e); return fail("データベースにつながりませんでした。通信を確認して再読み込みしてください。"); }
  if (!s.exists){
    ls.set("key", null); S.key = null; S.pair = null; render();
    return toast("ペアが見つかりませんでした。もう一度つないでください", true);
  }
  const d = s.data();
  S.owner = str(d.owner, 128);
  if (S.owner && S.owner !== S.user.uid){ S.pair = "locked"; return render(); }
  Object.assign(S, { pair:"ok", items:[], pinned:[], itemsReady:false, pinnedReady:false, limit:PAGE });
  subscribe(); render();
  if (pendingAdd) sendPending();
}
function usePair(key){ ls.set("key", key); return openPair(); }
async function createPair(){
  const key = newKey();
  try { await S.db.doc("pairs/" + key).set({ keep:30, at:Date.now() }); }
  catch (e){ console.warn(e); return toast("はじめられませんでした。通信を確認して、もう一度どうぞ", true); }
  await usePair(key);
  if (isGoogle()) await guardWithGoogle(true);
  return key;
}
// this device only: forget the key (and the Google sign-in, back to an anonymous device)
async function leavePair(){
  ls.set("key", null);
  if (isGoogle()){ await firebase.auth().signOut(); return; }   // onAuthStateChanged signs in anonymously again
  openPair();
}

// ---------- codes (what the QR carries): 8 letters, 10 minutes ----------
async function makeCode(){
  // a fresh code every time: the last one may already have been used (and deleted) by the other device
  const old = ls.get("code", null);
  if (old) S.db.doc("codes/" + old.c).delete().catch(() => {});
  const c = randomFrom(CODE_ABC, 8), exp = Date.now() + CODE_LIFE;
  await S.db.doc("codes/" + c).set({ key:S.key, exp });
  const out = { c, exp, key:S.key };
  ls.set("code", out);
  return out;
}
async function useCode(raw){
  const c = cleanCode(raw);
  if (c.length !== 8) return toast("コードは8文字です", true);
  let s = null;
  try { s = await S.db.doc("codes/" + c).get(); } catch {}
  if (!s || !s.exists || typeof s.data().key !== "string") return toast("コードが違うか、期限が切れています。相手の画面でもう一度出してください", true);
  S.db.doc("codes/" + c).delete().catch(() => {});
  await usePair(s.data().key);
  if (S.pair === "ok") toast("つながりました");
}
const pairLink = c => SITE + "#p=" + c;

// ---------- Google ----------
async function googleSignIn(intent){
  const auth = firebase.auth();
  const p = new firebase.auth.GoogleAuthProvider();
  p.setCustomParameters({ prompt:"select_account" });
  try { sessionStorage.setItem("pap.google", intent); } catch {}
  try {
    if (window.emuGoogle) await window.emuGoogle();
    else await auth.signInWithPopup(p);
  } catch (e){
    const c = e && e.code;
    try { sessionStorage.removeItem("pap.google"); } catch {}
    if (c === "auth/popup-closed-by-user" || c === "auth/cancelled-popup-request") return;
    // home-screen apps and some in-app browsers can't open popups: go to Google and come back
    if (c === "auth/popup-blocked" || c === "auth/operation-not-supported-in-this-environment"){
      try { sessionStorage.setItem("pap.google", intent); if (pendingAdd) sessionStorage.setItem("pap.pending", JSON.stringify(pendingAdd)); } catch {}
      return auth.signInWithRedirect(p);
    }
    if (c === "auth/unauthorized-domain") return toast("このURLは Firebase に登録されていません(README の手順6)", true);
    if (c === "auth/operation-not-allowed") return toast("Google ログインがオンになっていません(README の手順2)", true);
    console.warn(e); return toast("ログインできませんでした。もう一度どうぞ", true);
  }
  return afterGoogle();
}
// signed in with Google: guard the pair on this device, or find the one this account guards
async function afterGoogle(){
  let intent = "find";
  try { intent = sessionStorage.getItem("pap.google") || "find"; sessionStorage.removeItem("pap.google"); } catch {}
  S.user = firebase.auth().currentUser;
  if (intent === "guard" && ls.get("key", null)) return guardWithGoogle();
  let key = null;
  try { const u = await S.db.doc("users/" + S.user.uid).get(); key = u.exists ? str(u.data().pair, 40) : null; } catch (e){ console.warn(e); }
  if (key){ await usePair(key); if (S.pair === "ok") toast("つながりました"); return; }
  await openPair();
  if (S.key) return;
  toast("このアカウントで守っているペアはまだありません。「新しくはじめる」か、QRでつないでください", true);
}
async function guardWithGoogle(quiet){
  const uid = S.user.uid, ref = S.db.doc("pairs/" + S.key);
  try {
    const s = await ref.get();
    const owner = s.exists ? str(s.data().owner, 128) : "";
    if (owner && owner !== uid){ toast("このペアは、別の Google アカウントで守られています", true); return openPair(); }
    const b = S.db.batch();
    if (!owner) b.update(ref, { owner:uid });
    b.set(S.db.doc("users/" + uid), { pair:S.key });
    await b.commit();
    if (!quiet) toast("Google アカウントで守りました");
  } catch (e){ console.warn(e); toast("設定できませんでした。もう一度どうぞ", true); }
  return openPair();
}
async function stopGuard(){
  try {
    await S.db.doc("pairs/" + S.key).update({ owner:firebase.firestore.FieldValue.delete() });
    toast("Google の保護を外しました。QRだけでつなげます");
  } catch (e){ console.warn(e); toast("外せませんでした。もう一度どうぞ", true); }
}

// ---------- make the pair again: a new key; everything in the old one is deleted ----------
async function remakePair(){
  const oldKey = S.key;
  try {
    await wipeAll(true);
    await S.db.doc("pairs/" + oldKey).delete();
  } catch (e){ console.warn(e); }
  ls.set("code", null);
  // a device signed in with Google guards the new pair too (createPair)
  await createPair();
  toast("作り直しました。ほかの端末は、もう一度QRでつないでください");
}

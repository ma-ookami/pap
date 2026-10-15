// PaP: ペア(つなぐ・コード・QR・つながっている端末・Google で守る・作り直す)
// index.html から順番に読み込みます(前のファイルで決めた名前を使います)。

// ペア(pairs/<key>)を開けるのは、登録された端末(members/<uid>)だけ。登録できるのは、ペアを作った端末と、
// 10分だけ使えるコード(QRの中身)を持ってきた端末。外された端末は、新しいコードなしでは戻れない。
// 「Google で守る」をオンにすると、その Google アカウントでログインした端末しか開けなくなる。
const CODE_ABC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // no I / O / 0 / 1 (keep in step with codes in firestore.rules)
const CODE_LIFE = 10 * 60e3;
function randomFrom(abc, n){ const a = new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a, b => abc[b % abc.length]).join(""); }
const newKey = () => randomFrom("abcdefghijklmnopqrstuvwxyz0123456789", 28);
const codeText = c => c.slice(0, 4) + "-" + c.slice(4);
const cleanCode = s => (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/O/g, "0").replace(/I/g, "1");
const isGoogle = () => !!(S.user && S.user.providerData.some(p => p.providerId === "google.com"));
const pairRef = (k = S.key) => S.db.doc("pairs/" + k);
const memberRef = (k = S.key, uid = S.user.uid) => S.db.doc(`pairs/${k}/members/${uid}`);
const deviceRef = (k = S.key, id = DEV.id) => S.db.doc(`pairs/${k}/devices/${id}`);
const deviceData = (at = Date.now()) => ({ name:DEV.name.slice(0, 24), kind:DEV.kind, uid:S.user.uid, at, seen:Date.now() });

// ---------- opening a pair ----------
// S.pair: null (none on this device) | "loading" | "locked" (guarded by a Google account this device isn't signed in to) | "ok"
async function openPair(){
  stopSubs();
  S.key = ls.get("key", null);
  if (!S.key){ S.pair = null; return render(); }
  S.pair = "loading"; render();
  let d, member;
  try {
    const s = await pairRef().get();
    d = s.exists ? s.data() : null;
    if (d) member = (await memberRef().get()).exists;
  } catch (e){ console.warn(e); return fail("データベースにつながりませんでした。通信を確認して再読み込みしてください。", e); }
  if (!d) return dropPair("ペアが見つかりませんでした。もう一度つないでください");
  S.owner = str(d.owner, 128);
  if (S.owner && S.owner !== S.user.uid){ S.pair = "locked"; return render(); }
  if (!member){
    // the Google account guarding the pair may sign in on a new device: register it
    if (S.owner !== S.user.uid) return dropPair("この端末は、ペアから外されました。もう一度QRでつないでください");
    try { await memberRef().set({ at:Date.now() }); } catch (e){ console.warn(e); }
  }
  Object.assign(S, { pair:"ok", items:[], pinned:[], devices:[], itemsReady:false, pinnedReady:false, limit:PAGE });
  subscribe(); render();
  registerDevice();
  if (pendingAdd) sendPending();
}
function dropPair(msg){
  ls.set("key", null); S.key = null; S.pair = null; render();
  toast(msg, true);
}
// this device's name in "つながっている端末" (kept up to date, and "last used" at most every 10 minutes)
let seenAt = 0;
async function registerDevice(force){
  if (S.pair !== "ok") return;
  const me = S.devices.find(x => x.id === DEV.id);
  if (!force && me && me.uid === S.user.uid && me.name === DEV.name && Date.now() - seenAt < 10 * 60e3) return;
  seenAt = Date.now();
  try { await deviceRef().set(deviceData(me ? me.at : Date.now())); } catch (e){ console.warn(e); }
}
function usePair(key){ ls.set("key", key); return openPair(); }

async function createPair(){
  const key = newKey(), b = S.db.batch();
  b.set(pairRef(key), { keep:30, at:Date.now(), creator:S.user.uid });
  b.set(memberRef(key), { at:Date.now() });
  try { await b.commit(); }
  catch (e){ console.warn(e); return toast("はじめられませんでした。通信を確認して、もう一度どうぞ", true); }
  await usePair(key);
  if (isGoogle()) await guardWithGoogle(true);
  return key;
}

// ---------- codes (what the QR carries): 8 letters, 10 minutes, used once ----------
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
// register this device with a code: the code is used up in the same write
async function joinWithCode(c){
  let s = null;
  try { s = await S.db.doc("codes/" + c).get(); } catch {}
  if (!s || !s.exists || typeof s.data().key !== "string") return null;
  const key = s.data().key, b = S.db.batch();
  b.set(memberRef(key), { at:Date.now(), code:c });
  b.delete(S.db.doc("codes/" + c));
  await b.commit();
  return key;
}
async function useCode(raw, name){
  const c = cleanCode(raw);
  if (c.length !== 8){ toast("コードは8文字です", true); return false; }
  if (name) ls.set("devName", name.trim().slice(0, 16));
  let key = null;
  try { key = await joinWithCode(c); } catch (e){ console.warn(e); }
  if (!key){ toast("コードが違うか、期限が切れています。相手の画面でもう一度出してください", true); return false; }
  await usePair(key);
  if (S.pair === "ok") toast("つながりました");
  return true;
}
const pairLink = c => SITE + "#p=" + c;

// ---------- つながっている端末 ----------
const cleanDevice = (id, d) => d && str(d.name, 24) ? { id, name:str(d.name, 24), kind:d.kind === "phone" ? "phone" : "pc", uid:str(d.uid, 128), at:num(d.at) || 0, seen:num(d.seen) || 0 } : null;
function watchDevices(){
  let first = true;
  return S.db.collection(`pairs/${S.key}/devices`).onSnapshot(q => {
    const list = q.docs.map(d => cleanDevice(d.id, d.data())).filter(Boolean).sort((a, b) => a.at - b.at);
    // someone new: tell this device right away (a QR read by the wrong person shows up here)
    if (!first) for (const d of list) if (d.id !== DEV.id && !S.devices.some(x => x.id === d.id))
      toast(`${d.kind === "phone" ? "📱" : "💻"} ${d.name} がつながりました`, false, { label:"確認", fn:openDevices });
    first = false;
    S.devices = list; render();
  }, onSubError);
}
// take a device out of the pair: it can't come back without a new code
async function kickDevice(d){
  const b = S.db.batch();
  b.delete(deviceRef(S.key, d.id));
  // the same account may be on other devices (Google): keep its access while any of them stays
  if (!S.devices.some(x => x.id !== d.id && x.uid === d.uid)) b.delete(memberRef(S.key, d.uid));
  await b.commit();
}
// this device only: leave the pair (and the Google sign-in, back to an anonymous device)
async function leavePair(){
  try { await kickDevice(S.devices.find(x => x.id === DEV.id) || { id:DEV.id, uid:S.user.uid }); } catch (e){ console.warn(e); }
  ls.set("key", null);
  if (isGoogle()){ await firebase.auth().signOut(); return; }   // onAuthStateChanged signs in anonymously again
  openPair();
}

// ---------- Google ----------
// An anonymous device links Google to its own account, so it keeps its place in the pair.
// If that Google account is already in use, this device switches to it.
async function googleSignIn(intent){
  const auth = firebase.auth(), u = auth.currentUser;
  const p = new firebase.auth.GoogleAuthProvider();
  p.setCustomParameters({ prompt:"select_account" });
  try { sessionStorage.setItem("pap.google", intent); } catch {}
  try {
    try {
      if (window.emuGoogle) await window.emuGoogle(u && u.isAnonymous);
      else if (u && u.isAnonymous) await u.linkWithPopup(p);
      else await auth.signInWithPopup(p);
    } catch (e){
      const cred = e && (e.credential || (firebase.auth.GoogleAuthProvider.credentialFromError && firebase.auth.GoogleAuthProvider.credentialFromError(e)));
      if (!e || e.code !== "auth/credential-already-in-use" || !cred) throw e;
      // guarding this pair with an account that is used elsewhere: bring a code along to stay in the pair
      const code = intent === "guard" && S.pair === "ok" ? (await makeCode()).c : null;
      await auth.signInWithCredential(cred);
      S.user = auth.currentUser;
      if (code) await joinWithCode(code);
    }
    await auth.currentUser.getIdToken(true);
  } catch (e){
    const c = e && e.code;
    try { sessionStorage.removeItem("pap.google"); } catch {}
    if (c === "auth/popup-closed-by-user" || c === "auth/cancelled-popup-request") return;
    // home-screen apps and some in-app browsers can't open popups: go to Google and come back
    if (c === "auth/popup-blocked" || c === "auth/operation-not-supported-in-this-environment"){
      try { sessionStorage.setItem("pap.google", intent); if (pendingAdd) sessionStorage.setItem("pap.pending", JSON.stringify(pendingAdd)); } catch {}
      return u && u.isAnonymous ? u.linkWithRedirect(p) : auth.signInWithRedirect(p);
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
  if (S.key && S.pair !== "locked") return;
  toast("このアカウントで守っているペアはありません。「新しくはじめる」か、QRでつないでください", true);
}
async function guardWithGoogle(quiet){
  const uid = S.user.uid;
  try {
    const s = await pairRef().get();
    const owner = s.exists ? str(s.data().owner, 128) : "";
    if (owner && owner !== uid){ toast("このペアは、別の Google アカウントで守られています", true); return openPair(); }
    const b = S.db.batch();
    if (!owner) b.update(pairRef(), { owner:uid });
    b.set(S.db.doc("users/" + uid), { pair:S.key });
    await b.commit();
    if (!quiet) toast("Google アカウントで守りました");
  } catch (e){ console.warn(e); toast("設定できませんでした。もう一度どうぞ", true); }
  return openPair();
}
async function stopGuard(){
  try {
    await pairRef().update({ owner:firebase.firestore.FieldValue.delete() });
    toast("Google の保護を外しました。QRだけでつなげます");
  } catch (e){ console.warn(e); toast("外せませんでした。もう一度どうぞ", true); }
}

// ---------- make the pair again: a new key; everything in the old one is deleted ----------
async function remakePair(){
  const oldKey = S.key, others = S.devices.filter(d => d.id !== DEV.id);
  try {
    await wipeAll(true);
    for (const d of others) await kickDevice(d).catch(() => {});
    const b = S.db.batch();
    b.delete(deviceRef(oldKey)); b.delete(pairRef(oldKey)); b.delete(memberRef(oldKey));
    await b.commit();
  } catch (e){ console.warn(e); }
  ls.set("code", null);
  // a device signed in with Google guards the new pair too (createPair)
  await createPair();
  toast("作り直しました。ほかの端末は、もう一度QRでつないでください");
}

// PaP: リアルタイム更新・送る・消す・📌・自動で消す・ファイルの読み込み
// index.html から順番に読み込みます(前のファイルで決めた名前を使います)。

// ---------- reading ----------
function cleanItem(id, d){
  if (!d || !num(d.at) || !["text","link","image","file"].includes(d.kind)) return null;
  return {
    id, kind:d.kind, at:d.at,
    text:str(d.text, TEXT_MAX), title:str(d.title, TITLE_MAX), url:/^https?:\/\//.test(d.url || "") ? str(d.url, URL_MAX) : "",
    name:str(d.name, NAME_MAX), mime:str(d.mime, 100), size:num(d.size) || 0, parts:num(d.parts) || 0,
    thumb:/^data:image\/(jpeg|png|webp);base64,/.test(d.thumb || "") ? d.thumb : "", w:num(d.w) || 0, h:num(d.h) || 0,
    from:str(d.from, 24) || "?", did:str(d.did, 40), dev:d.dev === "phone" ? "phone" : "pc",
    pinned:d.pinned === true, ready:d.ready !== false,
  };
}
// everything lives under pairs/<key>
const col = n => S.db.collection(`pairs/${S.key}/${n}`);
const pdoc = p => S.db.doc(`pairs/${S.key}/${p}`);
let unsubs = [], itemsUnsub = null;
function stopSubs(){ unsubs.concat(itemsUnsub || []).forEach(u => { try{ u(); }catch{} }); unsubs = []; itemsUnsub = null; }
function onSubError(e){
  console.warn(e);
  // guarded by Google from another device, or the pair was made again
  if (e && e.code === "permission-denied") return openPair();
  fail("データを読み込めませんでした。通信を確認して再読み込みしてください。");
}
function subscribe(){
  stopSubs();
  unsubs.push(S.db.doc("pairs/" + S.key).onSnapshot(s => {
    if (!s.exists) return openPair();
    const d = s.data();
    S.keep = KEEPS.includes(d.keep) ? d.keep : 30; S.settingsReady = true;
    S.owner = str(d.owner, 128);
    if (S.owner && (!S.user || S.owner !== S.user.uid)) return openPair();
    render(); cleanup();
  }, onSubError));
  unsubs.push(col("items").where("pinned", "==", true).onSnapshot(q => {
    S.pinned = q.docs.map(d => cleanItem(d.id, d.data())).filter(Boolean).sort((a, b) => b.at - a.at);
    S.pinnedReady = true; render();
  }, onSubError));
  subscribeItems();
}
function subscribeItems(){
  if (itemsUnsub) itemsUnsub();
  let first = true;
  itemsUnsub = col("items").orderBy("at", "desc").limit(S.limit + 1).onSnapshot(q => {
    const list = q.docs.map(d => cleanItem(d.id, d.data())).filter(Boolean);
    S.hasMore = list.length > S.limit;
    const prev = new Set(S.items.map(x => x.id));
    S.items = list.slice(0, S.limit);
    // arrivals from the other device while this one isn't being looked at → "(2) PaP"
    if (!first && document.hidden) S.unseen += S.items.filter(x => !prev.has(x.id) && x.did !== DEV.id).length;
    first = false;
    S.itemsReady = true; render();
  }, onSubError);
}
function showMore(){ S.limit += PAGE; subscribeItems(); }

// ---------- writing ----------
function baseItem(kind){ return { kind, from:DEV.name, did:DEV.id, dev:DEV.kind, at:Date.now(), pinned:false, ready:true }; }
function writeError(e){
  console.warn(e);
  const c = e && e.code;
  if (c === "too_big") toast(`「${e.name}」は大きすぎます(${sizeText(FILE_MAX)}まで)`, true);
  else if (c === "resource-exhausted") toast("今日はこれ以上保存できません(無料枠の上限)。明日また試してください", true);
  else if (c === "permission-denied") toast("保存できませんでした。ページを再読み込みしてください", true);
  else toast("送れませんでした。通信を確認して、もう一度どうぞ", true);
}
// text, or a page (url + title + the words picked on it)
async function sendText(text, page){
  const d = baseItem("text");
  const url = page ? page.url : onlyUrl(text);
  if (url){
    d.kind = "link"; d.url = url;
    if (page && page.title) d.title = str(page.title, TITLE_MAX);
    const rest = page ? page.text : "";
    if (rest && rest.trim() !== url) d.text = str(rest, TEXT_MAX);
  } else d.text = str(text, TEXT_MAX);
  const ref = col("items").doc();
  await ref.set(d);
  return ref.id;
}
// a prepared file (files.js): the item first (marked "送信中"), then its pieces, then ready
async function sendFile(f, progress){
  const parts = await splitParts(f.blob);
  const d = Object.assign(baseItem(f.kind), { name:f.name, mime:f.mime, size:f.size, parts:parts.length, ready:false });
  if (f.kind === "image") Object.assign(d, { thumb:f.thumb, w:f.w, h:f.h });
  const ref = col("items").doc();
  await ref.set(d);
  try {
    for (let i = 0; i < parts.length; i++){
      await pdoc(`blobs/${ref.id}_${i}`).set({ d:parts[i] });
      progress && progress((i + 1) / parts.length);
    }
    await ref.update({ ready:true });
  } catch (e){
    deleteItem({ id:ref.id, parts:parts.length }).catch(() => {});
    throw e;
  }
  blobCache.set(ref.id, f.blob);
  return ref.id;
}
async function deleteItem(it){
  const b = S.db.batch();
  for (let i = 0; i < (it.parts || 0); i++) b.delete(pdoc(`blobs/${it.id}_${i}`));
  b.delete(pdoc("items/" + it.id));
  await b.commit();
  blobCache.delete(it.id);
}
function setPinned(it, on){ return pdoc("items/" + it.id).update({ pinned:on }); }
function setKeep(k){ return S.db.doc("pairs/" + S.key).update({ keep:k }); }

// ---------- auto delete (by this device's clock; 📌 stays) ----------
let cleaning = false;
async function cleanup(){
  if (cleaning || !S.settingsReady) return;
  const now = Date.now();
  // half-sent files older than an hour are leftovers of an interrupted send
  const cut = S.keep ? now - S.keep * 86400e3 : now - 3600e3;
  if (ls.get("cleanAt", 0) > now - 3600e3) return;
  cleaning = true;
  try {
    const q = await col("items").where("at", "<", cut).orderBy("at").limit(200).get();
    const old = q.docs.map(d => cleanItem(d.id, d.data())).filter(x => x && !x.pinned && (S.keep || !x.ready));
    for (const it of old) await deleteItem(it);
    ls.set("cleanAt", now);
  } catch (e){ console.warn("cleanup", e); }
  cleaning = false;
}
async function wipeAll(withPinned){
  let n = 0;
  for (;;){
    const q = await (withPinned ? col("items") : col("items").where("pinned", "==", false)).limit(100).get();
    for (const d of q.docs){ await deleteItem({ id:d.id, parts:num(d.data().parts) || 0 }); n++; }
    if (q.size < 100) break;
  }
  return n;
}

// ---------- the pieces of a file, put back together ----------
const blobCache = new Map();
async function loadBlob(it){
  if (blobCache.has(it.id)) return blobCache.get(it.id);
  const parts = [];
  for (let i = 0; i < it.parts; i++){
    const s = await pdoc(`blobs/${it.id}_${i}`).get();
    if (!s.exists) throw new Error("missing part");
    parts.push(b64ToBytes(s.data().d));
  }
  const blob = new Blob(parts, { type:it.mime || "application/octet-stream" });
  blobCache.set(it.id, blob);
  return blob;
}

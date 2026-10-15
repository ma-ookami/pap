// PaP: 画面の描画
// index.html から順番に読み込みます(前のファイルで決めた名前を使います)。

const KEEP_LABEL = { 1:"1日", 7:"1週間", 30:"1か月" };
const hiddenIds = new Set();   // deleted here, waiting out the 取り消す toast

function screen(){
  if (S.fatal) return "sError";
  if (!S.db || !S.user || S.pair === "loading" || S.pair === undefined) return "sLoading";
  if (!S.pair) return "sStart";
  if (S.pair === "locked") return "sLocked";
  return "sMain";
}
function render(){
  const sc = screen();
  for (const id of ["sLoading","sError","sStart","sLocked","sMain"]) $(id).hidden = id !== sc;
  $("setBtn").hidden = $("qrSiteBtn").hidden = sc !== "sMain";
  if (sc === "sError") $("errMsg").textContent = S.fatal;
  if (sc === "sStart") $("pendingNote").hidden = !pendingAdd;
  if (sc === "sMain") renderMain();
  document.title = (S.unseen ? `(${S.unseen}) ` : "") + "PaP";
}

// ---------- main ----------
function renderMain(){
  renderSend();
  const q = S.q.trim().toLowerCase();
  const match = it => !q || [it.text, it.title, it.url, it.name, it.from].some(s => s && s.toLowerCase().includes(q));
  const pinned = S.pinned.filter(it => !hiddenIds.has(it.id) && match(it));
  const recent = S.items.filter(it => !it.pinned && !hiddenIds.has(it.id) && match(it));
  const ready = S.itemsReady && S.pinnedReady;

  const pin = pinned.length ? [h("h3", { class:"day" }, "📌 とっておき"), ...pinned.map(card)] : [];
  $("pinned").replaceChildren(...pin);
  const out = [];
  let day = null;
  for (const it of recent){
    const k = dayKey(it.at);
    if (k !== day){ day = k; out.push(h("h3", { class:"day" }, dayHead(it.at))); }
    out.push(card(it));
  }
  $("items").replaceChildren(...out);
  $("empty").hidden = !ready || pinned.length + recent.length > 0;
  $("empty").innerHTML = q ? "見つかりませんでした。" : "まだ何もありません。<br>コピーした文字や写真を送ってみましょう。";
  $("moreBtn").hidden = !S.hasMore || !!q;
  $("search").hidden = S.items.length + S.pinned.length < 6 && !q;
  $("keepNote").textContent = S.keep ? `${KEEP_LABEL[S.keep]}たったものは自動で消えます(📌 は残ります)` : "";
}
function renderSend(){
  const busy = S.sending;
  $("sendBtn").disabled = busy || !$("txt").value.trim();
  $("clipBtn").disabled = busy;
  $("sendBtn").textContent = busy ? "送信中…" : "送る";
}

// ---------- one item (cards are reused when nothing about them changed) ----------
const cards = new Map();
const isNew = it => it.did !== DEV.id && it.at > S.seenAt;
function card(it){
  const sig = JSON.stringify([it, isNew(it), !!S.open[it.id], agoText(it.at)]);
  const c = cards.get(it.id);
  if (c && c.sig === sig) return c.el;
  const el = buildCard(it);
  cards.set(it.id, { sig, el });
  return el;
}
function buildCard(it){
  const fresh = isNew(it);
  const stale = !it.ready && Date.now() - it.at > 3600e3;
  const meta = h("div", { class:"meta" },
    h("span", { class:"dev" }, (it.dev === "phone" ? "📱 " : "💻 ") + it.from),
    h("span", { class:"when", title:new Date(it.at).toLocaleString("ja-JP") }, agoText(it.at)),
    fresh ? h("span", { class:"new" }, "NEW") : null);
  const body = [], acts = [];
  const act = (a, label, cls, title) => h("button", { type:"button", class:"act" + (cls ? " " + cls : ""), "data-act":a, title:title || null, "aria-label":title || null }, label);

  if (!it.ready){
    body.push(h("p", { class:"pending" + (stale ? " err" : "") }, stale ? "送信が途中で止まりました" : (it.did === DEV.id ? "送信中…" : "受け取り中…"), it.name ? `(${it.name})` : ""));
  } else if (it.kind === "text"){
    const long = it.text.length > 360 || (it.text.match(/\n/g) || []).length > 7;
    body.push(h("div", { class:"text" + (long && !S.open[it.id] ? " clamp" : "") }, linkify(it.text)));
    if (long) body.push(h("button", { type:"button", class:"linkbtn more", "data-act":"expand" }, S.open[it.id] ? "たたむ" : "続きを見る"));
    acts.push(act("copy", "コピー", "pri"), act("qr", "QR", "", "QRコードを出す"));
    const u = onlyUrl(it.text) || (it.text.match(URL_RE) || [])[0];
    if (u) acts.splice(1, 0, act("open", "開く"));
  } else if (it.kind === "link"){
    body.push(h("a", { class:"link", href:it.url, target:"_blank", rel:"noopener noreferrer" },
      h("b", null, it.title || hostOf(it.url)), h("span", null, it.url)));
    if (it.text) body.push(h("blockquote", { class:"text" }, linkify(it.text)));
    acts.push(act("open", "開く", "pri"), act("copy", "コピー"), act("qr", "QR", "", "QRコードを出す"));
  } else if (it.kind === "image"){
    body.push(h("button", { type:"button", class:"thumb", "data-act":"view", "aria-label":"大きく見る" },
      it.thumb ? h("img", { src:it.thumb, alt:it.name, loading:"lazy", width:it.w || null, height:it.h || null }) : "🖼"));
    body.push(h("p", { class:"fname" }, `${it.name} · ${sizeText(it.size)}`));
    acts.push(act("copyimg", "コピー", "pri"), act("save", "保存"));
  } else {
    body.push(h("div", { class:"file" }, h("span", { class:"ficon", "aria-hidden":"true" }, fileIcon(it)),
      h("span", null, h("b", null, it.name), h("small", null, sizeText(it.size)))));
    acts.push(act("save", "保存", "pri"));
  }
  acts.push(h("span", { class:"sp" }),
    act("pin", it.pinned ? "📌" : "📍", it.pinned ? "on" : "", it.pinned ? "📌 を外す" : "📌 とっておく(自動で消えない)"),
    act("del", "🗑", "", "消す"));
  return h("article", { class:`item k-${it.kind}${fresh ? " fresh" : ""}${it.pinned ? " pinned" : ""}`, "data-id":it.id },
    meta, ...body, h("div", { class:"acts" }, it.ready ? acts : acts.slice(-1)));
}
function fileIcon(it){
  const n = (it.name || "").toLowerCase(), m = it.mime;
  if (/pdf/.test(m) || n.endsWith(".pdf")) return "📕";
  if (/^video\//.test(m)) return "🎞";
  if (/^audio\//.test(m)) return "🎵";
  if (/zip|compressed|tar|gzip/.test(m)) return "🗜";
  if (/sheet|excel|csv/.test(m) || /\.(xlsx?|csv)$/.test(n)) return "📊";
  return "📄";
}
function linkify(text){
  const out = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)){
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(h("a", { href:m[0], target:"_blank", rel:"noopener noreferrer" }, m[0]));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
const findItem = id => S.items.find(x => x.id === id) || S.pinned.find(x => x.id === id);

// ---------- QR ----------
let qrLib = null;
function loadQr(){
  if (window.qrcode) return Promise.resolve();
  return qrLib || (qrLib = new Promise((ok, bad) => {
    const s = h("script", { src:"https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js" });
    s.onload = ok; s.onerror = () => { qrLib = null; bad(); };
    document.head.append(s);
  }));
}
async function showQr(text, title, hint, code){
  try { await loadQr(); } catch { return toast("QRコードを作れませんでした。通信を確認してください", true); }
  // UTF-8 so Japanese survives the trip
  qrcode.stringToBytes = qrcode.stringToBytesFuncs["UTF-8"];
  let qr = null;
  for (const lv of ["M", "L"]){
    try { qr = qrcode(0, lv); qr.addData(text, "Byte"); qr.make(); break; } catch { qr = null; }
  }
  if (!qr) return toast("長すぎてQRコードにできません(約2000文字まで)", true);
  $("qrBox").innerHTML = qr.createSvgTag({ cellSize:6, margin:3, scalable:true });
  $("qrTitle").textContent = title;
  $("qrText").textContent = code ? "" : text.length > 140 ? text.slice(0, 140) + "…" : text;
  $("qrCode").hidden = !code; $("qrCode").textContent = code || "";
  $("qrHint").textContent = hint || "";
  if ($("shQr").hidden) openSheet("shQr");
}
// another device joins: the QR opens this site with a 10-minute code; the same code can be typed in
let pairQrT = null;
async function showPairQr(){
  let c;
  try { c = await makeCode(); } catch (e){ console.warn(e); return toast("コードを作れませんでした。通信を確認してください", true); }
  await showQr(pairLink(c.c), "ほかの端末をつなぐ",
    "スマホのカメラで読み取るか、相手の画面でこのコードを入力。" + Math.round((c.exp - Date.now()) / 60e3) + "分で使えなくなります", codeText(c.c));
  // refresh before it runs out while the sheet stays open
  clearTimeout(pairQrT);
  pairQrT = setTimeout(() => { if (!$("shQr").hidden && !$("qrCode").hidden) showPairQr(); }, Math.max(60e3, c.exp - Date.now() - 3 * 60e3 + 1000));
}

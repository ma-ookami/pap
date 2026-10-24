// PaP: 送る・貼り付け・ドラッグ・カードの操作・設定・シート
// index.html から順番に読み込みます(前のファイルで決めた名前を使います)。

// a page handed over by the bookmarklet or the share sheet (?add / ?share), sent once signed in
let pendingAdd = null;

// ---------- sending ----------
// text and/or files in one go, with progress and 取り消す
async function sendAll({ text = "", files = [], page = null }){
  if (S.sending) return toast("送信中です。少し待ってください");
  text = text.trim();
  if (!text && !files.length && !page) return;
  S.sending = true; renderSend();
  const ids = [];
  const prog = (i, n, p) => { $("progress").hidden = false; $("progBar").style.width = Math.round((i + p) / n * 100) + "%"; $("progText").textContent = n > 1 ? `${i + 1}/${n}` : ""; };
  try {
    if (text || page) ids.push({ id:await sendText(text, page), parts:0 });
    for (let i = 0; i < files.length; i++){
      prog(i, files.length, 0);
      const f = await prepare(files[i]);
      const id = await sendFile(f, p => prog(i, files.length, p));
      ids.push({ id, parts:Math.max(1, Math.ceil(f.size / PART_RAW)) });
    }
    if (text) $("txt").value = "";
    toast(ids.length > 1 ? `${ids.length}件 送りました` : "送りました", false, { label:"取り消す", fn:() => ids.forEach(x => deleteItem(x).catch(() => {})) });
  } catch (e){ writeError(e); }
  S.sending = false; $("progress").hidden = true; renderSend();
  return ids.length;
}
$("sendBtn").addEventListener("click", () => sendAll({ text:$("txt").value }));
$("txt").addEventListener("input", renderSend);
$("txt").addEventListener("keydown", e => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)){ e.preventDefault(); sendAll({ text:$("txt").value }); }
});
$("fileIn").addEventListener("change", e => {
  const files = [...e.target.files]; e.target.value = "";
  if (files.length) sendAll({ files });
});
$("clipBtn").addEventListener("click", async () => {
  const c = await readClipboard();
  if (!c){ $("txt").focus(); return toast("読み取りが許可されませんでした。下の欄を長押しして「ペースト」してください", true); }
  if (c.empty) return toast("クリップボードが空のようです", true);
  sendAll(c);
});

// Ctrl+V anywhere outside a text box sends right away; pictures pasted into the box are sent too
document.addEventListener("paste", e => {
  if (screen() !== "sMain") return;
  const dt = e.clipboardData;
  const files = [...(dt && dt.files || [])];
  const inBox = e.target.closest && e.target.closest("input, textarea");
  if (files.length){ e.preventDefault(); sendAll({ files }); return; }
  if (inBox) return;
  const text = dt && dt.getData("text/plain");
  if (text){ e.preventDefault(); sendAll({ text }); }
});

// drag & drop (PC)
let dragDepth = 0;
const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes("Files");
window.addEventListener("dragenter", e => { if (!hasFiles(e) || screen() !== "sMain") return; dragDepth++; $("dropping").hidden = false; });
window.addEventListener("dragleave", e => { if (!hasFiles(e)) return; if (--dragDepth <= 0){ dragDepth = 0; $("dropping").hidden = true; } });
window.addEventListener("dragover", e => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener("drop", e => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragDepth = 0; $("dropping").hidden = true;
  if (screen() === "sMain") sendAll({ files:[...e.dataTransfer.files] });
});

// ---------- cards ----------
async function onAct(a, it, btn){
  if (a === "copy") return copyText(it.kind === "link" ? it.url : it.text);
  if (a === "open"){ const u = it.url || onlyUrl(it.text) || (it.text.match(URL_RE) || [])[0]; return window.open(u, "_blank", "noopener"); }
  if (a === "qr") return showQr(it.url || it.text, it.kind === "link" ? "このページをQRで" : "この文字をQRで", "ログインしていない端末にも、カメラで読み取って渡せます");
  if (a === "expand"){ S.open[it.id] = !S.open[it.id]; return render(); }
  if (a === "view") return openViewer(it);
  if (a === "copyimg") return copyImage(loadBlob(it));
  if (a === "save" && DANGER_EXT.test(it.name || "") && !confirm(`「${it.name}」は実行できる形式のファイルです。自分で送ったものですか?\n身に覚えがなければ「キャンセル」`)) return;
  if (a === "save") return withBusy(btn, async () => saveBlob(await loadBlob(it), it.name));
  if (a === "pin") return setPinned(it, !it.pinned).then(() => toast(it.pinned ? "📌 を外しました" : "📌 とっておきます(自動で消えません)")).catch(writeError);
  if (a === "del"){
    hiddenIds.add(it.id); render();
    const t = setTimeout(() => { deleteItem(it).catch(e => { hiddenIds.delete(it.id); render(); writeError(e); }); }, 5000);
    toast("消しました", false, { label:"取り消す", fn:() => { clearTimeout(t); hiddenIds.delete(it.id); render(); } });
  }
}
async function withBusy(btn, fn){
  const old = btn.textContent; btn.disabled = true; btn.textContent = "…";
  try { await fn(); } catch (e){ console.warn(e); toast("読み込めませんでした。もう一度どうぞ", true); }
  btn.disabled = false; btn.textContent = old;
}
document.querySelector(".col-list").addEventListener("click", e => {
  const b = e.target.closest("[data-act]"), card = e.target.closest("article[data-id]");
  if (!b || !card) return;
  const it = findItem(card.dataset.id);
  if (it) onAct(b.dataset.act, it, b);
});
$("moreBtn").addEventListener("click", showMore);
$("search").addEventListener("input", e => { S.q = e.target.value; render(); });

// ---------- image viewer ----------
let viewing = null;
function openViewer(it){
  viewing = it;
  $("viewImg").src = it.thumb; $("viewImg").alt = it.name;
  $("viewer").hidden = false; document.body.classList.add("sheet-open");
  loadBlob(it).then(b => { if (viewing === it) $("viewImg").src = URL.createObjectURL(b); }).catch(() => {});
}
function closeViewer(){
  if ($("viewImg").src.startsWith("blob:")) URL.revokeObjectURL($("viewImg").src);
  viewing = null; $("viewer").hidden = true; document.body.classList.remove("sheet-open");
}
$("viewer").addEventListener("click", e => { if (e.target.id === "viewer" || e.target.closest("[data-close-viewer]")) closeViewer(); });
$("viewCopy").addEventListener("click", () => viewing && copyImage(loadBlob(viewing)));
$("viewSave").addEventListener("click", e => viewing && withBusy(e.currentTarget, async () => saveBlob(await loadBlob(viewing), viewing.name)));

// ---------- sheets ----------
function openSheet(id){ closeSheets(); $(id).hidden = false; document.body.classList.add("sheet-open"); }
function closeSheets(){ document.querySelectorAll(".sheet-bg").forEach(s => s.hidden = true); document.body.classList.remove("sheet-open"); }
document.querySelectorAll(".sheet-bg").forEach(bg => bg.addEventListener("click", e => { if (e.target === bg || e.target.closest("[data-close]")) closeSheets(); }));
document.addEventListener("keydown", e => { if (e.key === "Escape"){ closeSheets(); closeViewer(); } });
document.querySelectorAll("[data-reload]").forEach(b => b.addEventListener("click", () => location.reload()));

// ---------- back to the top ----------
// the logo: the top of the list when paired, otherwise the first screen
$("homeLink").addEventListener("click", e => {
  e.preventDefault();
  closeSheets(); closeViewer();
  if (screen() === "sMain") return window.scrollTo({ top:0, behavior:"smooth" });
  if (S.fatal || screen() === "sLoading") return;   // the buttons on those screens say what happens
  S.joinCode = null; openPair();
});
// stuck (an error, or loading forever): forget the pair on this device only and start over
document.querySelectorAll("[data-home]").forEach(b => b.addEventListener("click", () => {
  if (!confirm("この端末だけペアから外れて、最初の画面にもどります(中身は消えません)。よろしいですか?")) return;
  ls.set("key", null);
  location.href = location.pathname;
}));

$("qrSiteBtn").addEventListener("click", showPairQr);
$("pairMoreBtn").addEventListener("click", showPairQr);

// ---------- つながっている端末 ----------
$("devBar").addEventListener("click", () => S.devices.some(d => d.id !== DEV.id) ? openDevices() : showPairQr());
$("devAddBtn").addEventListener("click", showPairQr);
$("devList").addEventListener("click", async e => {
  const b = e.target.closest("[data-kick]"); if (!b) return;
  const d = S.devices.find(x => x.id === b.dataset.kick); if (!d) return;
  if (!confirm(`「${d.name}」をペアから外しますか?\nその端末は、新しいQRコードを読み取らないかぎり戻れません`)) return;
  try { await kickDevice(d); toast(`${d.name} を外しました`); } catch (e){ writeError(e); }
});

// ---------- join (opened from a QR): pick this device's name first ----------
$("joinForm").addEventListener("submit", async e => {
  e.preventDefault();
  const name = $("joinName").value.trim(); if (!name) return;
  $("joinBtn").disabled = true;
  const code = S.joinCode;
  if (await useCode(code, name)) S.joinCode = null;
  else { S.joinCode = null; await openPair(); }
  $("joinBtn").disabled = false; render();
});
$("joinCancel").addEventListener("click", () => { S.joinCode = null; openPair(); });

// ---------- start / locked screens ----------
$("newPairBtn").addEventListener("click", async () => {
  $("newPairBtn").disabled = true;
  if (await createPair()) setTimeout(showPairQr, 400);
  $("newPairBtn").disabled = false;
});
$("codeIn").addEventListener("input", e => {
  const c = cleanCode(e.target.value).slice(0, 8);
  e.target.value = c.length > 4 ? codeText(c) : c;
});
$("codeForm").addEventListener("submit", async e => {
  e.preventDefault();
  $("codeBtn").disabled = true;
  await useCode($("codeIn").value, $("codeName").value.trim() || defaultDevName());
  $("codeBtn").disabled = false;
});
const DANGER_EXT = /\.(exe|msi|bat|cmd|com|scr|ps1|vbs|vbe|js|jse|wsf|jar|lnk|apk|dmg|pkg|sh|app|hta|reg)$/i;
$("toCodeBtn").addEventListener("click", () => { $("codeCard").scrollIntoView({ behavior:"smooth", block:"center" }); $("codeIn").focus(); });
$("codeIn2").addEventListener("input", e => {
  const c = cleanCode(e.target.value).slice(0, 8);
  e.target.value = c.length > 4 ? codeText(c) : c;
});
$("codeForm2").addEventListener("submit", async e => {
  e.preventDefault();
  if (!confirm("このコードのペアにつなぎ直しますか?\n今のペアからは、この端末だけ離れます")) return;
  $("codeBtn2").disabled = true;
  if (await useCode($("codeIn2").value, "")){ $("codeIn2").value = ""; closeSheets(); }
  $("codeBtn2").disabled = false;
});
$("googleFindBtn").addEventListener("click", () => googleSignIn("find"));
$("lockedSignIn").addEventListener("click", () => googleSignIn("find"));
$("lockedLeave").addEventListener("click", () => { if (confirm("この端末をペアから外しますか?")) leavePair(); });

// ---------- settings ----------
function renderSettings(){
  $("devName").value = ls.get("devName", "");
  $("devName").placeholder = defaultDevName();
  document.querySelectorAll("#keepPick button").forEach(b => { const on = +b.dataset.k === S.keep; b.classList.toggle("on", on); b.setAttribute("aria-checked", String(on)); });
  const me = isGoogle() ? (S.user.email || "Google アカウント") : "";
  const mine = !!S.owner && S.owner === S.user.uid;
  $("guardText").textContent = mine ? "🔒 " + me + " で守っています" : "QRコードだけでつなげます";
  $("guardHint").textContent = mine ? "このアカウントでログインした端末だけが開けます。新しい端末は、QRのあとに Google でログインします。"
    : "Google で守ると、QRやコードが誰かに見られても、あなたの Google アカウントなしでは開けなくなります。";
  $("guardBtnText").textContent = mine ? "Google の保護を外す" : "Google アカウントで守る";
}
$("setBtn").addEventListener("click", () => { renderSettings(); openSheet("shSet"); });
$("devName").addEventListener("change", e => { ls.set("devName", e.target.value.trim().slice(0, 16)); registerDevice(true); toast("保存しました"); });
$("keepPick").addEventListener("click", e => {
  const b = e.target.closest("button[data-k]"); if (!b) return;
  S.keep = +b.dataset.k; renderSettings(); render();
  ls.set("cleanAt", 0);
  setKeep(S.keep).then(() => toast("保存しました(全端末に反映)")).catch(writeError);
});
$("guardBtn").addEventListener("click", async () => {
  if (S.owner && S.owner === S.user.uid){
    if (!confirm("Google の保護を外しますか?QRやコードだけで開けるようになります")) return;
    await stopGuard();
  } else {
    closeSheets();
    if (isGoogle()) await guardWithGoogle(); else await googleSignIn("guard");
  }
  renderSettings();
});
$("leaveBtn").addEventListener("click", () => {
  if (!confirm("この端末をペアから外しますか?(中身は消えません。もう一度QRでつなげます)")) return;
  closeSheets(); leavePair();
});
$("remakeBtn").addEventListener("click", async () => {
  if (!confirm("ペアを作り直しますか?中身は📌も含めてすべて消え、ほかの端末はもう一度つなぐ必要があります")) return;
  closeSheets(); toast("作り直しています…");
  await remakePair();
});
$("wipeBtn").addEventListener("click", async () => {
  if (!confirm("📌 したもの以外を、すべての端末から消します。元に戻せません。よろしいですか?")) return;
  closeSheets(); toast("消しています…");
  try { const n = await wipeAll(); toast(`${n}件 消しました`); } catch (e){ writeError(e); }
});

// ---------- bookmarklet: opens a small window that sends the page, then closes ----------
(() => {
  const js = `(()=>{const e=encodeURIComponent,s=String(getSelection()).slice(0,4000);window.open('${SITE}?add=1&url='+e(location.href)+'&title='+e(document.title)+'&text='+e(s),'pap','width=420,height=560')})()`;
  $("bmLink").href = "javascript:" + js;
  $("bmLink").addEventListener("click", e => { e.preventDefault(); toast("ブックマークバーへドラッグして使います"); });
})();

// ---------- NEW marks: what arrived from the other device since this one was last looked at ----------
S.seenAt = ls.get("seen", 0) || Date.now();
document.addEventListener("visibilitychange", () => {
  if (document.hidden) ls.set("seen", Date.now());
  else { S.seenAt = ls.get("seen", S.seenAt); S.unseen = 0; render(); registerDevice(); }
});
setInterval(() => { if (!document.hidden && screen() === "sMain") render(); }, 60000);

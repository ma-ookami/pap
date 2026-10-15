// PaP: 写真・ファイルの下ごしらえ(縮小・分割)、クリップボードの読み書き、保存
// index.html から順番に読み込みます(前のファイルで決めた名前を使います)。

// ---------- base64 ----------
function bytesToB64(bytes){
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64ToBytes(b64){
  const s = atob(b64), a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
  return a;
}

// ---------- images ----------
const IMG_TYPES = /^image\/(png|jpeg|gif|webp|bmp|avif)$/;
function loadImage(blob){
  return new Promise((ok, bad) => {
    const url = URL.createObjectURL(blob), img = new Image();
    img.onload = () => { ok(img); setTimeout(() => URL.revokeObjectURL(url), 1000); };
    img.onerror = () => { URL.revokeObjectURL(url); bad(new Error("image")); };
    img.src = url;
  });
}
function drawTo(img, max, type, quality){
  const r = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.naturalWidth * r)); c.height = Math.max(1, Math.round(img.naturalHeight * r));
  const g = c.getContext("2d");
  if (type === "image/jpeg"){ g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); }
  g.drawImage(img, 0, 0, c.width, c.height);
  return new Promise(ok => c.toBlob(ok, type, quality));
}
// small preview stored with the item, so the list never downloads the full picture
async function thumbOf(img){
  const b = await drawTo(img, 480, "image/jpeg", 0.72);
  return "data:image/jpeg;base64," + bytesToB64(new Uint8Array(await b.arrayBuffer()));
}

// File / Blob → what gets sent. Pictures keep their original bytes when they fit, so screenshots stay sharp.
async function prepare(file, name){
  name = str(name || file.name || "", NAME_MAX) || (file.type.startsWith("image/") ? "画像" : "ファイル");
  const out = { name, mime:str(file.type, 100) || "application/octet-stream", blob:file };
  if (IMG_TYPES.test(file.type) || /^image\//.test(file.type)){
    try {
      const img = await loadImage(file);
      out.kind = "image"; out.w = img.naturalWidth; out.h = img.naturalHeight;
      out.thumb = await thumbOf(img);
      // too big, or a format other browsers may not show (HEIC): send a JPEG instead
      if (file.size > FILE_MAX || !IMG_TYPES.test(file.type)){
        let b = null;
        for (const [max, q] of [[4096, .9], [3072, .85], [2048, .82]]){ b = await drawTo(img, max, "image/jpeg", q); if (b && b.size <= FILE_MAX) break; }
        out.blob = b; out.mime = "image/jpeg"; out.name = name.replace(/\.\w+$/, "") + ".jpg";
        const s = await loadImage(b); out.w = s.naturalWidth; out.h = s.naturalHeight;
      }
    } catch { out.kind = "file"; }
  } else out.kind = "file";
  out.size = out.blob.size;
  if (out.size > FILE_MAX) throw { code:"too_big", name };
  return out;
}
// bytes → pieces of base64 for the blobs collection
async function splitParts(blob){
  const bytes = new Uint8Array(await blob.arrayBuffer()), parts = [];
  for (let i = 0; i < bytes.length; i += PART_RAW) parts.push(bytesToB64(bytes.subarray(i, i + PART_RAW)));
  return parts.length ? parts : [""];
}

// ---------- clipboard ----------
// what the person copied: { text } or { files:[File] }; null when the browser won't tell us
async function readClipboard(){
  if (navigator.clipboard && navigator.clipboard.read){
    try {
      const list = await navigator.clipboard.read();
      const files = [];
      let text = "";
      for (const it of list){
        const img = it.types.find(t => t.startsWith("image/"));
        if (img){ const b = await it.getType(img); files.push(new File([b], "コピーした画像." + (img.split("/")[1] || "png"), { type:img })); continue; }
        if (!text && it.types.includes("text/plain")) text = await (await it.getType("text/plain")).text();
      }
      if (files.length) return { files };
      if (text) return { text };
      return { empty:true };
    } catch (e){ if (e && e.name === "NotAllowedError" && !navigator.clipboard.readText) return null; }
  }
  if (navigator.clipboard && navigator.clipboard.readText){
    try { const text = await navigator.clipboard.readText(); return text ? { text } : { empty:true }; } catch { return null; }
  }
  return null;
}
async function toPng(blob){
  if (blob.type === "image/png") return blob;
  return drawTo(await loadImage(blob), 8192, "image/png");
}
// ClipboardItem gets the promise right away: Safari only allows the write inside the tap itself
async function copyImage(blobPromise){
  try {
    if (!window.ClipboardItem || !navigator.clipboard.write) throw 0;
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blobPromise.then(toPng) })]);
    toast("画像をコピーしました");
  } catch { toast("この端末では画像をコピーできません。「保存」を使ってください", true); }
}

// ---------- saving ----------
async function saveBlob(blob, name){
  const file = new File([blob], name, { type:blob.type });
  // phones: the share sheet has "画像を保存" / "ファイルに保存"
  if (IS_PHONE && navigator.canShare && navigator.canShare({ files:[file] })){
    try { await navigator.share({ files:[file] }); return; }
    catch (e){ if (e && e.name === "AbortError") return; }
  }
  const url = URL.createObjectURL(blob);
  const a = h("a", { href:url, download:name }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

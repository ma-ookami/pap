// PaP: 定数・状態・端末・日付・小さな道具
// index.html から順番に読み込みます(前のファイルで決めた名前を使います)。

const SITE = location.origin + location.pathname;
const $ = id => document.getElementById(id);

// keep these in step with firestore.rules
const TEXT_MAX = 100000, TITLE_MAX = 500, URL_MAX = 4000, NAME_MAX = 200;
const PART_RAW = 720000;            // bytes per stored piece (base64 ≈ 960KB, under Firestore's 1MB per document)
const MAX_PARTS = 15;
const FILE_MAX = PART_RAW * MAX_PARTS; // ≈ 10MB
const PAGE = 60;                     // items per "もっと前を見る"
const KEEPS = [1, 7, 30, 0];         // days; 0 = keep forever

const S = {
  db:null, user:null, owner:null, fatal:null,
  items:[], pinned:[], devices:[], joinCode:null, itemsReady:false, pinnedReady:false, limit:PAGE, hasMore:false,
  keep:30, settingsReady:false,
  q:"", sending:false,
  seenAt:0, unseen:0, open:{},
};

const ls = {
  get(k, d){ try{ const v = localStorage.getItem("pap." + k); return v == null ? d : JSON.parse(v); }catch{ return d; } },
  set(k, v){ try{ localStorage.setItem("pap." + k, JSON.stringify(v)); }catch{} },
};

// ---------- this device ----------
const UA = navigator.userAgent;
const IS_PHONE = /Android|iPhone|iPad|iPod|Mobile/i.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1);
document.documentElement.classList.toggle("phone", IS_PHONE);
function defaultDevName(){
  if (/iPhone/.test(UA)) return "iPhone";
  if (/iPad/.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1)) return "iPad";
  if (/Android/.test(UA)) return /Mobile/.test(UA) ? "Android" : "タブレット";
  if (/Windows/.test(UA)) return "Windows";
  if (/Macintosh/.test(UA)) return "Mac";
  return IS_PHONE ? "スマホ" : "PC";
}
const DEV = {
  id: ls.get("dev", null) || (() => { const id = newId("d"); ls.set("dev", id); return id; })(),
  get name(){ return ls.get("devName", "") || defaultDevName(); },
  kind: IS_PHONE ? "phone" : "pc",
};

// ---------- dates ----------
const DOW = ["日","月","火","水","木","金","土"];
const pad2 = n => String(n).padStart(2, "0");
function dayKey(t){ const d = new Date(t); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function clock(t){ const d = new Date(t); return `${d.getHours()}:${pad2(d.getMinutes())}`; }
function dayHead(t){
  const d = new Date(t), now = Date.now(), label = `${d.getMonth() + 1}/${d.getDate()}(${DOW[d.getDay()]})`;
  if (dayKey(t) === dayKey(now)) return "今日 " + label;
  if (dayKey(t) === dayKey(now - 86400e3)) return "昨日 " + label;
  return (d.getFullYear() !== new Date(now).getFullYear() ? d.getFullYear() + "年 " : "") + label;
}
function agoText(t){
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return "たった今";
  if (m < 60) return `${m}分前`;
  if (dayKey(t) === dayKey(Date.now())) return clock(t);
  return dayHead(t).replace(/^(今日|昨日) .*/, "$1") + " " + clock(t);
}

// ---------- helpers ----------
function h(tag, attrs, ...kids){
  const el = document.createElement(tag);
  if (attrs) for (const k in attrs){
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()){ if (c == null || c === false) continue; el.append(c.nodeType ? c : document.createTextNode(String(c))); }
  return el;
}
const str = (v, n) => typeof v === "string" ? v.slice(0, n) : "";
const num = v => typeof v === "number" && isFinite(v) ? v : null;
function newId(prefix){ const a = new Uint8Array(10); crypto.getRandomValues(a); return prefix + Array.from(a, b => (b % 36).toString(36)).join(""); }
function sizeText(n){
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return Math.round(n / 1024) + " KB";
  return (n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0) + " MB";
}
const URL_RE = /https?:\/\/[^\s<>"'「」()()]+/g;
// the whole text is a single URL (shared pages often arrive like this)
const onlyUrl = t => { const s = (t || "").trim(); return /^https?:\/\/\S+$/.test(s) && s.length <= URL_MAX ? s : ""; };
function hostOf(u){ try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } }

// ---------- toast (with an optional action, e.g. 取り消す) ----------
let toastT;
function toast(msg, err, action){
  const t = $("toast");
  t.replaceChildren(h("span", { text:msg }));
  if (action) t.append(h("button", { type:"button", class:"toast-act", onclick:() => { t.classList.remove("show"); clearTimeout(toastT); action.fn(); } }, action.label));
  t.classList.toggle("err", !!err); t.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), action ? 5000 : 2200);
}
async function copyText(text, okMsg){
  try { await navigator.clipboard.writeText(text); toast(okMsg || "コピーしました"); return; } catch {}
  const ta = h("textarea", { style:"position:fixed;top:0;left:0;opacity:0" }); ta.value = text; document.body.append(ta);
  ta.select(); let ok = false; try { ok = document.execCommand("copy"); } catch {}
  ta.remove();
  toast(ok ? (okMsg || "コピーしました") : "コピーできませんでした。もう一度押してください", !ok);
}

function fail(msg){
  S.fatal = msg;
  render();
}

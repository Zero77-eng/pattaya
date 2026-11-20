/* パタヤ攻略 アプリ本体。
   無料データ(data/free)は誰でも読む。
   有料データ(data/paid)は、合言葉を入れた人の端末だけが取りに行き、端末の中で開く(暗号を解く)。
   合言葉を入れていない端末は、有料のファイルをダウンロードしない。 */
(function () {
  "use strict";
  var KEY = "pt_data_v1";
  var FILES = ["menus", "shops", "articles", "links", "changes"];
  var PREVIEW = /[?&]preview=1/.test(location.search);
  var LIVE = /[?&]live=1/.test(location.search); // 編集画面の横に出す「書きながら見える」画面。データは編集画面から受け取る
  var DATA = null; // {version, updated, app_name, menus, shops, articles, links}
  var PAID = null; // 開いた有料データ {version, label, shops, articles, photos}  ※端末の中だけ
  var PASS_KEY = "pt_pass", STALE_KEY = "pt_stale";

  var $ = function (s) { return document.querySelector(s); };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function toast(msg) {
    var t = $("#toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(function () { t.hidden = true; }, 3500);
  }

  /* ---------- データの保存と更新 ---------- */
  function loadLocal() {
    try { var s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  }
  function saveLocal(d) {
    try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* 容量不足などは無視 */ }
  }
  /* 端末の中の保存場所(有料データは写真も入るので、容量の大きいIndexedDBを使う) */
  function idb() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open("pt_paid", 1);
      r.onupgradeneeded = function () { r.result.createObjectStore("kv"); };
      r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
    });
  }
  function idbGet(k) { return idb().then(function (db) { return new Promise(function (res) { var q = db.transaction("kv").objectStore("kv").get(k); q.onsuccess = function () { res(q.result || null); }; q.onerror = function () { res(null); }; }); }).catch(function () { return null; }); }
  function idbSet(k, v) { return idb().then(function (db) { return new Promise(function (res, rej) { var t = db.transaction("kv", "readwrite"); if (v == null) t.objectStore("kv").delete(k); else t.objectStore("kv").put(v, k); t.oncomplete = res; t.onerror = function () { rej(t.error); }; }); }); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }

  function unb64(t) { var b = atob(t), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  /* 合言葉で開く。合言葉が違うと、ここで必ず失敗する */
  function decryptPaid(enc, pass) {
    var te = new TextEncoder();
    return crypto.subtle.importKey("raw", te.encode(pass), "PBKDF2", false, ["deriveKey"]).then(function (km) {
      return crypto.subtle.deriveKey({ name: "PBKDF2", salt: unb64(enc.salt), iterations: enc.iter, hash: "SHA-256" }, km, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    }).then(function (key) {
      return crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(enc.iv) }, key, unb64(enc.ct));
    }).then(function (buf) { return JSON.parse(new TextDecoder().decode(buf)); });
  }
  /* 有料のPDF: 1つずつ別ファイルで暗号化されている。開いて端末に保存する */
  function decKey(enc, pass) {
    return crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]).then(function (km) {
      return crypto.subtle.deriveKey({ name: "PBKDF2", salt: unb64(enc.salt), iterations: enc.iter, hash: "SHA-256" }, km, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    });
  }
  function syncPdfs(enc, pass, names) {
    if (!names || !names.length) return Promise.resolve(false);
    return decKey(enc, pass).then(function (key) {
      var got = false;
      return names.reduce(function (chain, name) {
        return chain.then(function () {
          return idbGet("pdf:" + name).then(function (have) {
            if (have) return;
            return fetch("data/paid/" + (/\.mp4$/.test(name) ? "vid-" : "pdf-") + name.replace(/\.(pdf|mp4)$/, "") + ".bin?t=" + Date.now(), { cache: "no-store" }).then(function (r) {
              if (!r.ok) throw new Error(name); return r.arrayBuffer();
            }).then(function (buf) {
              return crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(buf, 0, 12) }, key, new Uint8Array(buf, 12));
            }).then(function (plain) { return idbSet("pdf:" + name, plain); }).then(function () { got = true; }).catch(function () {});
          });
        });
      }, Promise.resolve()).then(function () { return got; });
    });
  }
  function afterPaid(enc, pass, hadPdfs) {
    var names = (PAID && PAID.pdfs) || [];
    if (!names.length) return Promise.resolve();
    toast("PDF・動画を保存しています…");
    return syncPdfs(enc, pass, names).then(function (got) { render(true); if (got) toast("保存しました(オフラインでも見られます)"); }).catch(function () {});
  }
  /* 動画: 無料のものは「保存」でオフライン用に端末へ。有料のものは端末に保存済みの暗号を解いたものを再生 */
  function saveVideo(btn) {
    var name = btn.getAttribute("data-vsave");
    if (!navigator.onLine) { toast("ネットにつながっていません"); return; }
    btn.disabled = true; btn.textContent = "保存しています…(動画が大きいと時間がかかります)";
    caches.open("pt-video").then(function (c) { return c.add("video/" + name); }).then(function () {
      btn.textContent = "✔ 保存しました(オフラインで見られます)"; toast("動画を保存しました");
    }).catch(function () { btn.disabled = false; btn.textContent = "📥 オフラインで見られるように保存"; toast("保存できませんでした"); });
  }
  function markSavedVideos() {
    var bs = document.querySelectorAll("[data-vsave]");
    if (!bs.length || !window.caches) return;
    caches.open("pt-video").then(function (c) {
      bs.forEach(function (b) {
        c.match("video/" + b.getAttribute("data-vsave")).then(function (hit) { if (hit) { b.disabled = true; b.textContent = "✔ 保存済み(オフラインで見られます)"; } });
      });
    });
  }
  function playPaidVideo(btn) {
    var name = btn.getAttribute("data-video");
    idbGet("pdf:" + name).then(function (buf) {
      if (!buf) { toast("この動画はまだ保存されていません。ネットにつないで、アプリを開き直してください"); return; }
      var v = document.createElement("video");
      v.controls = true; v.setAttribute("playsinline", ""); v.autoplay = true; v.className = "paidvideo";
      v.src = URL.createObjectURL(new Blob([buf], { type: "video/mp4" }));
      btn.replaceWith(v);
    });
  }
  function openPdf(name) {
    var w = window.open("", "_blank");
    idbGet("pdf:" + name).then(function (buf) {
      if (!buf) { if (w) w.close(); toast("このPDFはまだ保存されていません。ネットにつないで、アプリを開き直してください"); return; }
      var url = URL.createObjectURL(new Blob([buf], { type: "application/pdf" }));
      if (w) w.location.href = url; else location.href = url;
      setTimeout(function () { URL.revokeObjectURL(url); }, 120000);
    });
  }
  /* 合言葉を入れた直後の「開く」 */
  function unlock(pass) {
    pass = String(pass || "").trim();
    if (!pass) return Promise.resolve({ ok: false, msg: "合言葉を入れてください" });
    if (!navigator.onLine) return Promise.resolve({ ok: false, msg: "ネットにつながっていません。つながる場所でもう一度お試しください" });
    if (!(window.crypto && crypto.subtle)) return Promise.resolve({ ok: false, msg: "この端末のブラウザでは開けません" });
    return getJSON("data/paid/night.json").then(function (enc) {
      return decryptPaid(enc, pass).then(function (data) {
        PAID = { version: "", label: enc.label, shops: data.shops || [], articles: data.articles || [], photos: data.photos || {}, pdfs: data.pdfs || [] };
        return getJSON("data/free/meta.json").catch(function () { return {}; }).then(function (meta) {
          PAID.version = (meta.paid && meta.paid.version) || "";
          lsSet(PASS_KEY, pass); lsSet(STALE_KEY, null);
          return idbSet("paid", PAID).catch(function () {}).then(function () { afterPaid(enc, pass); return { ok: true }; });
        });
      }, function () { return { ok: false, msg: "合言葉が違います" }; });
    }, function () { return { ok: false, msg: "いまは夜情報が公開されていません" }; });
  }
  function lockAgain() {
    var names = (PAID && PAID.pdfs) || [];
    PAID = null; lsSet(PASS_KEY, null); lsSet(STALE_KEY, null);
    return Promise.all(names.map(function (n) { return idbSet("pdf:" + n, null).catch(function () {}); })).then(function () { return idbSet("paid", null).catch(function () {}); });
  }
  /* 起動のたびに、覚えている合言葉で新しい夜情報を取る(合言葉が変わっていたら、古い情報を残す) */
  function refreshPaid(meta) {
    var pass = lsGet(PASS_KEY);
    if (!pass || !meta || !meta.paid) return Promise.resolve();
    if (PAID && PAID.version === meta.paid.version) return Promise.resolve();
    return getJSON("data/paid/night.json").then(function (enc) {
      return decryptPaid(enc, pass).then(function (data) {
        var had = !!PAID;
        PAID = { version: meta.paid.version, label: enc.label, shops: data.shops || [], articles: data.articles || [], photos: data.photos || {}, pdfs: data.pdfs || [] };
        lsSet(STALE_KEY, null);
        return idbSet("paid", PAID).catch(function () {}).then(function () { render(true); if (had) toast("夜情報を更新しました"); return afterPaid(enc, pass); });
      }, function () {
        lsSet(STALE_KEY, "1"); render();
        toast("夜情報の合言葉が変わりました。新しい合言葉を入れてください");
      });
    }).catch(function () {});
  }

  function getJSON(path) {
    return fetch(path + "?t=" + Date.now(), { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error(path); return r.json();
    });
  }
  function checkUpdate(manual) {
    if (LIVE) return Promise.resolve();
    if (!navigator.onLine) { if (manual) toast("ネットにつながっていません"); return Promise.resolve(); }
    return getJSON("data/free/meta.json").then(function (meta) {
      if (DATA && DATA.version === meta.version) { if (manual) toast("最新の状態です"); return refreshPaid(meta); }
      return Promise.all(FILES.map(function (f) { return getJSON("data/free/" + f + ".json"); })).then(function (arr) {
        var d = { version: meta.version, updated: meta.updated, app_name: meta.app_name };
        FILES.forEach(function (f, i) { d[f] = arr[i]; });
        var first = !DATA;
        return cachePhotos((meta.photos || []).map(function (n) { return "photos/" + n; }).concat((meta.pdfs || []).map(function (n) { return "pdf/" + n; }))).then(function () {
          DATA = d; saveLocal(d); render();
          if (!first) toast("新しいデータに更新しました");
        }).then(function () { return refreshPaid(meta); });
      });
    }).catch(function () { if (manual) toast("更新を確認できませんでした"); });
  }
  function cachePhotos(list) {
    if (!window.caches || !list.length) return Promise.resolve();
    return caches.open("pt-photos").then(function (c) {
      return Promise.all(list.map(function (path) {
        return c.match(path).then(function (hit) { return hit || c.add(path); }).catch(function () {});
      }));
    });
  }

  /* ---------- 文章の表示（かんたんな書き方） ---------- */
  function inline(s) {
    s = esc(s);
    var keep = [];
    function hold(h) { keep.push(h); return "\u0001" + (keep.length - 1) + "\u0001"; }
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, function (_, t, u) { return hold('<a href="' + u + '" target="_blank" rel="noopener">' + t + "</a>"); });
    s = s.replace(/https?:\/\/[^\s<>"')]+/g, function (u) { return hold('<a href="' + u + '" target="_blank" rel="noopener">' + u + "</a>"); });
    s = s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
    return s.replace(/\u0001(\d+)\u0001/g, function (_, i) { return keep[+i]; });
  }
  function renderBody(text) {
    var out = [], list = false, para = [];
    function endPara() { if (para.length) { out.push("<p>" + para.join("<br>") + "</p>"); para = []; } }
    function endList() { if (list) { out.push("</ul>"); list = false; } }
    String(text || "").split("\n").forEach(function (line) {
      var m;
      if (!line.trim()) { endPara(); endList(); return; }
      if ((m = line.match(/^!\[([^\]|]*)(?:\|(小|中|大))?\]\(([0-9a-f]{10}\.jpg)\)\s*$/))) { endPara(); endList(); out.push('<img class="' + ({ "小": "s", "大": "l" }[m[2]] || "m") + '" alt="' + esc(m[1]) + '" src="' + esc(photoSrc(m[3])) + '">'); return; }
      if ((m = line.match(/^\[\[PDF:([^|\]]*)\|([0-9a-f]{10}\.pdf)\]\]\s*$/))) {
        endPara(); endList();
        var own = PAID && PAID.pdfs && PAID.pdfs.indexOf(m[2]) !== -1;
        out.push(own
          ? '<button class="pdfcard" data-pdf="' + m[2] + '"><span class="ic">📄</span><span class="tx"><b>' + esc(m[1] || "PDF") + "</b><small>タップで開く(PDF)</small></span></button>"
          : '<a class="pdfcard" href="' + (LIVE ? "/pdfs/" : "pdf/") + m[2] + '" target="_blank" rel="noopener"><span class="ic">📄</span><span class="tx"><b>' + esc(m[1] || "PDF") + "</b><small>タップで開く(PDF)</small></span></a>");
        return;
      }
      if ((m = line.match(/^\[\[VIDEO:([^|\]]*)\|([0-9a-f]{10}\.mp4)\]\]\s*$/))) {
        endPara(); endList();
        var ownV = PAID && PAID.pdfs && PAID.pdfs.indexOf(m[2]) !== -1;
        out.push(ownV
          ? '<button class="pdfcard" data-video="' + m[2] + '"><span class="ic">▶️</span><span class="tx"><b>' + esc(m[1] || "動画") + "</b><small>タップで再生(動画)</small></span></button>"
          : '<div class="vidcard"><video controls playsinline preload="metadata" src="' + (LIVE ? "/videos/" : "video/") + m[2] + '"></video><div class="vcap">' + esc(m[1] || "動画") + '</div><button class="vsave" data-vsave="' + m[2] + '">📥 オフラインで見られるように保存</button></div>');
        return;
      }
      if ((m = line.match(/^###\s*(.+)/))) { endPara(); endList(); out.push("<h4>" + inline(m[1]) + "</h4>"); return; }
      if ((m = line.match(/^##\s*(.+)/))) { endPara(); endList(); out.push("<h3>" + inline(m[1]) + "</h3>"); return; }
      if ((m = line.match(/^(?:- +|・\s*)(.+)/))) { endPara(); if (!list) { out.push("<ul>"); list = true; } out.push("<li>" + inline(m[1]) + "</li>"); return; }
      endList(); para.push(inline(line));
    });
    endPara(); endList();
    return out.join("");
  }

  /* ---------- 画面 ---------- */
  function oldDays(d) { return d ? Math.floor((Date.now() - new Date(d).getTime()) / 864e5) : 9999; }
  /* 無料データと有料データに同じIDがあるときは、無料側(新しいほう)だけを使う(同じ記事が2つ出ないように) */
  function merge(base, extra) {
    var ids = {}; base.forEach(function (x) { ids[x.id] = 1; });
    return base.concat((extra || []).filter(function (x) { return !ids[x.id]; }));
  }
  function allShops() { return merge(DATA.shops, PAID && PAID.shops); }
  function allArticles() { return merge(DATA.articles, PAID && PAID.articles); }
  function photoSrc(n) { return PAID && PAID.photos && PAID.photos[n] ? PAID.photos[n] : (LIVE ? "/photos/" : "photos/") + n; }
  function menuItems(menu) {
    return {
      articles: allArticles().filter(function (a) { return a.menu === menu.name; }),
      shops: allShops().filter(function (s) { return s.menu === menu.name; })
    };
  }
  /* メニュー名を、意味のまとまりで折り返す(「スケジュール管/理」のような変なところで切れない) */
  function nameBr(n) {
    return esc(n).replace(/(・|から|と|の)(?=.)/g, "$1<wbr>").replace(/(?=管理|フレーズ|情報|相場表|注意)(?<=.)/g, "<wbr>");
  }
  function hasContent(menu) {
    if (menu.id === "packing") return true; var m = menuItems(menu); return m.articles.length + m.shops.length > 0; }

  var ICON = { flight: "✈️", hotel: "🏨", packing: "🧳", sim: "📶", immigration: "🛂", schedule: "🗓️", airport: "🚌", songthaew: "🛺", ride: "🚕", money: "💴", sightseeing: "🏝️", food: "🍜", massage: "💆", prices: "🧾", thai: "💬", about: "📖", caution: "⚠️", law: "⚖️", pr: "📣", news: "🔔", night: "🌙" };
  var COLOR = { "準備": "#3b82c4", "移動": "#12a594", "現地": "#e8702a", "知識": "#7c5cbf", "安全": "#d64545", "その他": "#6b7280", "夜": "#c9a227" };
  /* TOPの「更新情報」: 公開のたびに、新しい記事・直した記事を自動で出す */
  function updRow(e) {
    var href = e.type === "お店" ? "#/shop/" : "#/article/";
    return '<a class="upd" href="' + href + esc(e.id) + '"><span class="d">' + esc(String(e.date).slice(5).replace("-", "/")) + '</span><span class="k ' + (e.kind === "new" ? "n" : "u") + '">' + (e.kind === "new" ? "新規" : "更新") + '</span><span class="t">' + esc(e.title) + '<small>' + esc(e.menu) + "</small></span></a>";
  }
  /* TOPの一番上: 持ち物チェック(行き・帰り) */
  function packBox() {
    var g = window.PTPacking.counts("go"), b = window.PTPacking.counts("back");
    return '<div class="packbox"><a href="#/packing"><span class="pi">🛫</span><span class="pt"><b>行きの持ち物</b><small>' + g.done + " / " + g.all + ' そろった</small></span></a>' +
      '<a href="#/packing/back"><span class="pi">🛬</span><span class="pt"><b>帰りの忘れ物</b><small>お土産も ・' + b.done + " / " + b.all + '</small></span></a></div>';
  }
  function updatesBox(n) {
    var list = (DATA.changes || []).filter(function (e) { return e.type === "お店" ? !!allShops().filter(function (s) { return s.id === e.id; })[0] : !!allArticles().filter(function (a) { return a.id === e.id; })[0]; });
    if (!list.length) return "";
    return '<div class="updbox"><div class="uh"><b>🆕 更新情報</b>' + (list.length > n ? '<a href="#/updates">すべて見る ›</a>' : "") + "</div>" + list.slice(0, n).map(updRow).join("") + "</div>";
  }
  function viewUpdates() {
    var h = updatesBox(30).replace(/<div class="uh">.*?<\/div>/, "");
    return { title: "更新情報", html: h || '<div class="soonbox"><p>まだ更新情報はありません。</p></div>', back: "#/" };
  }
  function viewHome() {
    var stages = [], by = {};
    DATA.menus.forEach(function (m) { if (m.hidden) return; if (!by[m.stage]) { by[m.stage] = []; stages.push(m.stage); } by[m.stage].push(m); });
    var h = packBox() + updatesBox(3);
    var own = ownerCards(stages);
    stages.forEach(function (st) {
      h += own[st] || "";
      var c = COLOR[st] || "#6b7280";
      h += '<div class="stage" style="--c:' + c + '"><i></i>' + esc(st) + '</div><div class="grid">';
      by[st].forEach(function (m) {
        var ic = '<span class="ic" style="--c:' + c + '">' + (ICON[m.id] || "•") + "</span>";
        var shortTx = esc(m.short || m.desc);
        if (m.locked) {
          var open = !!PAID;
          h += '<a class="menu lock" href="#/menu/' + m.id + '">' + ic + '<span class="tx"><b>' + (open ? "" : "🔒 ") + esc(m.name) + '</b><span class="sh">' + esc(open ? (PAID.label || "メンバー限定") + "を開いています" : m.desc) + '</span></span><span class="badge">' + (open ? "開いています" : "メンバー限定") + "</span></a>";
        } else {
          var soon = m.id === "schedule" ? false : !hasContent(m);
          h += '<a class="menu' + (soon ? " soon" : "") + '" href="#/' + (m.id === "schedule" ? "schedule" : "menu/" + m.id) + '" style="--c:' + c + '"><span class="top">' + ic + "<b>" + nameBr(m.name) + '</b></span><span class="sh">' + (soon ? "準備中" : shortTx) + "</span></a>";
        }
      });
      h += "</div>";
    });
    h += '<p class="note" style="margin-top:28px;text-align:center">データ更新日: ' + esc(DATA.updated || "-") + "</p>";
    return { title: DATA.app_name || "パタヤ攻略", html: h };
  }
  function passForm(stale) {
    return (stale ? staleBanner() : "") + '<div class="card passbox"><h3>合言葉を入れる</h3><p class="meta">メンバー限定の投稿でお知らせした合言葉です。</p>' +
      '<input id="pw" type="text" inputmode="latin" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="合言葉">' +
      '<button class="btn" data-unlock="1">開く</button><div id="pwmsg" class="note"></div></div>';
  }
  function staleBanner() { return '<div class="card warnbox"><b>合言葉が変わりました</b><p class="meta">いま見えているのは、前に開いた古い情報です。新しい合言葉を入れると、最新の夜情報になります。</p></div>'; }
  /* TOPの「運営者より」: メニュー「運営者より」の記事を、細い1行のカードで、各区分の間に差し込む。
     置き場所: 既定は「移動」の前(準備と移動の間)。YouTubeだけ「夜」の前。 */
  var OWNER_BEFORE = { "pr-youtube": "夜" }, OWNER_DEFAULT_BEFORE = "移動", OWNER_ICON = { "owner-aicamp": "🎓", "pr-youtube": "▶️" }, OWNER_SHORT = { "owner-aicamp": "パタヤで学ぶ1週間のAI講座", "pr-youtube": "運営者のチャンネル" };
  function ownerCards(stages) {
    var list = allArticles().map(function (a, i) { return { a: a, i: i }; }).filter(function (x) { return x.a.menu === "運営者より"; })
      .sort(function (x, y) { return String(y.a.updated).localeCompare(String(x.a.updated)) || y.i - x.i; });
    var out = {};
    list.forEach(function (x) {
      var a = x.a, before = OWNER_BEFORE[a.id] || OWNER_DEFAULT_BEFORE;
      if (stages.indexOf(before) === -1) before = stages[0];
      var sum = String(a.body).split("\n").map(function (l) { return l.trim(); }).filter(function (l) { return l && !/^(#|-|・|!\[|\[\[)/.test(l); })[0] || "";
      sum = OWNER_SHORT[a.id] || sum.replace(/\*\*/g, "");
      out[before] = (out[before] || "") + '<a class="owner-row" href="#/article/' + esc(a.id) + '"><span class="ic" style="--c:#e8702a">' + (OWNER_ICON[a.id] || "📌") + '</span><span class="tx"><b>' + esc(a.title) + "</b>" + (sum ? "<small>" + esc(sum) + "</small>" : "") + '</span><span class="tag-o">運営者より</span></a>';
    });
    return out;
  }
  function soonBox(msg) { return '<div class="soonbox"><div class="big">🛠</div><h2>準備中</h2><p>' + esc(msg || "もうすぐ公開します。") + "</p></div>"; }

  function viewMenu(id) {
    var menu = DATA.menus.filter(function (m) { return m.id === id; })[0];
    if (!menu) return viewHome();
    if (menu.id === "schedule") return window.PTSchedule.view("");
    if (menu.locked && !PAID) {
      return { title: menu.name, html: '<div class="soonbox"><div class="big">🔒</div><h2>メンバー限定</h2><p>' + esc(menu.desc) + "</p></div>" + passForm(!!lsGet(STALE_KEY)) };
    }
    var it = menuItems(menu);
    if (!it.articles.length && !it.shops.length && menu.id !== "packing") return { title: menu.name, html: soonBox() };
    var h = "";
    if (menu.id === "packing") { var pc = window.PTPacking.counts("go"); h += '<a class="card art-card pk-link" href="#/packing"><span class="ic" style="--c:#16a34a">✅</span><span class="tx"><h3>持ち物チェックリスト</h3><div class="meta">' + pc.done + " / " + pc.all + ' そろった・追加や削除もできます</div></span><span class="chev">›</span></a>'; }
    h += menu.locked ? '<div class="note" style="text-align:right">' + esc(PAID.label || "") + "</div>" : "";
    if (menu.locked && lsGet(STALE_KEY)) h += passForm(true);
    it.articles.forEach(function (a) {
      var pm = String(a.body || "").match(/\(([0-9a-f]{10}\.jpg)\)/);
      var bg = pm ? ' has-img" style="--img:url(\'' + photoSrc(pm[1]) + '\')' : "";
      h += '<a class="card art-card' + bg + '" href="#/article/' + esc(a.id) + '"><span class="ic" style="--c:#3b82c4">📄</span><span class="tx"><h3>' + esc(a.title) + '</h3><div class="meta">' + esc(a.updated) + ' 更新</div></span><span class="chev">›</span></a>';
    });
    it.shops.slice().sort(function (a, b) { return (a.area || "").localeCompare(b.area || "", "ja"); }).forEach(function (s) {
      h += '<a class="card" href="#/shop/' + esc(s.id) + '"><span class="chip">' + esc(s.area) + '</span><h3>' + esc(s.name) + '</h3>' + (s.price ? '<div class="meta">' + esc(s.price) + "</div>" : "") +
        (s.comment ? "<p>" + esc(s.comment) + "</p>" : "") + chk(s.checked) + "</a>";
    });
    return { title: menu.name, html: h };
  }
  function chk(d) {
    var o = oldDays(d) > 180;
    return '<div class="chk' + (o ? " old" : "") + '">最終確認 ' + esc(d) + (o ? "（古い情報の可能性があります）" : "") + "</div>";
  }
  function viewShop(id) {
    var s = allShops().filter(function (x) { return x.id === id; })[0];
    if (!s) return viewHome();
    var h = "<h2>" + esc(s.name) + "</h2>" + (s.name_local ? '<div class="meta" style="color:var(--sub)">' + esc(s.name_local) + "</div>" : "");
    h += (s.menu === "PR" ? '<span class="tag pr">PR</span>' : "") + (s.tags || []).map(function (t) { return '<span class="tag">' + esc(t) + "</span>"; }).join("");
    h += '<dl class="dl"><dt>エリア</dt><dd>' + esc(s.area) + "</dd><dt>住所</dt><dd>" + esc(s.address) + "</dd>";
    if (s.hours) h += "<dt>営業時間</dt><dd>" + esc(s.hours) + "</dd>";
    if (s.price) h += "<dt>相場</dt><dd>" + esc(s.price) + "</dd>";
    h += "</dl>";
    if (s.comment) h += "<p>" + esc(s.comment).replace(/\n/g, "<br>") + "</p>";
    h += '<div class="photos">' + (s.photos || []).map(function (n) { return '<img class="m" src="' + esc(photoSrc(n)) + '" alt="">'; }).join("") + "</div>";
    h += chk(s.checked);
    h += '<a class="btn sub" href="#/schedule/add/' + esc(s.id) + '">🗓 予定に追加</a>';
    var mh = mapHref(s);
    if (mh) h += '<a class="btn" target="_blank" rel="noopener" href="' + esc(mh) + '">Googleマップで開く</a><div class="note">地図を開くにはネットが必要です。</div>';
    return { title: s.name, html: h, back: "#/menu/" + menuIdByName(s.menu) };
  }
  /* 地図のリンク: 保存したGoogleマップのリンク → 店名＋住所で検索 → 座標、の順 */
  function mapHref(s) {
    if (s.map_url && /^https:\/\/(www\.google\.[a-z.]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps|maps\.google\.[a-z.]+)/i.test(s.map_url)) return s.map_url;
    var q = ((s.name_local || s.name || "") + " " + (s.address || "")).trim();
    if (q) return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q);
    if (s.lat !== "" && s.lat != null && s.lng !== "" && s.lng != null) return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(s.lat + "," + s.lng);
    return "";
  }
  function menuIdByName(n) { var m = DATA.menus.filter(function (x) { return x.name === n; })[0]; return m ? m.id : ""; }
  function viewArticle(id) {
    var a = allArticles().filter(function (x) { return x.id === id; })[0];
    if (!a) return viewHome();
    var h = "<h2>" + esc(a.title) + '</h2><div class="chk">最終更新 ' + esc(a.updated) + '</div><div class="art">' + renderBody(a.body) + "</div>";
    var rel = (a.related || []).map(function (rid) { return DATA.links.filter(function (l) { return l.id === rid; })[0]; }).filter(Boolean);
    if (rel.length) {
      h += '<div class="stage">関連リンク</div>';
      rel.forEach(function (l) {
        h += '<div class="card"><h3>' + esc(l.label) + "</h3>" + (l.pr === "あり" ? '<span class="tag pr">PR</span>' : "") +
          '<a class="btn" style="margin-bottom:0" target="_blank" rel="noopener" href="' + esc(l.url) + '">開く</a><div class="note">開くにはネットが必要です。</div>' +
          (l.code ? '<div class="code"><code>' + esc(l.code) + '</code><button data-copy="' + esc(l.code) + '">コピー</button></div>' : "") + "</div>";
      });
    }
    return { title: a.title, html: h, back: "#/menu/" + menuIdByName(a.menu) };
  }
  function viewSettings() {
    var h = "<h2>設定</h2><dl class=\"dl\"><dt>データ</dt><dd>" + esc((DATA && DATA.updated) || "-") + " 版</dd><dt>状態</dt><dd>" + (navigator.onLine ? "オンライン" : "オフライン(保存済みのデータを表示中)") + "</dd></dl>";
    h += '<button class="btn" id="upd">最新データを確認する</button>';
    h += '<div class="stage">メンバー限定</div>';
    if (PAID) {
      h += '<div class="card"><h3>🌙 夜情報を開いています</h3><p class="meta">' + esc(PAID.label || "") + '。この端末に保存されています。</p>' + (lsGet(STALE_KEY) ? staleBanner() : "") + "</div>" +
        (lsGet(STALE_KEY) ? passForm(false) : "") +
        '<button class="btn sub" data-lock="1">夜情報をこの端末から消す</button>';
    } else {
      h += passForm(false);
    }
    return { title: "設定", html: h, back: "#/" };
  }

  function render(keep) {
    var keepY = window.scrollY;
    var hash = location.hash || "#/", p = hash.replace(/^#\/?/, "").split("/"), v;
    if (!DATA) { v = { title: "パタヤ攻略", html: '<div class="soonbox"><p>データを読み込み中…<br>初めて開くときは、ネットにつながった状態で開いてください。</p></div>' }; }
    else if (p[0] === "menu") v = viewMenu(p[1]);
    else if (p[0] === "shop") v = viewShop(p[1]);
    else if (p[0] === "article") v = viewArticle(p[1]);
    else if (p[0] === "packing") v = window.PTPacking.view(p[1]);
    else if (p[0] === "updates") v = viewUpdates();
    else if (p[0] === "settings") v = viewSettings();
    else if (p[0] === "schedule") v = window.PTSchedule.view(p[1], p[2]);
    else v = viewHome();
    var isHome = !(p[0] && p[0] !== "") || (v === undefined);
    document.body.classList.toggle("home", !!DATA && isHome);
    var sub = $("#sub"); sub.hidden = !(DATA && isHome); sub.textContent = "オフラインで使えます";
    $("#title").textContent = v.title;
    $("#view").innerHTML = v.html;
    var back = $("#back");
    var target = v.back || (p[0] && p[0] !== "" ? "#/" : "");
    back.hidden = !target; back.dataset.to = target;
    $("#home").hidden = !target;
    document.title = v.title;
    window.scrollTo(0, keep === true ? keepY : 0);
    var u = $("#upd"); if (u) u.onclick = function () { checkUpdate(true); };
    markSavedVideos();
  }

  document.addEventListener("click", function (e) {
    var im = e.target.closest(".art img, .photos img");
    if (im) { im.classList.toggle("zoom"); return; }
    var vb = e.target.closest("[data-video]");
    if (vb) { playPaidVideo(vb); return; }
    var vs = e.target.closest("[data-vsave]");
    if (vs) { saveVideo(vs); return; }
    var pb = e.target.closest("[data-pdf]");
    if (pb) { openPdf(pb.getAttribute("data-pdf")); return; }
    var ub = e.target.closest("[data-unlock]");
    if (ub) {
      var pw = $("#pw"), msg = $("#pwmsg"); ub.disabled = true; msg.textContent = "確認しています…";
      unlock(pw && pw.value).then(function (r) {
        if (r.ok) { toast("夜情報を開きました"); render(); } else { ub.disabled = false; msg.textContent = r.msg; }
      });
      return;
    }
    if (e.target.closest("[data-lock]")) { if (confirm("夜情報をこの端末から消します。よろしいですか?")) lockAgain().then(function () { toast("消しました"); render(); }); return; }
    var b = e.target.closest("[data-copy]");
    if (b) {
      var t = b.getAttribute("data-copy");
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { toast("コピーしました"); }, function () { toast("コピーできませんでした。文字を長押ししてコピーしてください"); });
    }
  });
  $("#back").onclick = function () { location.hash = $("#back").dataset.to || "#/"; };
  $("#home").onclick = function () { location.hash = "#/"; };
  $("#gear").onclick = function () { location.hash = "#/settings"; };
  window.addEventListener("hashchange", function () { render(); });
  window.PT = { esc: esc, toast: toast, render: render, findShop: function (id) { return DATA ? allShops().filter(function (x) { return x.id === id; })[0] : null; } };
  window.addEventListener("online", function () { checkUpdate(false); });

  /* ---------- 起動 ---------- */
  if (LIVE) {
    /* 書きながら見える画面: 編集画面から送られてきた内容をそのまま表示する(保存・公開とは無関係) */
    window.addEventListener("message", function (e) {
      var m = e.data;
      if (e.origin !== location.origin || !m || m.pt !== "live") return;
      DATA = m.data;
      var h = "#/" + m.kind + "/" + m.id;
      if (location.hash === h) render(true); else location.hash = h;
    });
    render();
    try { parent.postMessage({ pt: "live-ready" }, location.origin); } catch (e) {}
    return;
  }
  DATA = loadLocal();
  render();
  idbGet("paid").then(function (p) { if (p) { PAID = p; render(); } }).then(function () { return checkUpdate(false); }).then(function () {
    /* 途中で止まって保存できていないPDFがあれば、続きを取る */
    var pass = lsGet(PASS_KEY);
    if (!PAID || !pass || !PAID.pdfs || !PAID.pdfs.length || !navigator.onLine) return;
    return Promise.all(PAID.pdfs.map(function (n) { return idbGet("pdf:" + n); })).then(function (have) {
      if (have.every(Boolean)) return;
      return getJSON("data/paid/night.json").then(function (enc) { return afterPaid(enc, pass); });
    }).catch(function () {});
  });

  if ("serviceWorker" in navigator && !PREVIEW) {
    window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });
  }
})();

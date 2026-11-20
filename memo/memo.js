/* 取材メモ: スマホの中に記録して、あとでPCに送る(通信なしで使えます) */
(function () {
  "use strict";
  var KINDS = [["food", "🍜", "食事"], ["spot", "📸", "観光・体験"], ["massage", "💆", "マッサージ"], ["night", "🌙", "夜"], ["other", "📝", "その他"]];
  var MAXPH = 12;
  var $ = function (s, e) { return (e || document).querySelector(s); };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function kindOf(k) { for (var i = 0; i < KINDS.length; i++) if (KINDS[i][0] === k) return KINDS[i]; return KINDS[4]; }
  function jp(s) { return String(s).split("¦").join("<wbr>"); }
  function p2(n) { return (n < 10 ? "0" : "") + n; }
  function fmt(ms) { var d = new Date(ms); return p2(d.getMonth() + 1) + "/" + p2(d.getDate()) + " " + p2(d.getHours()) + ":" + p2(d.getMinutes()); }
  function newId() { return "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  /* ---------- 保存(スマホの中) ---------- */
  var db;
  function openDB() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open("ptmemo", 1);
      r.onupgradeneeded = function () { r.result.createObjectStore("notes", { keyPath: "id" }); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function tx(mode, fn) {
    return new Promise(function (res, rej) {
      var t = db.transaction("notes", mode), out = fn(t.objectStore("notes"));
      t.oncomplete = function () { res(out && out.result); };
      t.onerror = function () { rej(t.error); };
    });
  }
  function allNotes() { return tx("readonly", function (s) { return s.getAll(); }).then(function (a) { return (a || []).sort(function (x, y) { return y.created - x.created; }); }); }
  function putNote(n) { return tx("readwrite", function (s) { return s.put(n); }); }
  function delNote(id) { return tx("readwrite", function (s) { return s.delete(id); }); }
  function getNote(id) { return tx("readonly", function (s) { return s.get(id); }); }

  var SET = { addr: "", pin: "" };
  try { SET = Object.assign(SET, JSON.parse(localStorage.getItem("ptm_set") || "{}")); } catch (e) {}
  function saveSet() { try { localStorage.setItem("ptm_set", JSON.stringify(SET)); } catch (e) {} }

  var toastT;
  function toast(m) { var t = $("#toast"); t.innerHTML = jp(m); t.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, 3200); }

  /* ---------- 写真を軽くする ---------- */
  function shrink(file) {
    return new Promise(function (res, rej) {
      var img = new Image(), u = URL.createObjectURL(file);
      img.onload = function () {
        var max = 1280, w = img.naturalWidth, h = img.naturalHeight;
        if (Math.max(w, h) > max) { var r = max / Math.max(w, h); w = Math.round(w * r); h = Math.round(h * r); }
        var c = document.createElement("canvas"); c.width = w; c.height = h;
        var x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, w, h); x.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(u);
        c.toBlob(function (b) { b ? res(b) : rej(new Error("写真を読み込めませんでした")); }, "image/jpeg", 0.72);
      };
      img.onerror = function () { URL.revokeObjectURL(u); rej(new Error("写真を読み込めませんでした")); };
      img.src = u;
    });
  }

  /* ---------- 場所 ---------- */
  function parseLL(t) {
    var ps = [/!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/, /[?&](?:q|ll|query|destination)=(-?\d{1,3}\.\d+)(?:,|%2C)(-?\d{1,3}\.\d+)/, /@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/, /^\s*(-?\d{1,3}\.\d+)\s*[,，]\s*(-?\d{1,3}\.\d+)\s*$/];
    for (var i = 0; i < ps.length; i++) { var m = String(t || "").match(ps[i]); if (m) return [parseFloat(m[1]), parseFloat(m[2])]; }
    return null;
  }
  function getPos() {
    return new Promise(function (res, rej) {
      if (!navigator.geolocation) return rej(new Error("このスマホでは現在地が使えません"));
      navigator.geolocation.getCurrentPosition(function (p) {
        res({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), acc: Math.round(p.coords.accuracy || 0) });
      }, function (e) {
        rej(new Error(e && e.code === 1 ? "現在地の許可がありません。スマホの設定で、このアプリの位置情報を許可してください" : "現在地を取れませんでした。空が見える場所でもう一度試してください"));
      }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
    });
  }
  function mapLink(n) { return "https://www.google.com/maps/search/?api=1&query=" + n.lat + "," + n.lng; }

  /* ---------- 画面 ---------- */
  var cur = null, NOTES = [], filter = "all", urls = [], saveT = null;

  function setHead(title, back, gear) {
    $("#ttl").textContent = title;
    $("#back").hidden = !back;
    $("#gear").hidden = !gear;
  }
  function thumbUrl(b) { var u = URL.createObjectURL(b); urls.push(u); return u; }
  function freeUrls() { urls.forEach(function (u) { URL.revokeObjectURL(u); }); urls = []; }

  function viewHome() {
    freeUrls();
    setHead("📝 取材メモ", false, true);
    allNotes().then(function (list) {
      NOTES = list;
      var un = list.filter(function (n) { return !n.synced; }), sy = list.length - un.length;
      var shown = list.filter(function (n) { return filter === "all" || (filter === "un" ? !n.synced : n.synced); });
      var h = '<div class="bigbtns"><button class="big" data-a="new">＋ くわしく書く</button><button class="big q" data-a="quick">⚡ 現在地だけ</button></div>';
      h += '<div class="card sync"><div class="t"><b>未送信 ' + un.length + '件</b><small>' + jp("部屋のWi-Fiで¦PCに送ります") + '</small></div><button class="btn" data-a="sync"' + (un.length ? "" : " disabled") + '>PCに送る</button></div>';
      h += '<div class="chips">' + [["all", "すべて " + list.length], ["un", "未送信 " + un.length], ["sy", "同期済み " + sy]].map(function (c) { return '<button class="chip' + (filter === c[0] ? " on" : "") + '" data-a="filter" data-v="' + c[0] + '">' + c[1] + "</button>"; }).join("") + "</div>";
      if (!shown.length) h += '<div class="empty">' + (list.length ? jp("この区分の¦メモはありません") : jp("まだメモがありません。¦お店や体験に行ったら、¦上のボタンで¦記録しましょう")) + "</div>";
      shown.forEach(function (n) {
        var k = kindOf(n.kind), th = n.photos && n.photos.length ? '<img src="' + thumbUrl(n.photos[0]) + '" alt="">' : k[1];
        var meta = '<span>' + k[1] + " " + k[2] + "</span><span>" + fmt(n.created) + "</span>" + ((n.photos && n.photos.length) || n.lat ? "<span>" + (n.photos && n.photos.length ? "📷" + n.photos.length + " " : "") + (n.lat ? "📍" : "") + "</span>" : "");
        h += '<div class="note" data-a="open" data-id="' + esc(n.id) + '"><div class="nth">' + th + '</div><div class="nb"><div class="nt">' + esc(n.name || "(名前なし)") + '</div><div class="nm">' + meta + '</div></div><span class="bd' + (n.synced ? " ok" : "") + '">' + (n.synced ? "同期済み" : "未送信") + "</span></div>";
      });
      h += '<div class="foot">' + (sy ? '<button class="btn sub" data-a="clean">同期済みを削除</button>' : "") + '<button class="btn sub" data-a="export"' + (un.length ? "" : " disabled") + ">ファイルに書き出す(予備)</button>" + (un.length ? "" : "") + "</div>";
      h += '<p class="hint">' + jp("写真や文章は、¦このスマホの中に保存されます。¦送ったあとも、¦自動では消えません。¦確認してから、¦「同期済みを削除」で¦消してください。") + "</p>";
      $("#app").innerHTML = h;
    });
  }

  function emptyNote(n) { return !n.name && !n.memo && !n.area && !n.price && !n.mapUrl && !n.lat && !(n.photos && n.photos.length) && !n.rating; }

  function viewEdit(id) {
    freeUrls();
    getNote(id).then(function (n) {
      if (!n) { location.hash = "#/"; return; }
      cur = n; setHead("メモを書く", true, false); drawEdit();
    });
  }
  function drawEdit() {
    var n = cur, h = "";
    h += '<div class="chips">' + KINDS.map(function (k) { return '<button class="chip' + (n.kind === k[0] ? " on" : "") + '" data-a="kind" data-v="' + k[0] + '">' + k[1] + " " + k[2] + "</button>"; }).join("") + "</div>";
    h += '<label class="f">名前</label><input type="text" data-f="name" value="' + esc(n.name) + '" placeholder="お店・場所・体験の名前">';
    h += '<label class="f">写真<small>' + jp("撮ると、¦写真アプリへの保存画面も出ます") + '</small></label>';
    h += '<div class="row2"><label class="btn" style="text-align:center">📷 撮る<input type="file" accept="image/*" capture="environment" id="cam" hidden></label><label class="btn sub" style="text-align:center">🖼 選ぶ<input type="file" accept="image/*" multiple id="pick" hidden></label></div>';
    h += '<div class="photos">' + (n.photos || []).map(function (b, i) { return '<div class="ph"><img src="' + thumbUrl(b) + '" alt=""><button data-a="rmph" data-i="' + i + '" aria-label="写真を消す">×</button></div>'; }).join("") + "</div>";
    if (n.photos && n.photos.length) h += '<div class="foot" style="margin-top:10px"><button class="btn sub" data-a="savephotos">💾 写真アプリに保存</button></div><p class="hint">' + jp("押すと、¦「画像を保存」などが出ます。¦保存される写真は、¦アプリ用に小さくした版です。¦大事な写真は、¦ふつうのカメラで撮って、¦「選ぶ」から入れてください。") + "</p>";
    h += '<label class="f">場所</label>';
    h += '<div class="row2"><button class="btn" data-a="loc">📍 現在地を記録</button><button class="btn sub" data-a="maps">🗺 マップで選ぶ</button></div>';
    h += '<div class="loc" id="locst">' + locText(n) + "</div>";
    h += '<input type="url" data-f="mapUrl" style="margin-top:8px" value="' + esc(n.mapUrl) + '" placeholder="Googleマップのリンクを貼る(あれば)">';
    h += '<p class="hint">' + jp("マップでお店を開き、¦「共有→リンクをコピー」して、¦戻ってここに貼ります。¦急ぐときは、¦「現在地を記録」だけで¦OKです。") + "</p>";
    h += '<div class="two"><div><label class="f">エリア・目印</label><input type="text" data-f="area" value="' + esc(n.area) + '" placeholder="ソイブッカオ など"></div><div><label class="f">値段</label><input type="text" data-f="price" value="' + esc(n.price) + '" placeholder="100バーツ"></div></div>';
    h += '<label class="f">評価</label><div class="stars">' + [1, 2, 3, 4, 5].map(function (i) { return '<button data-a="star" data-v="' + i + '" class="' + (n.rating >= i ? "on" : "") + '" aria-label="星' + i + '">★</button>'; }).join("") + "</div>";
    h += '<label class="f">どうだった?</label><textarea data-f="memo" placeholder="味、雰囲気、おすすめ、注意点など">' + esc(n.memo) + "</textarea>";
    h += '<div class="foot"><button class="btn" data-a="done">保存してもどる</button><button class="btn red" data-a="del">このメモを削除</button></div>';
    h += '<p class="hint">' + jp("入力すると、¦自動で保存されます。") + "</p>";
    $("#app").innerHTML = h;
  }
  function locText(n) {
    if (!n.lat) return '<span style="color:var(--sub)">場所は、まだ記録していません</span>';
    var s = n.locSrc === "map" ? "✔ マップで指定した場所" : "✔ 現在地を記録しました" + (n.acc ? "(誤差 約" + n.acc + "m)" : "");
    return s + ' <a href="' + esc(mapLink(n)) + '" target="_blank" rel="noopener">地図で確認</a>';
  }
  function persist(now) {
    clearTimeout(saveT);
    var go = function () { if (cur) { cur.updated = Date.now(); cur.synced = false; delete cur.syncedAt; return putNote(cur); } };
    if (now) return go() || Promise.resolve();
    saveT = setTimeout(go, 400);
  }
  function leaveEdit() {
    clearTimeout(saveT);
    var n = cur; cur = null;
    if (!n) return Promise.resolve();
    if (emptyNote(n)) return delNote(n.id);
    n.updated = Date.now();
    return putNote(n);
  }

  function viewSettings() {
    freeUrls();
    setHead("設定", true, false);
    var h = '<div class="card"><b>PCの受信先</b><p class="hint" style="margin-top:4px">' + jp("PCの編集アプリの「受信箱」に出る、¦アドレスと合言葉を入れます。") + '</p>';
    h += '<label class="f">アドレス</label><input type="text" id="s_addr" value="' + esc(SET.addr) + '" placeholder="192.168.1.5:8793" autocapitalize="off" autocorrect="off" spellcheck="false">';
    h += '<label class="f">合言葉(数字)</label><input type="text" id="s_pin" inputmode="numeric" value="' + esc(SET.pin) + '" placeholder="4けたの数字">';
    h += '<div class="foot"><button class="btn" data-a="saveset">保存</button><button class="btn sub" data-a="testpc">PCとつなぐ</button></div>';
    h += '<p class="hint">' + jp("「PCとつなぐ」で、¦PCの画面が開けば成功です。¦つながらないときは、¦スマホとPCが同じWi-Fiか、¦PCの受信が「入」に¦なっているか確認してください。") + "</p></div>";
    h += '<div class="card"><b>写真アプリへの保存</b><p class="hint" style="margin-top:4px">' + jp("「撮る」で撮ったあと、¦写真アプリに保存する画面を、¦自動で出します。") + '</p><div class="foot"><button class="chip' + (SET.autosave !== false ? " on" : "") + '" data-a="autosave">' + (SET.autosave !== false ? "自動で出す(入)" : "自動で出す(切)") + "</button></div></div>";
    h += '<div class="card"><b>送るときの確認画面について</b><p class="hint" style="margin-top:4px">' + jp("スマホによっては、¦送る直前に¦「安全ではない」という確認が出ます。¦自分のPCに送るだけなので、¦「送信する」(または「続行」)を¦押してください。") + '</p></div>';
    $("#app").innerHTML = h;
  }

  /* ---------- 送る ---------- */
  function cleanAddr(a) { return String(a || "").trim().replace(/^https?:\/\//, "").replace(/\/.*$/, ""); }
  function pack(n, withData) {
    var o = { id: n.id, kind: n.kind, name: n.name || "", area: n.area || "", memo: n.memo || "", price: n.price || "", rating: n.rating || 0, lat: n.lat || "", lng: n.lng || "", acc: n.acc || 0, locSrc: n.locSrc || "", mapUrl: n.mapUrl || "", created: n.created, updated: n.updated };
    return o;
  }
  function doSync() {
    var un = NOTES.filter(function (n) { return !n.synced; });
    if (!un.length) return toast("送るメモがありません");
    var addr = cleanAddr(SET.addr);
    if (!addr || !SET.pin) { toast("先に設定で、¦PCのアドレスと¦合言葉を入れてください"); location.hash = "#/settings"; return; }
    if (!confirm("PCの編集アプリで「受信を始める」を押してありますか?\n" + un.length + "件を送ります。")) return;
    var f = document.createElement("form");
    f.method = "POST"; f.action = "http://" + addr + "/receive"; f.enctype = "multipart/form-data"; f.style.display = "none";
    function hid(k, v) { var i = document.createElement("input"); i.type = "hidden"; i.name = k; i.value = v; f.appendChild(i); }
    hid("pin", SET.pin);
    hid("back", location.origin + location.pathname);
    var dt = new DataTransfer(), metas = [];
    un.forEach(function (n) {
      var m = pack(n); m.photos = [];
      (n.photos || []).forEach(function (b, i) { var fn = n.id + "_" + (i + 1) + ".jpg"; m.photos.push(fn); dt.items.add(new File([b], fn, { type: "image/jpeg" })); });
      metas.push(m);
    });
    hid("notes", JSON.stringify(metas));
    var fi = document.createElement("input"); fi.type = "file"; fi.name = "p"; fi.multiple = true; fi.files = dt.files; f.appendChild(fi);
    document.body.appendChild(f);
    f.submit();
  }
  function blobToURL(b) { return new Promise(function (res) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.readAsDataURL(b); }); }
  function doExport() {
    var un = NOTES.filter(function (n) { return !n.synced; });
    if (!un.length) return;
    toast("書き出し中…");
    Promise.all(un.map(function (n) {
      return Promise.all((n.photos || []).map(blobToURL)).then(function (ph) { var m = pack(n); m.photos = ph; return m; });
    })).then(function (notes) {
      var d = new Date(), name = "取材メモ-" + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + "-" + p2(d.getHours()) + p2(d.getMinutes()) + ".ptmemo.json";
      var file = new File([JSON.stringify({ app: "ptmemo", v: 1, notes: notes })], name, { type: "application/json" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        return navigator.share({ files: [file], title: "取材メモ" }).catch(function () {});
      }
      var a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    }).then(function () {
      if (confirm("PCに取り込めましたか?\n「OK」で、全部を同期済みにします。\nまだなら「キャンセル」にしてください(書き出しは何度でもできます)。")) {
        Promise.all(un.map(function (n) { n.synced = true; n.syncedAt = Date.now(); return putNote(n); })).then(viewHome);
      }
    }).catch(function (e) { toast("書き出せませんでした: " + e.message); });
  }

  /* ---------- 操作 ---------- */
  function addPhotos(files) {
    if (!cur) return;
    var list = Array.prototype.slice.call(files || []);
    var chain = Promise.resolve();
    list.forEach(function (f) {
      chain = chain.then(function () {
        if ((cur.photos || []).length >= MAXPH) { toast("写真は1つのメモに" + MAXPH + "枚までです"); return; }
        return shrink(f).then(function (b) { cur.photos = (cur.photos || []).concat([b]); }).catch(function (e) { toast(e.message); });
      });
    });
    chain.then(function () { return persist(true); }).then(function () { freeUrls(); drawEdit(); });
  }
  function setLoc() {
    toast("現在地を調べています…");
    return getPos().then(function (p) {
      cur.lat = p.lat; cur.lng = p.lng; cur.acc = p.acc; cur.locSrc = "gps";
      return persist(true);
    }).then(function () { $("#locst") && ($("#locst").innerHTML = locText(cur)); toast("現在地を記録しました"); }).catch(function (e) { toast(e.message); });
  }

  document.addEventListener("click", function (e) {
    var el = e.target.closest("[data-a]"); if (!el) return;
    var a = el.getAttribute("data-a"), v = el.getAttribute("data-v");
    if (a === "new") {
      var n = { id: newId(), kind: "food", name: "", area: "", memo: "", price: "", rating: 0, lat: "", lng: "", acc: 0, locSrc: "", mapUrl: "", photos: [], created: Date.now(), updated: Date.now(), synced: false };
      putNote(n).then(function () { location.hash = "#/n/" + n.id; });
    } else if (a === "quick") {
      var q = { id: newId(), kind: "other", name: "", area: "", memo: "", price: "", rating: 0, lat: "", lng: "", acc: 0, locSrc: "", mapUrl: "", photos: [], created: Date.now(), updated: Date.now(), synced: false };
      toast("現在地を調べています…");
      getPos().then(function (p) { q.lat = p.lat; q.lng = p.lng; q.acc = p.acc; q.locSrc = "gps"; return putNote(q); })
        .then(function () { toast("現在地を記録しました。¦あとで名前や感想を足せます"); viewHome(); })
        .catch(function (er) { toast(er.message); });
    } else if (a === "open") { location.hash = "#/n/" + el.getAttribute("data-id"); }
    else if (a === "filter") { filter = v; viewHome(); }
    else if (a === "sync") { doSync(); }
    else if (a === "export") { doExport(); }
    else if (a === "clean") {
      var sy = NOTES.filter(function (n) { return n.synced; });
      if (!sy.length) return;
      if (confirm("同期済みの" + sy.length + "件を、このスマホから削除します。\nPCに届いているか確認しましたか?(元に戻せません)")) {
        Promise.all(sy.map(function (n) { return delNote(n.id); })).then(function () { toast("削除しました"); viewHome(); });
      }
    } else if (a === "kind") { cur.kind = v; persist(true).then(function () { document.querySelectorAll('[data-a="kind"]').forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-v") === v); }); }); }
    else if (a === "star") { var s = +v; cur.rating = cur.rating === s ? 0 : s; persist(true).then(function () { document.querySelectorAll('[data-a="star"]').forEach(function (b) { b.classList.toggle("on", cur.rating >= +b.getAttribute("data-v")); }); }); }
    else if (a === "rmph") { cur.photos.splice(+el.getAttribute("data-i"), 1); persist(true).then(function () { freeUrls(); drawEdit(); }); }
    else if (a === "savephotos") {
      var fs = (cur.photos || []).map(function (b, i) { return new File([b], "取材メモ-" + fmt(cur.created).replace(/[\/: ]/g, "") + "-" + (i + 1) + ".jpg", { type: "image/jpeg" }); });
      if (navigator.canShare && navigator.canShare({ files: fs })) {
        navigator.share({ files: fs }).catch(function () {});
      } else {
        fs.forEach(function (f) { var a2 = document.createElement("a"); a2.href = URL.createObjectURL(f); a2.download = f.name; document.body.appendChild(a2); a2.click(); a2.remove(); });
        toast("ダウンロードに保存しました");
      }
    }
    else if (a === "autosave") { SET.autosave = SET.autosave === false; saveSet(); viewSettings(); }
    else if (a === "loc") { setLoc(); }
    else if (a === "maps") {
      var u = cur && cur.lat ? "https://www.google.com/maps/search/?api=1&query=" + cur.lat + "," + cur.lng : "https://www.google.com/maps";
      window.open(u, "_blank", "noopener");
    } else if (a === "done") { leaveEdit().then(function () { location.hash = "#/"; }); }
    else if (a === "del") { if (confirm("このメモを削除します。元に戻せません。よろしいですか?")) { var id = cur.id; cur = null; delNote(id).then(function () { location.hash = "#/"; }); } }
    else if (a === "saveset") { SET.addr = cleanAddr($("#s_addr").value); SET.pin = $("#s_pin").value.trim(); saveSet(); $("#s_addr").value = SET.addr; toast("保存しました"); }
    else if (a === "testpc") {
      var ad = cleanAddr($("#s_addr").value); if (!ad) return toast("アドレスを入れてください");
      SET.addr = ad; SET.pin = $("#s_pin").value.trim(); saveSet();
      location.href = "http://" + ad + "/?back=" + encodeURIComponent(location.origin + location.pathname);
    }
  });
  document.addEventListener("input", function (e) {
    var f = e.target.getAttribute && e.target.getAttribute("data-f"); if (!f || !cur) return;
    cur[f] = e.target.value;
    if (f === "mapUrl") {
      var ll = parseLL(cur.mapUrl);
      if (ll) { cur.lat = ll[0]; cur.lng = ll[1]; cur.acc = 0; cur.locSrc = "map"; $("#locst").innerHTML = locText(cur); }
    }
    persist(false);
  });
  var pendingShare = null;
  function hideSaveBar() { var b = $("#savebar"); if (b) b.hidden = true; pendingShare = null; }
  function showSaveBar(files) {
    pendingShare = files;
    var b = $("#savebar"); b.hidden = false;
  }
  function shareOrig(files) {
    if (!(navigator.canShare && navigator.share && navigator.canShare({ files: files }))) return false;
    navigator.share({ files: files }).then(hideSaveBar, function (er) {
      if (er && er.name === "AbortError") return hideSaveBar();   /* 自分でやめた */
      showSaveBar(files);                                         /* 自動では出せなかった → ボタンを残す */
    });
    return true;
  }
  document.addEventListener("change", function (e) {
    if (e.target.id === "cam" || e.target.id === "pick") {
      var fl = Array.prototype.slice.call(e.target.files || []);
      if (e.target.id === "cam" && fl.length && SET.autosave !== false) {
        var named = fl.map(function (f, i) { return new File([f], "取材メモ-" + Date.now() + "-" + (i + 1) + ".jpg", { type: f.type || "image/jpeg" }); });
        shareOrig(named);
      }
      addPhotos(e.target.files); e.target.value = "";
    }
  });
  $("#savebtn").onclick = function () {
    var fs = pendingShare; if (!fs) return;
    navigator.share({ files: fs }).then(hideSaveBar, function (er) { if (er && er.name === "AbortError") hideSaveBar(); });
  };
  $("#saveno").onclick = hideSaveBar;
  $("#back").onclick = function () {
    if (cur) leaveEdit().then(function () { location.hash = "#/"; }); else location.hash = "#/";
  };
  $("#gear").onclick = function () { location.hash = "#/settings"; };
  window.addEventListener("pagehide", function () { if (cur) { clearTimeout(saveT); cur.updated = Date.now(); if (!emptyNote(cur)) putNote(cur); } });
  document.addEventListener("visibilitychange", function () { if (document.hidden && cur && !emptyNote(cur)) { clearTimeout(saveT); putNote(cur); } });

  function route() {
    var h = location.hash || "#/";
    var m = h.match(/^#synced=(.*)$/);
    if (m) {
      var ids = decodeURIComponent(m[1]).split(",").filter(Boolean);
      history.replaceState(null, "", location.pathname);
      Promise.all(ids.map(function (id) { return getNote(id).then(function (n) { if (n) { n.synced = true; n.syncedAt = Date.now(); return putNote(n); } }); }))
        .then(function () { toast(ids.length + "件をPCに送りました。¦PCの「受信箱」で¦確認してください"); viewHome(); });
      return;
    }
    m = h.match(/^#syncerr=(.*)$/);
    if (m) { var msg = decodeURIComponent(m[1]); history.replaceState(null, "", location.pathname); toast(msg || "送れませんでした"); viewHome(); return; }
    if (h === "#connected") { history.replaceState(null, "", location.pathname); toast("PCとつながりました"); viewHome(); return; }
    var prev = cur ? leaveEdit() : Promise.resolve();
    prev.then(function () {
      m = h.match(/^#\/n\/(.+)$/);
      if (m) return viewEdit(m[1]);
      if (h === "#/settings") return viewSettings();
      viewHome();
    });
  }
  window.addEventListener("hashchange", route);

  openDB().then(function (d) {
    db = d;
    try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}
    route();
  }).catch(function () { $("#app").innerHTML = '<div class="empty">このブラウザでは、保存ができません。SafariまたはChromeで開いてください。</div>'; });

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});
})();

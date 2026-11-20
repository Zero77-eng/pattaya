/* スケジュール管理(旅程と費用)。旅プランの考え方を、スマホ用に取り込んだもの。
   予定のデータは、この端末の中(localStorage)だけに保存する。公開データにも、サーバーにも出さない。 */
(function () {
  "use strict";
  var KEY = "pt_trip_v1";
  var CATS = ["食事", "観光", "買い物", "夜遊び", "移動", "マッサージ", "その他"];
  var CAT_ICON = { "食事": "🍽", "観光": "🎯", "買い物": "🛍", "夜遊び": "🍻", "移動": "🚕", "マッサージ": "💆", "その他": "📝" };
  var PLACE_CAT = { "食事": "食事", "観光": "観光", "マッサージ": "マッサージ", "夜情報": "夜遊び", "PR": "その他" };
  var WD = ["日", "月", "火", "水", "木", "金", "土"];

  /* ---------- 小さな道具 ---------- */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function num(v) { return parseFloat(v) || 0; }
  function pad(n) { return String(n).padStart(2, "0"); }
  function uid() { return Math.random().toString(36).slice(2, 10); }
  function yen(n) { return "¥" + Math.round(n || 0).toLocaleString(); }
  function thb(n) { return "฿" + Math.round(n || 0).toLocaleString(); }
  function dobj(s) { return new Date(s + "T00:00:00"); }
  function dstr(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function fmtD(s) { var d = dobj(s); return (d.getMonth() + 1) + "/" + d.getDate() + "(" + WD[d.getDay()] + ")"; }
  function addDays(s, n) { var d = dobj(s); d.setDate(d.getDate() + n); return dstr(d); }
  function daysBetween(a, b) { var o = [], d = dobj(a), e = dobj(b); while (d <= e && o.length < 200) { o.push(dstr(d)); d.setDate(d.getDate() + 1); } return o; }
  function nights(h) { return h.in && h.out ? Math.max(0, Math.round((dobj(h.out) - dobj(h.in)) / 864e5)) : 0; }
  function hotelTotal(h) { return num(h.perNight) * nights(h); }
  function today() { return dstr(new Date()); }

  /* ---------- 保存 ---------- */
  function blankHotel() { return { id: uid(), name: "", area: "", in: "", inT: "15:00", out: "", outT: "11:00", perNight: "" }; }
  function blankFlight(dir) { return { id: uid(), dir: dir, airline: "", no: "", from: "", to: "", dep: "", arr: "", price: "" }; }
  function ensure(p) {
    p.name = p.name || "パタヤ旅行";
    p.flights = p.flights || [];
    ["往路", "復路"].forEach(function (d, i) { if (!p.flights.some(function (f) { return f.dir === d; })) p.flights.splice(i, 0, blankFlight(d)); });
    p.hotels = p.hotels && p.hotels.length ? p.hotels : [blankHotel()];
    p.events = p.events || []; p.prepaid = p.prepaid || []; p.exchanges = p.exchanges || [];
    p.rates = p.rates || {}; p.bands = p.bands || [];
    p.bands.forEach(function (b) { if (!b.cat) b.cat = "買い物"; if (!b.id) b.id = uid(); });
    p.events.forEach(function (e) { if (!e.id) e.id = uid(); });
    if (p.baseRate === undefined) p.baseRate = "4.7";
    if (p.heldBaht === undefined) p.heldBaht = "";
    if (!p.reserve || (p.reserve.mode !== "yen" && p.reserve.mode !== "pct")) p.reserve = { mode: "yen", val: "" };
    return p;
  }
  var P = null;
  function load() {
    try { var s = localStorage.getItem(KEY); if (s) return ensure(JSON.parse(s)); } catch (e) {}
    return ensure({});
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(P)); } catch (e) { PT().toast("保存できませんでした(容量不足の可能性)"); } }
  function PT() { return window.PT; }

  /* ---------- 計算(旅プランと同じ考え方) ---------- */
  function rateOn(p, ds) {
    var best = null;
    Object.keys(p.rates).sort().forEach(function (k) { if (k <= ds && num(p.rates[k]) > 0) best = k; });
    return best ? num(p.rates[best]) : (num(p.baseRate) || 4.7);
  }
  function tripRange(p) {
    var ds = [];
    p.hotels.forEach(function (h) { if (h.in) ds.push(h.in); if (h.out) ds.push(h.out); });
    if (!ds.length) {
      p.flights.forEach(function (f) { if (f.dep) ds.push(f.dep.slice(0, 10)); if (f.arr) ds.push(f.arr.slice(0, 10)); });
      p.events.forEach(function (e) { if (e.date) ds.push(e.date); });
    }
    ds.sort(); return ds.length ? [ds[0], ds[ds.length - 1]] : null;
  }
  function derive(p) {
    var it = [];
    p.flights.forEach(function (f) {
      var route = (f.from || "?") + " → " + (f.to || "?"), lab = ((f.airline || "") + " " + (f.no || "")).trim();
      if (f.dep) it.push({ date: f.dep.slice(0, 10), time: f.dep.slice(11, 16), kind: "f", title: "✈️ " + f.dir + "出発  " + route + (lab ? "  " + lab : ""), cost: num(f.price), cur: "jpy" });
      if (f.arr) it.push({ date: f.arr.slice(0, 10), time: f.arr.slice(11, 16), kind: "f", title: "🛬 " + f.dir + "到着  " + (f.to || ""), cost: 0, cur: "jpy" });
    });
    p.hotels.forEach(function (h) {
      if (h.in) it.push({ date: h.in, time: h.inT || "15:00", kind: "h", title: "🏨 チェックイン  " + (h.name || "") + (h.area ? "（" + h.area + "）" : ""), cost: hotelTotal(h), cur: "jpy" });
      if (h.out) it.push({ date: h.out, time: h.outT || "11:00", kind: "h", title: "🏨 チェックアウト  " + (h.name || ""), cost: 0, cur: "jpy" });
    });
    p.events.forEach(function (e) { it.push({ date: e.date, time: e.time || "", kind: "e", title: e.title, note: e.note || "", cost: num(e.cost), cur: "thb", cat: e.cat, ev: e }); });
    var r = tripRange(p);
    if (r) p.bands.forEach(function (b) {
      var a = b.from || r[0], z = b.to || r[1]; if (a > z) return;
      daysBetween(a, z).forEach(function (ds) { it.push({ date: ds, time: b.time || "", kind: "b", title: b.title || "毎日の定番", cost: num(b.cost), cur: "thb", cat: b.cat || "買い物" }); });
    });
    return it.filter(function (x) { return x.date; });
  }
  function stats(p) {
    var it = derive(p), sum = function (a, f) { return a.reduce(function (s, x) { return s + f(x); }, 0); };
    var fl = sum(p.flights, function (f) { return num(f.price); });
    var ho = sum(p.hotels, hotelTotal);
    var pre = sum(p.prepaid, function (x) { return num(x.price); });
    var th = it.filter(function (x) { return x.cur === "thb"; });
    var baht = sum(th, function (x) { return x.cost; });
    var bahtYen = sum(th, function (x) { return x.cost * rateOn(p, x.date); });
    var exBaht = sum(p.exchanges, function (x) { return num(x.baht); });
    var card = fl + ho + pre;
    var dates = it.map(function (x) { return x.date; }).sort();
    var days = dates.length ? Math.round((dobj(dates[dates.length - 1]) - dobj(dates[0])) / 864e5) + 1 : 0;
    var rv = num(p.reserve.val), reserveYen = p.reserve.mode === "yen" ? rv : bahtYen * rv / 100;
    var avgRate = baht > 0 ? bahtYen / baht : (num(p.baseRate) || 4.7);
    var held = num(p.heldBaht), needExBaht = Math.max(0, baht - exBaht - held), needExYen = needExBaht * avgRate;
    var carry = needExYen + reserveYen, carryRound = Math.ceil(carry / 1000 - 1e-9) * 1000;
    return { it: it, fl: fl, ho: ho, pre: pre, card: card, baht: baht, bahtYen: bahtYen, exBaht: exBaht, held: held, avgRate: avgRate, needExBaht: needExBaht, needExYen: needExYen, reserveYen: reserveYen, carry: carry, carryRound: carryRound, total: card + bahtYen, totalR: card + bahtYen + reserveYen, days: days, nights: sum(p.hotels, nights), start: dates[0], end: dates[dates.length - 1] };
  }

  /* ---------- 画面の部品 ---------- */
  var S = { edit: null }; // 予定を編集中: {id|null}
  function tabs(cur) {
    var t = [["", "旅程"], ["cost", "費用"], ["setup", "準備"]];
    return '<div class="sc-tabs">' + t.map(function (x) { return '<a href="#/schedule' + (x[0] ? "/" + x[0] : "") + '" class="' + (cur === x[0] ? "on" : "") + '">' + x[1] + "</a>"; }).join("") + "</div>";
  }
  function summary(s) {
    if (!s.start) return '<div class="card"><h3>🗓 まだ予定がありません</h3><p class="meta">「準備」でフライトとホテルを入れると、旅程の土台ができます。予定は「＋予定を入れる」から追加できます。</p></div>';
    return '<div class="card sc-sum"><h3>' + esc(P.name) + '</h3><div class="meta">' + fmtD(s.start) + " 〜 " + fmtD(s.end) + "(" + s.days + "日間" + (s.nights ? "・" + s.nights + "泊" : "") + ')</div><div class="sc-big">現地の予定費用 ' + thb(s.baht) + '<small>≒ ' + yen(s.bahtYen) + "</small></div></div>";
  }
  function fld(label, html, cls) { return '<label class="sc-f ' + (cls || "") + '"><span>' + label + "</span>" + html + "</label>"; }
  function inp(type, id, val, ph, extra) { return '<input type="' + type + '" id="' + id + '" value="' + esc(val) + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : "") + (extra || "") + ">"; }
  function catSel(id, val) { return '<select id="' + id + '">' + CATS.map(function (c) { return "<option" + (c === val ? " selected" : "") + ">" + c + "</option>"; }).join("") + "</select>"; }

  /* ---------- 旅程 ---------- */
  function evForm(ev, title) {
    var isNew = !ev.id;
    var d = ev.date || (tripRange(P) ? tripRange(P)[0] : today());
    return '<div class="card sc-form" id="scform"><h3>' + (isNew ? "予定を入れる" : "予定を直す") + "</h3>" +
      fld("日付", inp("date", "ev_date", d)) + fld("時間", inp("time", "ev_time", ev.time || "")) +
      fld("分類", catSel("ev_cat", ev.cat || "食事")) + fld("内容", inp("text", "ev_title", ev.title || "", "例: 昼ごはん")) +
      fld("メモ", inp("text", "ev_note", ev.note || "", "任意")) + fld("費用(バーツ)", inp("number", "ev_cost", ev.cost || "", "0", ' inputmode="numeric"')) +
      '<div class="sc-btns"><button class="btn" data-sc="saveev"' + (ev.id ? ' data-id="' + esc(ev.id) + '"' : "") + ">保存</button>" +
      '<button class="btn sub" data-sc="cancel">やめる</button>' + (ev.id ? '<button class="btn sub danger" data-sc="delev" data-id="' + esc(ev.id) + '">この予定を消す</button>' : "") + "</div></div>";
  }
  function vTrip() {
    var s = stats(P), h = tabs("") + summary(s);
    if (S.edit) {
      var cur = S.edit.id ? P.events.filter(function (e) { return e.id === S.edit.id; })[0] : { date: S.edit.date };
      h += evForm(cur || {});
    } else {
      h += '<button class="btn" data-sc="newev">＋ 予定を入れる</button>';
    }
    if (s.start) {
      var byDay = {};
      s.it.forEach(function (x) { (byDay[x.date] = byDay[x.date] || []).push(x); });
      daysBetween(s.start, s.end).forEach(function (ds, i) {
        var items = (byDay[ds] || []).slice().sort(function (a, b) { return (a.time || "99:99").localeCompare(b.time || "99:99"); });
        var bands = items.filter(function (x) { return x.kind === "b"; }), main = items.filter(function (x) { return x.kind !== "b"; });
        var cost = items.filter(function (x) { return x.cur === "thb"; }).reduce(function (a, x) { return a + x.cost; }, 0);
        h += '<div class="sc-day"><b>' + fmtD(ds) + "</b><span>" + (i + 1) + "日目</span>" + (cost ? "<em>" + thb(cost) + "</em>" : "") + "</div>";
        main.forEach(function (x) {
          var edit = x.kind === "e" ? ' data-sc="editev" data-id="' + esc(x.ev.id) + '"' : "";
          var c = x.cost ? (x.cur === "thb" ? thb(x.cost) : yen(x.cost)) : "";
          var map = x.ev && x.ev.map ? ' <a class="sc-map" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(x.ev.map) + '">地図</a>' : "";
          h += '<div class="sc-row' + (x.kind === "e" ? " tap" : "") + '"' + edit + '><span class="t">' + esc(x.time || "") + '</span><span class="m">' + (x.kind === "e" ? (CAT_ICON[x.cat] || "") + " " : "") + esc(x.title) + (x.note ? "<small>" + esc(x.note) + "</small>" : "") + "</span><span class=\"c\">" + c + "</span></div>" + (map ? '<div class="sc-sub">' + map + "</div>" : "");
        });
        if (bands.length) h += '<div class="sc-row band"><span class="t"></span><span class="m">🔁 毎日の定番<small>' + esc(bands.map(function (b) { return b.title; }).join("・")) + '</small></span><span class="c">' + thb(bands.reduce(function (a, b) { return a + b.cost; }, 0)) + "</span></div>";
        if (!items.length) h += '<div class="sc-row empty"><span class="m">予定なし</span></div>';
      });
    }
    return { title: "スケジュール", html: h, back: "#/" };
  }

  /* ---------- 費用 ---------- */
  function vCost() {
    var s = stats(P), h = tabs("cost");
    if (!s.start) return { title: "費用", html: h + '<div class="card"><p class="meta">予定を入れると、ここに費用が出ます。</p></div>', back: "#/" };
    var M = {}, g = function (n) { return M[n] || (M[n] = { card: 0, baht: 0, yen: 0 }); };
    g("航空券").card = s.fl; g("ホテル").card = s.ho;
    P.prepaid.forEach(function (x) { if (num(x.price)) g(x.cat || "事前購入").card += num(x.price); });
    s.it.filter(function (x) { return x.cur === "thb" && x.cost; }).forEach(function (x) { var m = g(x.cat || "その他"); m.baht += x.cost; m.yen += x.cost * rateOn(P, x.date); });
    var rows = Object.keys(M).map(function (n) { var m = M[n]; return { n: n, card: m.card, baht: m.baht, tot: m.card + m.yen }; }).filter(function (r) { return r.tot > 0; }).sort(function (a, b) { return b.tot - a.tot; });
    h += '<div class="card sc-carry"><h3>🇯🇵 日本円でいくら持っていく?</h3><div class="sc-big red">' + yen(s.carryRound) + '<small>(1,000円単位に切り上げ／ぴったり ' + yen(s.carry) + ")</small></div>" +
      '<dl class="sc-dl"><dt>現地で使う現金</dt><dd>' + thb(s.baht) + "(≒ " + yen(s.bahtYen) + ")</dd>" +
      (s.exBaht ? "<dt>両替済み</dt><dd>− " + thb(Math.min(s.exBaht, s.baht)) + "</dd>" : "") +
      (s.held ? "<dt>手持ちのバーツ</dt><dd>− " + thb(Math.min(s.held, Math.max(0, s.baht - s.exBaht))) + "</dd>" : "") +
      "<dt>両替する分</dt><dd>" + thb(s.needExBaht) + " × レート " + s.avgRate.toFixed(2) + " = <b>" + yen(s.needExYen) + "</b></dd>" +
      "<dt>🛟 予備費</dt><dd><b>" + yen(s.reserveYen) + "</b></dd></dl>" +
      '<p class="note">カード払い(航空券・ホテルなど ' + yen(s.card) + ")は含みません。レート・予備費・手持ちバーツは「準備」で変えられます。</p></div>";
    h += '<div class="card"><h3>💳 カード払い(日本・円)</h3><div class="sc-big">' + yen(s.card) + '</div><dl class="sc-dl"><dt>航空券</dt><dd>' + yen(s.fl) + "</dd><dt>ホテル</dt><dd>" + yen(s.ho) + "</dd>" + (s.pre ? "<dt>事前購入</dt><dd>" + yen(s.pre) + "</dd>" : "") + "</dl></div>";
    h += '<div class="card"><h3>💵 現地の現金(バーツ)</h3><div class="sc-big">' + thb(s.baht) + "<small>1日あたり 約 " + thb(s.baht / Math.max(1, s.days)) + "</small></div></div>";
    h += '<div class="card"><h3>分類別の内訳(円換算)</h3>' + rows.map(function (r) {
      var pc = Math.round(r.tot / (s.total || 1) * 100);
      return '<div class="sc-bar"><div class="l"><span>' + esc(r.n) + "</span><b>" + yen(r.tot) + '</b></div><div class="b"><i style="width:' + pc + '%"></i></div><div class="s">' + pc + "%" + (r.baht ? "・現金 " + thb(r.baht) : "") + (r.card ? "・カード " + yen(r.card) : "") + "</div></div>";
    }).join("") + '<p class="note">合計(予備費なし) ' + yen(s.total) + "／予備費を足した総額 <b>" + yen(s.totalR) + "</b></p></div>";
    return { title: "費用", html: h, back: "#/" };
  }

  /* ---------- 準備(フライト・ホテル・お金・バックアップ) ---------- */
  function g2(i, key, label, type, val, ph) { return fld(label, '<input type="' + type + '" value="' + esc(val) + '" data-sc="set" data-g="' + i[0] + '" data-i="' + i[1] + '" data-k="' + key + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : "") + ">"); }
  function vSetup() {
    var h = tabs("setup");
    h += '<div class="card"><h3>✈️ フライト</h3>' + P.flights.map(function (f, i) {
      return '<div class="sc-grp"><b>' + esc(f.dir) + "</b>" + (f.dir !== "往路" && f.dir !== "復路" ? '<button class="sc-x" data-sc="delf" data-i="' + i + '">消す</button>' : "") +
        g2(["f", i], "airline", "航空会社", "text", f.airline) + g2(["f", i], "no", "便名", "text", f.no) +
        g2(["f", i], "from", "出発地", "text", f.from) + g2(["f", i], "to", "到着地", "text", f.to) +
        g2(["f", i], "dep", "出発日時", "datetime-local", f.dep) + g2(["f", i], "arr", "到着日時", "datetime-local", f.arr) +
        g2(["f", i], "price", "料金(円)", "number", f.price) + "</div>";
    }).join("") + '<button class="btn sub" data-sc="addf">＋ 乗り継ぎなどを追加</button></div>';
    h += '<div class="card"><h3>🏨 ホテル</h3>' + P.hotels.map(function (x, i) {
      return '<div class="sc-grp"><b>ホテル' + (i + 1) + "</b>" + (P.hotels.length > 1 ? '<button class="sc-x" data-sc="delh" data-i="' + i + '">消す</button>' : "") +
        g2(["h", i], "name", "名前", "text", x.name) + g2(["h", i], "area", "エリア", "text", x.area) +
        g2(["h", i], "in", "チェックイン日", "date", x.in) + g2(["h", i], "inT", "入れる時間", "time", x.inT) +
        g2(["h", i], "out", "チェックアウト日", "date", x.out) + g2(["h", i], "outT", "出る時間", "time", x.outT) +
        g2(["h", i], "perNight", "1泊(円)", "number", x.perNight) + "</div>";
    }).join("") + '<button class="btn sub" data-sc="addh">＋ ホテルを追加(途中で変える場合)</button></div>';
    h += '<div class="card"><h3>🔁 毎日の定番(毎日かかる費用)</h3><p class="note">昼ごはん、コンビニなど。旅の全日に自動で入ります。</p>' + P.bands.map(function (b, i) {
      return '<div class="sc-grp"><b>' + esc(b.title || "定番") + '</b><button class="sc-x" data-sc="delb" data-i="' + i + '">消す</button>' +
        g2(["b", i], "title", "内容", "text", b.title) +
        fld("分類", '<select data-sc="set" data-g="b" data-i="' + i + '" data-k="cat">' + CATS.map(function (c) { return "<option" + (c === b.cat ? " selected" : "") + ">" + c + "</option>"; }).join("") + "</select>") +
        g2(["b", i], "cost", "1日の費用(バーツ)", "number", b.cost) + g2(["b", i], "time", "時間", "time", b.time) +
        g2(["b", i], "from", "いつから", "date", b.from) + g2(["b", i], "to", "いつまで", "date", b.to) + "</div>";
    }).join("") + '<button class="btn sub" data-sc="addb">＋ 定番を追加</button></div>';
    h += '<div class="card"><h3>💴 お金の設定</h3>' +
      fld("基本レート(1バーツ = 何円)", '<input type="number" step="0.01" inputmode="decimal" value="' + esc(P.baseRate) + '" data-sc="set" data-g="g" data-k="baseRate">') +
      fld("いま持っているバーツ", '<input type="number" inputmode="numeric" value="' + esc(P.heldBaht) + '" data-sc="set" data-g="g" data-k="heldBaht">') +
      fld("予備費の決め方", '<select data-sc="set" data-g="res" data-k="mode"><option value="yen"' + (P.reserve.mode === "yen" ? " selected" : "") + '>金額(円)</option><option value="pct"' + (P.reserve.mode === "pct" ? " selected" : "") + ">現地の予定の○%</option></select>") +
      fld("予備費(" + (P.reserve.mode === "yen" ? "円" : "%") + ")", '<input type="number" inputmode="decimal" value="' + esc(P.reserve.val) + '" data-sc="set" data-g="res" data-k="val">') + "</div>";
    h += '<div class="card"><h3>💾 バックアップ・取り込み</h3><p class="note">予定は、この端末の中だけに保存されています。端末を変えるときや、念のために、書き出して残してください。</p>' +
      '<button class="btn sub" data-sc="export">予定を書き出す(コピー用の文字)</button><textarea id="sc_io" rows="5" placeholder="ここに、書き出した文字や、旅プランのデータを貼り付けて「読み込む」を押します"></textarea>' +
      '<div class="sc-btns"><button class="btn sub" data-sc="copyio">コピー</button><button class="btn" data-sc="import">読み込む</button></div>' +
      '<p class="note">旅プランのデータ(data.json の中身、または1つのプラン)も、そのまま読み込めます。読み込むと、いまの予定は置き換わります。</p>' +
      '<button class="btn sub danger" data-sc="reset">予定を全部消す</button></div>';
    return { title: "準備", html: h, back: "#/" };
  }

  /* ---------- お店から予定に追加 ---------- */
  function vAdd(shopId) {
    var shop = PT().findShop(shopId);
    if (!shop) return vTrip();
    var d = tripRange(P) ? tripRange(P)[0] : today();
    var h = '<div class="card sc-form" id="scform"><h3>🗓 予定に追加</h3><p><b>' + esc(shop.name) + '</b><br><span class="meta">' + esc(shop.area || "") + "</span></p>" +
      fld("日付", inp("date", "ev_date", d)) + fld("時間", inp("time", "ev_time", "")) + fld("メモ", inp("text", "ev_note", shop.area || "", "任意")) + fld("費用(バーツ)", inp("number", "ev_cost", "", "0", ' inputmode="numeric"')) +
      '<div class="sc-btns"><button class="btn" data-sc="saveplace" data-id="' + esc(shop.id) + '">予定に追加</button><a class="btn sub" href="#/shop/' + esc(shop.id) + '">やめる</a></div>' +
      '<p class="note">予定は、この端末の中だけに保存されます。</p></div>';
    return { title: "予定に追加", html: h, back: "#/shop/" + shopId };
  }

  function view(sub, arg) {
    P = load();
    if (sub === "cost") return vCost();
    if (sub === "setup") return vSetup();
    if (sub === "add") return vAdd(arg);
    return vTrip();
  }
  function rerender() { PT().render(true); }
  function rd(id) { var e = document.getElementById(id); return e ? e.value.trim() : ""; }

  /* ---------- 操作 ---------- */
  document.addEventListener("click", function (e) {
    var el = e.target.closest("[data-sc]"); if (!el) return;
    var a = el.getAttribute("data-sc"), id = el.getAttribute("data-id"), i = +el.getAttribute("data-i");
    if (a === "set") return;
    P = load();
    if (a === "newev") { S.edit = { date: null }; return rerender(); }
    if (a === "editev") { S.edit = { id: id }; return rerender(); }
    if (a === "cancel") { S.edit = null; return rerender(); }
    if (a === "saveev") {
      var ev = id ? P.events.filter(function (x) { return x.id === id; })[0] : { id: uid() };
      if (!rd("ev_date") || !rd("ev_title")) { PT().toast("日付と内容を入れてください"); return; }
      ev.date = rd("ev_date"); ev.time = rd("ev_time"); ev.cat = rd("ev_cat"); ev.title = rd("ev_title"); ev.note = rd("ev_note"); ev.cost = rd("ev_cost");
      if (!id) P.events.push(ev);
      save(); S.edit = null; return rerender();
    }
    if (a === "delev") { if (confirm("この予定を消しますか?")) { P.events = P.events.filter(function (x) { return x.id !== id; }); save(); S.edit = null; rerender(); } return; }
    if (a === "saveplace") {
      var shop = PT().findShop(id); if (!shop || !rd("ev_date")) { PT().toast("日付を入れてください"); return; }
      P.events.push({ id: uid(), date: rd("ev_date"), time: rd("ev_time"), cat: PLACE_CAT[shop.menu] || "その他", title: shop.name, note: rd("ev_note"), cost: rd("ev_cost"), map: (shop.lat !== "" && shop.lat != null) ? shop.lat + "," + shop.lng : "" });
      save(); PT().toast("予定に追加しました"); location.hash = "#/schedule"; return;
    }
    if (a === "addf") { P.flights.push(blankFlight("乗り継ぎ")); save(); return rerender(); }
    if (a === "delf") { P.flights.splice(i, 1); save(); return rerender(); }
    if (a === "addh") { P.hotels.push(blankHotel()); save(); return rerender(); }
    if (a === "delh") { P.hotels.splice(i, 1); save(); return rerender(); }
    if (a === "addb") { P.bands.push({ id: uid(), title: "昼ごはん", cat: "食事", time: "12:00", cost: "", from: "", to: "" }); save(); return rerender(); }
    if (a === "delb") { P.bands.splice(i, 1); save(); return rerender(); }
    if (a === "export") { var t = document.getElementById("sc_io"); t.value = JSON.stringify({ pt_trip: 1, plan: P }); t.select(); return; }
    if (a === "copyio") {
      var t2 = document.getElementById("sc_io"); if (!t2.value) { PT().toast("先に「書き出す」を押してください"); return; }
      (navigator.clipboard ? navigator.clipboard.writeText(t2.value) : Promise.reject()).then(function () { PT().toast("コピーしました"); }, function () { t2.select(); PT().toast("文字を長押ししてコピーしてください"); });
      return;
    }
    if (a === "import") {
      var raw = rd("sc_io"); if (!raw) { PT().toast("貼り付けてください"); return; }
      var obj; try { obj = JSON.parse(raw); } catch (x) { PT().toast("読み込めない形です"); return; }
      var plan = obj && obj.plans ? (obj.plans.filter(function (p) { return p.id === obj.cur; })[0] || obj.plans[0]) : (obj && obj.pt_trip ? obj.plan : obj);
      if (!plan || (!plan.flights && !plan.events && !plan.hotels)) { PT().toast("予定のデータが見つかりません"); return; }
      if (!confirm("いまの予定を、読み込んだ内容に置き換えます。よろしいですか?")) return;
      P = ensure(plan); save(); PT().toast("読み込みました"); location.hash = "#/schedule"; return;
    }
    if (a === "reset") { if (confirm("予定を全部消します。元に戻せません。よろしいですか?")) { try { localStorage.removeItem(KEY); } catch (x) {} S.edit = null; rerender(); } return; }
  });
  /* 入力欄は、入力が終わったとき(別の欄に移ったとき)に保存する */
  document.addEventListener("change", function (e) {
    var el = e.target.closest('[data-sc="set"]'); if (!el) return;
    P = load();
    var g = el.getAttribute("data-g"), i = +el.getAttribute("data-i"), k = el.getAttribute("data-k"), v = el.value;
    if (g === "f") P.flights[i][k] = v; else if (g === "h") P.hotels[i][k] = v; else if (g === "b") P.bands[i][k] = v;
    else if (g === "g") P[k] = v; else if (g === "res") { P.reserve[k] = v; save(); if (k === "mode") rerender(); return; }
    save();
  });

  window.PTSchedule = { view: view };
})();

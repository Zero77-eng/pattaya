/* 持ち物チェックリスト(行き用・帰り用)。最初から定番の項目が入っていて、追加・削除・数の変更ができる。
   行き: ちゃんと用意できたか。帰り: 忘れ物がないか+お土産リスト。
   チェックや編集の内容は、この端末の中(localStorage)だけに保存する。 */
(function () {
  "use strict";
  var KEY = "pt_pack_v4", OLD = "pt_pack_v3";
  var CATS = { go: ["必須", "衣類", "電子機器", "衛生・薬", "あると便利", "その他"], back: ["帰りの準備", "お土産", "その他"] };
  var ICON = { "必須": "🛂", "衣類": "👕", "電子機器": "🔌", "衛生・薬": "🧴", "あると便利": "✨", "その他": "📦", "帰りの準備": "🛫", "忘れ物チェック": "🔍", "お土産": "🎁" };
  /* 帰りの「忘れ物チェック」は、行きのリストと同じ内容(行きで足したり消したりすると、帰りにも反映される)。
     出発前にやることなど、帰りには関係ない項目だけ除く */
  var NB = { "パスポートの残りの期間を確認(入国日から6か月以上)": 1, "デジタル入国カード(TDAC)の登録・QRの保存": 1, "ホテルの予約確認": 1, "eSIM(出発前に設定)": 1, "現金(日本円・両替用)": 1 };
  var TITLE = { go: "行きの持ち物", back: "帰りの忘れ物" };
  /* [区分, 名前, 数] 数は自由に書き換えられる(空なら表示しない)。単位は品物に合わせる */
  var GO = [
    ["必須", "パスポート", ""], ["必須", "パスポートの残りの期間を確認(入国日から6か月以上)", ""], ["必須", "航空券(eチケット・予約確認メール)", ""],
    ["必須", "デジタル入国カード(TDAC)の登録・QRの保存", ""], ["必須", "ホテルの予約確認", ""], ["必須", "現金(日本円・両替用)", "○○円"],
    ["必須", "クレジットカード", "2枚"], ["必須", "海外旅行保険の控え", ""],
    ["衣類", "ポロシャツ", "3枚"], ["衣類", "Tシャツ", "3枚"], ["衣類", "長ズボン", "1本"], ["衣類", "短パン", "2本"], ["衣類", "下着", "5枚"], ["衣類", "靴下", "3足"],
    ["衣類", "サンダル", "1足"], ["衣類", "靴(スニーカーなど)", "1足"], ["衣類", "水着", "1着"], ["衣類", "薄手の羽織(冷房対策)", "1枚"], ["衣類", "帽子", "1個"], ["衣類", "パジャマ・部屋着", "1組"],
    ["電子機器", "スマホ", ""], ["電子機器", "スマホの充電器", ""], ["電子機器", "充電ケーブル", ""], ["電子機器", "モバイルバッテリー(機内持ち込み)", "1個"], ["電子機器", "イヤホン", ""],
    ["電子機器", "eSIM(出発前に設定)", ""], ["電子機器", "物理SIM(使う場合)", ""], ["電子機器", "SIMピン(物理SIMを入れ替える場合)", ""],
    ["衛生・薬", "歯ブラシ", ""], ["衛生・薬", "歯みがき粉", ""], ["衛生・薬", "洗顔・スキンケア用品", ""], ["衛生・薬", "ひげそり", ""], ["衛生・薬", "日焼け止め", "1本"], ["衛生・薬", "虫よけ", "1本"],
    ["衛生・薬", "胃腸薬", ""], ["衛生・薬", "頭痛薬・痛み止め", ""], ["衛生・薬", "いつも飲んでいる薬", ""], ["衛生・薬", "絆創膏", ""], ["衛生・薬", "マスク", "3枚"],
    ["あると便利", "サングラス", "1個"], ["あると便利", "折りたたみ傘", "1本"], ["あると便利", "ジップ付き袋", "数枚"], ["あると便利", "ウェットティッシュ", ""], ["あると便利", "ポケットティッシュ", ""],
    ["あると便利", "小さいバッグ(街歩き用)", "1個"], ["あると便利", "防水のスマホケース(ビーチ・雨用)", ""]
  ];
  var BACK = [
    ["帰りの準備", "日本入国の手続き(Visit Japan Web)の登録", ""], ["帰りの準備", "ホテルのチェックアウト・精算", ""], ["帰りの準備", "空港までの移動の手配", ""],
    ["帰りの準備", "余ったバーツを使い切る・両替する", ""], ["帰りの準備", "荷物の重さの確認", ""],
    ["お土産", "お菓子", ""], ["お土産", "ドライフルーツ(ドライマンゴーなど)", ""], ["お土産", "コーヒー・紅茶", ""], ["お土産", "ココナッツ製品", ""], ["お土産", "調味料・スパイス", ""]
  ];
  var NOTE = { go: "日数に合わせて、数を直したり、追加・削除してください。この端末の中に保存されます。",
    back: "行きに持っていったものが、そのまま並びます(行きのリストを直すと、ここも変わります)。忘れ物がないか確認し、お土産や帰りの準備は、下の「追加する」で足せます。生の果物・肉製品などは、日本に持ち込めない場合があります。" };
  var LAST = {}; // 最後に追加した区分(続けて同じ区分に足せるように)
  function esc(s) { return window.PT.esc(s); }
  function uid() { return Math.random().toString(36).slice(2, 10); }
  function mk(list, trip) { return list.map(function (d) { return { id: uid(), trip: trip, cat: d[0], name: d[1], qty: d[2], done: false }; }); }
  function defaults() { return mk(GO, "go").concat(mk(BACK, "back")); }
  function load() {
    try { var s = localStorage.getItem(KEY); if (s) { var d = JSON.parse(s); if (d && d.items) { d.backDone = d.backDone || {}; d.hide = d.hide || {}; d.items = d.items.filter(function (i) { return !(i.trip === "back" && i.cat === "忘れ物チェック"); }); return d; } } } catch (e) {}
    var fresh = null;
    try { /* 前の版(行きだけ)の内容を引き継ぐ */
      var o = localStorage.getItem(OLD);
      if (o) { var od = JSON.parse(o); if (od && od.items) { od.items.forEach(function (i) { i.trip = "go"; }); fresh = { items: od.items.concat(mk(BACK, "back")) }; } }
    } catch (e) {}
    fresh = fresh || { items: defaults() };
    fresh.backDone = {}; fresh.hide = {};
    save(fresh); // 最初に1回保存して、項目の番号を固定する
    return fresh;
  }
  function save(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {} }
  function mirrored(d) { return d.items.filter(function (i) { return i.trip === "go" && !NB[i.name] && !d.hide[i.id]; }); }
  function counts(trip) {
    var d = load();
    if (trip === "go") { var l = d.items.filter(function (i) { return i.trip === "go"; }); return { done: l.filter(function (i) { return i.done; }).length, all: l.length }; }
    var m = mirrored(d), o = d.items.filter(function (i) { return i.trip === "back"; });
    return { done: m.filter(function (i) { return d.backDone[i.id]; }).length + o.filter(function (i) { return i.done; }).length, all: m.length + o.length };
  }
  function cur() { var m = /#\/packing\/?(back)?/.exec(location.hash); return m && m[1] ? "back" : "go"; }

  function view(sub) {
    var trip = sub === "back" ? "back" : "go", d = load(), c = counts(trip), h = "";
    h += '<div class="pk-tabs"><a class="' + (trip === "go" ? "on" : "") + '" href="#/packing">🛫 行き</a><a class="' + (trip === "back" ? "on" : "") + '" href="#/packing/back">🛬 帰り</a></div>';
    h += '<div class="pk-top"><b>' + c.done + " / " + c.all + '</b> ' + (trip === "go" ? "そろった" : "確認した") + '<div class="pk-bar"><i style="width:' + (c.all ? Math.round(c.done / c.all * 100) : 0) + '%"></i></div></div>';
    h += '<p class="note">' + NOTE[trip] + "</p>";
    function row(i, mirror) {
      var on = mirror ? !!d.backDone[i.id] : i.done;
      return '<div class="pk-row' + (on ? " on" : "") + '"><button class="pk-ck" data-pk="tg" data-id="' + i.id + '" aria-label="チェック">' + (on ? "✔" : "") + '</button>' +
        '<span class="pk-n" data-pk="tg" data-id="' + i.id + '">' + esc(i.name) + '</span>' +
        (i.qty ? (mirror ? '<span class="pk-q">' + esc(i.qty) + "</span>" : '<button class="pk-q" data-pk="edit" data-id="' + i.id + '">' + esc(i.qty) + "</button>") : "") +
        (mirror ? "" : '<button class="pk-e" data-pk="edit" data-id="' + i.id + '" aria-label="直す">✎</button>') +
        '<button class="pk-x" data-pk="del" data-id="' + i.id + '" aria-label="' + (mirror ? "帰りのリストから外す" : "削除") + '">×</button></div>';
    }
    function section(cat, label, list, mirror) {
      if (!list.length) return;
      h += '<div class="stage pk-st"><i></i>' + (ICON[cat] || "") + " " + esc(label) + "</div>";
      list.forEach(function (i) { h += row(i, mirror); });
    }
    if (trip === "back") {
      var own = function (cat) { return d.items.filter(function (i) { return i.trip === "back" && i.cat === cat; }); };
      section("帰りの準備", "帰りの準備", own("帰りの準備"), false);
      CATS.go.forEach(function (cat) { section(cat, "忘れ物チェック:" + cat, mirrored(d).filter(function (i) { return i.cat === cat; }), true); });
      section("お土産", "お土産", own("お土産"), false);
      section("その他", "その他", own("その他"), false);
    } else {
      CATS.go.forEach(function (cat) { section(cat, cat, d.items.filter(function (i) { return i.trip === "go" && i.cat === cat; }), false); });
    }
    h += '<div class="card pk-add"><b>＋ 追加する</b><div class="pk-form"><select id="pk-cat">' + CATS[trip].map(function (c2) { return "<option" + (LAST[trip] === c2 ? " selected" : "") + ">" + esc(c2) + "</option>"; }).join("") +
      '</select><input id="pk-name" type="text" placeholder="' + (trip === "back" ? "名前(お土産など)" : "持ち物の名前") + '"><input id="pk-qty" type="text" placeholder="数(いらなければ空でOK。例: 2個)"></div><button class="btn" data-pk="add">追加</button></div>';
    h += '<div class="sc-btns pk-btns"><button class="btn sub" data-pk="clear">チェックを外す</button><button class="btn sub" data-pk="reset">最初に戻す</button></div>';
    return { title: TITLE[trip], html: h, back: trip === "go" ? "#/menu/packing" : "#/" };
  }

  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-pk]");
    if (!b) return;
    var act = b.getAttribute("data-pk"), id = b.getAttribute("data-id"), d = load(), it, trip = cur();
    if (id) it = d.items.filter(function (x) { return x.id === id; })[0];
    var mir = !!it && it.trip === "go" && trip === "back"; // 帰りのページに出ている、行きの項目
    if (act === "tg" && it) { if (mir) d.backDone[id] = !d.backDone[id]; else it.done = !it.done; }
    else if (act === "del" && it) {
      if (mir) { if (!confirm("「" + it.name + "」を、帰りのリストから外しますか?(行きのリストには残ります)")) return; d.hide[id] = true; }
      else { if (!confirm("「" + it.name + "」を消しますか?")) return; d.items = d.items.filter(function (x) { return x.id !== id; }); }
    }
    else if (act === "edit" && it) {
      var nn = prompt("名前を直す", it.name); if (nn === null) return;
      var q = prompt("数(いらなければ空のままでOK。例: 3枚、○○円)", it.qty || ""); if (q === null) return;
      it.name = nn.trim() || it.name; it.qty = q.trim();
    }
    else if (act === "add") {
      var nm = document.getElementById("pk-name").value.trim();
      if (!nm) { window.PT.toast("名前を入れてください"); return; }
      LAST[trip] = document.getElementById("pk-cat").value;
      d.items.push({ id: uid(), trip: trip, cat: LAST[trip], name: nm, qty: document.getElementById("pk-qty").value.trim(), done: false });
    }
    else if (act === "clear") { d.items.forEach(function (x) { if (x.trip === trip) x.done = false; }); if (trip === "back") d.backDone = {}; }
    else if (act === "reset") {
      if (!confirm((trip === "go" ? "行き" : "帰り") + "のリストを、最初の内容に戻します。追加・削除・数の変更は消えます。よろしいですか?")) return;
      d.items = d.items.filter(function (x) { return x.trip !== trip; }).concat(mk(trip === "go" ? GO : BACK, trip));
      if (trip === "back") { d.backDone = {}; d.hide = {}; }
    }
    else return;
    save(d); window.PT.render(true);
  });

  window.PTPacking = { view: view, counts: counts };
})();

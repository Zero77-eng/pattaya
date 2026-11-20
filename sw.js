/* オフライン用の裏方。
   ・画面のファイル(アプリの殻)は最初に保存し、次からは保存分を先に出して裏で更新する
   ・写真は保存分を先に出す(写真の名前は中身で決まるので、同じ名前なら同じ写真)
   ・データ(data/)は、この裏方では触らない(アプリ本体が管理する)。有料データ(data/paid)は読まない */
var SHELL = "pt-shell-v25";
var PHOTOS = "pt-photos";
var FILES = ["./", "index.html", "style.css", "app.js", "schedule.js", "packing.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(SHELL).then(function (c) {
    return Promise.all(FILES.map(function (f) { return c.add(new Request(f, { cache: "reload" })); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== SHELL && k !== PHOTOS && k !== "pt-video" && k.indexOf("ptm-") !== 0; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.indexOf("/data/") !== -1) return;
  if (url.pathname.indexOf("/memo/") !== -1) return; /* 取材メモは別のアプリ。ここでは触らない */

  if (url.pathname.indexOf("/video/") !== -1) {
    /* 保存した動画は、途中から再生できる形(Range)で返す。未保存ならそのままネットから */
    e.respondWith(caches.open("pt-video").then(function (c) {
      return c.match(url.pathname.replace(/^.*\/video\//, "video/")).then(function (hit) {
        if (!hit) return fetch(req);
        var range = req.headers.get("range");
        if (!range) return hit;
        return hit.blob().then(function (b) {
          var m = /bytes=(\d*)-(\d*)/.exec(range) || [], s = m[1] ? +m[1] : 0, en = m[2] ? Math.min(+m[2], b.size - 1) : b.size - 1;
          return new Response(b.slice(s, en + 1), { status: 206, headers: { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Content-Range": "bytes " + s + "-" + en + "/" + b.size, "Content-Length": String(en - s + 1) } });
        });
      });
    }));
    return;
  }
  if (url.pathname.indexOf("/photos/") !== -1 || url.pathname.indexOf("/pdf/") !== -1) {
    e.respondWith(caches.open(PHOTOS).then(function (c) {
      return c.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) { if (res.ok) c.put(req, res.clone()); return res; });
      });
    }));
    return;
  }

  e.respondWith(caches.open(SHELL).then(function (c) {
    return c.match(req, { ignoreSearch: true }).then(function (hit) {
      var net = fetch(req).then(function (res) { if (res.ok) c.put(req, res.clone()); return res; }).catch(function () { return null; });
      if (hit) { e.waitUntil(net); return hit; }
      return net.then(function (res) { return res || c.match("index.html"); });
    });
  }));
});

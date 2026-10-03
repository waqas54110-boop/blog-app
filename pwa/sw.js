// Service worker: offline page, thori si caching, aur push notifications.
// Privacy: logged-in pages (HTML / JSON) kabhi cache nahi hote, sirf offline page aur images.
// Cache badalna ho to VERSION badal dein: purane caches khud hat jate hain.
var VERSION = 'v1';
var STATIC_CACHE = 'static-' + VERSION;
var MEDIA_CACHE = 'media-' + VERSION;
var OFFLINE_URL = '/offline';
var MEDIA_MAX = 80;

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(function (cache) {
      // Offline page zaroori hai; icons na milen to bhi install ho jaye
      return cache.add(new Request(OFFLINE_URL, { cache: 'reload' })).then(function () {
        return Promise.all(['/icons/192.png', '/icons/512.png'].map(function (u) {
          return cache.add(new Request(u, { cache: 'reload' })).catch(function () {});
        }));
      });
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) {
        return k !== STATIC_CACHE && k !== MEDIA_CACHE;
      }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function trim(cache) {
  return cache.keys().then(function (keys) {
    if (keys.length <= MEDIA_MAX) return;
    return cache.delete(keys[0]).then(function () { return trim(cache); });
  });
}

// Sirf apni site ki seedhi (basic) kamyab image responses cache hoti hain.
// Cloudinary par redirect hone wali (opaque) images cache nahi karte: browser ka quota bahut zyada kha jati hain.
function cacheable(res) { return res && res.ok && res.type === 'basic'; }

function cacheFirst(req) {
  return caches.open(MEDIA_CACHE).then(function (cache) {
    return cache.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (cacheable(res)) { cache.put(req, res.clone()).then(function () { return trim(cache); }); }
        return res;
      });
    });
  });
}

// Avatar badal sakta hai: cache se foran dikhao, peeche se naya le aao
function staleWhileRevalidate(req) {
  return caches.open(MEDIA_CACHE).then(function (cache) {
    return cache.match(req).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (cacheable(res)) cache.put(req, res.clone());
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    });
  });
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  // Page kholna: internet na ho to offline page
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(function () {
        return caches.match(OFFLINE_URL).then(function (r) {
          return r || new Response('You are offline.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
        });
      })
    );
    return;
  }

  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf('/icons/') === 0) { event.respondWith(cacheFirst(req)); return; }
  if (url.pathname.indexOf('/img/') === 0) { event.respondWith(cacheFirst(req)); return; }
  if (url.pathname.indexOf('/a/') === 0) { event.respondWith(staleWhileRevalidate(req)); return; }
  // Baaqi sab (JSON, POST, stories, push...) seedha network se
});

self.addEventListener('push', function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}
  var title = data.title || 'New post';
  var opts = {
    body: data.body || '',
    data: { url: data.url || '/' },
    tag: data.tag || undefined
  };
  if (data.icon) { opts.icon = data.icon; opts.badge = data.icon; }
  event.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].url === target && 'focus' in list[i]) return list[i].focus();
      }
      return self.clients.openWindow(target);
    })
  );
});

// 一度開いたあとは通信なしでも遊べるようにする。
// ページ本体は通信を優先し（更新がすぐ届く）、つながらなければ保存しておいたものを出す。
// プログラムと文字（assets/。名前に中身の印が付き、中身は変わらない）は保存したものだけを使う。
// 納品画像（art/）は差し替えがすぐ届くよう通信を優先する。そのほかは保存したものをすぐ使い、裏で取り替える。
const CACHE = 'rechord-v1';
/** 電波が弱いとき、ページ本体をこれ以上待たずに保存しておいた版を出す */
const NAV_TIMEOUT_MS = 3000;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', 'manifest.webmanifest', 'icon-192.png'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('rechord-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(e) {
  const req = e.request;
  const c = await caches.open(CACHE);
  // ページ本体だけは、別の URL で開かれても保存しておいた本体を出す
  const cached = async () => (await c.match(req, { ignoreSearch: true, ignoreVary: true })) ?? (req.mode === 'navigate' ? await c.match('./') : undefined);
  const net = fetch(req).then(async (res) => {
    if (res.ok) await c.put(req, res.clone());
    return res;
  });
  e.waitUntil(net.then(() => undefined, () => undefined));
  const timeout = new Promise((r) => setTimeout(() => r(null), NAV_TIMEOUT_MS));
  try {
    // 時間内に届けば新しい版、届かなければ保存しておいた版（なければ通信を待ち続ける）
    const res = await Promise.race([net, timeout]);
    if (res) return res;
    return (await cached()) ?? (await net);
  } catch {
    return (await cached()) ?? Response.error();
  }
}

async function cacheFirst(req) {
  const c = await caches.open(CACHE);
  const hit = await c.match(req, { ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) await c.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(e) {
  const c = await caches.open(CACHE);
  // 保存時と読み込み時で Origin の有無が違うことがあるので Vary は見ない
  const hit = await c.match(e.request, { ignoreVary: true });
  const update = fetch(e.request)
    .then((res) => {
      if (res.ok) return c.put(e.request, res.clone()).then(() => res);
      return res;
    })
    .catch(() => hit ?? Response.error());
  if (hit) {
    e.waitUntil(update.then(() => undefined));
    return hit;
  }
  return update;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // 画面本体と納品画像（一覧と絵）は新しさが大事なので通信を優先する
  if (req.mode === 'navigate' || new URL(req.url).pathname.includes('/art/')) {
    e.respondWith(networkFirst(e));
    return;
  }
  if (new URL(req.url).pathname.includes('/assets/')) {
    e.respondWith(cacheFirst(req));
    return;
  }
  e.respondWith(staleWhileRevalidate(e));
});

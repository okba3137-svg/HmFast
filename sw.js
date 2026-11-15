// Service Worker لمتجر Nageebaha
const CACHE_VERSION = 'v1';
const STATIC_CACHE = `nageebaha-static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `nageebaha-dynamic-${CACHE_VERSION}`;

// الملفات الأساسية التي يتم تخزينها مسبقاً عند التثبيت
const PRECACHE_ASSETS = [
  '/',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
];

// صفحة بديلة مدمجة تظهر عند انقطاع الإنترنت وعدم توفر الصفحة في الذاكرة المؤقتة
const OFFLINE_FALLBACK_HTML = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Nageebaha - غير متصل بالإنترنت</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background-color: #12151C;
      color: #FAF8F5;
      font-family: system-ui, -apple-system, sans-serif;
      text-align: center;
      padding: 24px;
    }
    .card {
      max-width: 400px;
      padding: 32px 24px;
      border: 1px solid rgba(212, 175, 55, 0.3);
      border-radius: 16px;
      background: rgba(255, 255, 255, 0.03);
    }
    h1 {
      color: #D4AF37;
      margin-bottom: 12px;
      font-size: 1.5rem;
    }
    p {
      line-height: 1.6;
      opacity: 0.85;
      margin-bottom: 24px;
    }
    button {
      background-color: #D4AF37;
      color: #12151C;
      border: none;
      padding: 12px 24px;
      border-radius: 8px;
      font-weight: bold;
      font-size: 1rem;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>متجر Nageebaha</h1>
    <p>يبدو أنك غير متصل بالإنترنت حالياً. يرجى التحقق من اتصالك والمحاولة مرة أخرى.</p>
    <button onclick="window.location.reload()">إعادة المحاولة</button>
  </div>
</body>
</html>`;

// 1. مرحلة التثبيت (Install): تخزين الملفات الأساسية
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(async (cache) => {
      // تخزين كل ملف بشكل مستقل لضمان عدم فشل التثبيت في حال غياب أحد الملفات الفرعية
      await Promise.allSettled(
        PRECACHE_ASSETS.map((url) => cache.add(url))
      );
    }).then(() => self.skipWaiting())
  );
});

// 2. مرحلة التفعيل (Activate): حذف نسخ الكاش القديمة
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== STATIC_CACHE && name !== DYNAMIC_CACHE)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

// 3. اعتراض الطلبات (Fetch) وتطبيق استراتيجيات التخزين المناسبة للمتجر
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // تجاهل الطلبات غير GET (مثل POST لإتمام الطلبات) وطلبات إضافات المتصفح
  if (request.method !== 'GET' || !url.protocol.startsWith('http')) {
    return;
  }

  // استراتيجية الشبكة أولاً (Network-First) لصفحات التنقل وبيانات المنتجات والأسعار (API)
  if (request.mode === 'navigate' || url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(DYNAMIC_CACHE).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(async () => {
          const cachedResponse = await caches.match(request);
          if (cachedResponse) {
            return cachedResponse;
          }
          if (request.mode === 'navigate') {
            return new Response(OFFLINE_FALLBACK_HTML, {
              headers: { 'Content-Type': 'text/html; charset=utf-8' }
            });
          }
          return new Response(JSON.stringify({ error: 'Offline' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          });
        })
    );
    return;
  }

  // استراتيجية الكاش أولاً مع التحديث بالخلفية (Stale-While-Revalidate) للصور والخطوط والملفات الثابتة
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(DYNAMIC_CACHE).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});

// 4. دعم الإشعارات الفورية (Push Notifications) للعروض وحالة الطلبات
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'متجر Nageebaha';
  const options = {
    body: data.body || 'لديك إشعار جديد من متجر Nageebaha',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-96x96.png',
    dir: 'rtl',
    lang: 'ar',
    data: { url: data.url || '/' }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// فتح رابط المتجر عند النقر على الإشعار
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === targetUrl && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

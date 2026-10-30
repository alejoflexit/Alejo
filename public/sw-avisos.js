// sw-avisos.js — service worker SOLO para avisos del sistema (Web Push) de Flexit.
// No cachea nada (la app sigue cargando siempre de la red). Lo registra el botón
// "Activar avisos en la compu" de Monitoreo. El vigía del VPS manda el push (vps/vigia-datos.js).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { titulo: 'Flexit', cuerpo: e.data ? e.data.text() : '' }; }
  const titulo = d.titulo || 'Flexit · Monitoreo';
  e.waitUntil(self.registration.showNotification(titulo, {
    body: d.cuerpo || '',
    tag: d.tag || 'flexit-monitoreo',
    renotify: true,
    requireInteraction: true,
    icon: '/flexit-app-icon-192.png',
    badge: '/flexit-app-icon-192.png',
    data: { url: d.url || '/#monitoreo', cadete: d.cadete || null },
    // Aviso de cadete frenado: un solo botón, copiar el reclamo de pendientes (lo arma la app)
    actions: d.cadete ? [{ action: 'copiar', title: 'Copiar reclamo' }] : [],
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const { url, cadete } = e.notification.data || {};
  const copiar = e.action === 'copiar' && cadete;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const app = wins.find((w) => w.url.startsWith(self.location.origin));
    if (app) {
      await app.focus();
      app.postMessage({ tipo: copiar ? 'fx-copiar-reclamo' : 'fx-abrir-cadete', cadete });
      return;
    }
    const q = copiar ? `reclamo=${encodeURIComponent(cadete)}` : `cadete=${encodeURIComponent(cadete || '')}`;
    await self.clients.openWindow(cadete ? `/?${q}#monitoreo` : (url || '/#monitoreo'));
  })());
});

/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching';

declare let self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener('push', (event) => {
    const data = event.data?.json() ?? {};

    const options: NotificationOptions = {
        body: data.body || 'Nuova Notifica',
        icon: '/icon-192x192.png',
        data: { url: data.url || '/' }
    };

    event.waitUntil(
        self.registration.showNotification(data.title || 'Appuntamenti', options)
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    let urlToOpen = new URL('/', self.location.origin).href;
    if (event.notification.data && event.notification.data.url) {
        urlToOpen = new URL(event.notification.data.url, self.location.origin).href;
    }

    event.waitUntil(
        self.clients.openWindow(urlToOpen)
    );
});

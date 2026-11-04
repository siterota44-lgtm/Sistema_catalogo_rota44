/*
 * Service worker mínimo: permite instalar o sistema como app no celular.
 * Não intercepta requisições e não guarda nada em cache: uma atualização do
 * site aparece na hora.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

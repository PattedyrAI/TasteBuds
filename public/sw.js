const CACHE='tastebuds-public-v2';
const OFFLINE='/offline.html';
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll([OFFLINE,'/icon-192.png'])).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>['tastebuds-public-','everrate-public-','scawwyrate-public-'].some(prefix=>key.startsWith(prefix))&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
// Private pages, API responses and photos are never written to offline caches.
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||event.request.mode!=='navigate'||url.origin!==self.location.origin||url.pathname.startsWith('/auth/'))return;
  event.respondWith(fetch(event.request).catch(async()=>await caches.match(OFFLINE)||Response.error()));
});

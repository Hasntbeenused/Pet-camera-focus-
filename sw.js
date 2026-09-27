const CACHE='photo-sounds-v3';
const ASSETS=['./','./index.html','./app.js','./manifest.webmanifest','./favicon.svg','./icon-192.png','./icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>(k.startsWith('photo-sounds-')||k.startsWith('dog-attention-pip-cache-'))&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url),scope=new URL(self.registration.scope);
  if(request.method!=='GET'||url.origin!==scope.origin||!url.pathname.startsWith(scope.pathname))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    try{const response=await fetch(request);if(response.ok)await cache.put(request,response.clone());return response;}
    catch{const cached=await cache.match(request);return cached||(request.mode==='navigate'?await cache.match('./index.html'):null)||new Response('Unavailable offline',{status:503});}
  })());
});

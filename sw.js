const CACHE='fampro-events-v151-seo';
const ASSETS=['./','./index.html','./admin-workflows.js?v=109','./admin-freshness.js?v=136','./qr-share.js?v=138','./login.html','./client.html','./location-tentes.html','./location-mobilier.html','./decoration-evenementielle.html','./confirmation-client.html','./client-catalog-sync.js?v=145','./manifest.webmanifest','./client.webmanifest','./092508DF-3780-43EC-8976-384F9EF65BE0.png','./table-doree.png','./fampro-espace-client-qr.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('fampro-events-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||event.request.url.includes('supabase.co'))return;
  if(event.request.mode==='navigate'){
    const path=new URL(event.request.url).pathname;
    const file=path.split('/').pop();
    const asset=path==='/'||!file?'./client.html':'./'+file;
    event.respondWith(fetch(event.request).then(response=>{
      if(response.ok)caches.open(CACHE).then(cache=>cache.put(asset,response.clone()));
      return response;
    }).catch(()=>caches.match(asset,{ignoreSearch:true})));
    return;
  }
  if(new URL(event.request.url).origin!==self.location.origin)return;
  if(event.request.destination==='image'){
    event.respondWith(fetch(event.request,{cache:'no-store'}).then(response=>{
      if(response.ok)caches.open(CACHE).then(cache=>cache.put(event.request,response.clone()));
      return response;
    }).catch(()=>caches.match(event.request,{ignoreSearch:true})));
    return;
  }
  event.respondWith(caches.match(event.request).then(hit=>{
    if(hit)return hit;
    return fetch(event.request).then(response=>{
      return response;
    });
  }));
});

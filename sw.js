const CACHE='fampro-events-v120';
const ASSETS=['./','./index.html','./admin-workflows.js?v=105','./login.html','./client.html','./manifest.webmanifest','./client.webmanifest','./092508DF-3780-43EC-8976-384F9EF65BE0.png','./table-doree.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('fampro-events-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||event.request.url.includes('supabase.co'))return;
  if(event.request.mode==='navigate'){
    const path=new URL(event.request.url).pathname;
    const asset=path.endsWith('/client.html')?'./client.html':path.endsWith('/login.html')?'./login.html':'./index.html';
    event.respondWith(fetch(event.request).then(response=>{
      if(response.ok)caches.open(CACHE).then(cache=>cache.put(asset,response.clone()));
      return response;
    }).catch(()=>caches.match(asset,{ignoreSearch:true})));
    return;
  }
  if(new URL(event.request.url).origin!==self.location.origin)return;
  event.respondWith(caches.match(event.request).then(hit=>{
    if(hit)return hit;
    return fetch(event.request).then(response=>{
      return response;
    });
  }));
});

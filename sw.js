const CACHE='fampro-events-v45';
const ASSETS=['./','./index.html','./login.html','./client.html','./manifest.webmanifest','./092508DF-3780-43EC-8976-384F9EF65BE0.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||event.request.url.includes('supabase.co'))return;
  if(event.request.mode==='navigate'){
    const path=new URL(event.request.url).pathname;
    const asset=path.endsWith('/client.html')?'./client.html':path.endsWith('/login.html')?'./login.html':'./index.html';
    event.respondWith(caches.match(asset,{ignoreSearch:true}).then(cached=>{
      const update=fetch(event.request).then(response=>{if(response.ok)caches.open(CACHE).then(cache=>cache.put(asset,response.clone()));return response});
      return cached||update;
    }).catch(()=>caches.match(asset,{ignoreSearch:true})));
    return;
  }
  event.respondWith(caches.match(event.request).then(hit=>{
    if(hit)return hit;
    return fetch(event.request).then(response=>{
      const url=new URL(event.request.url);
      if(url.hostname==='cdn.jsdelivr.net'&&response.ok)caches.open(CACHE).then(cache=>cache.put(event.request,response.clone()));
      return response;
    });
  }));
});

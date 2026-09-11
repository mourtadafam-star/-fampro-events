const CACHE='fampro-events-v6';
const ASSETS=['./','./index.html','./login.html','./manifest.webmanifest','./092508DF-3780-43EC-8976-384F9EF65BE0.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||event.request.url.includes('supabase.co'))return;
  if(event.request.mode==='navigate'){
    event.respondWith(caches.match('./index.html',{ignoreSearch:true}).then(cached=>{
      const update=fetch(event.request).then(response=>{if(response.ok)caches.open(CACHE).then(cache=>cache.put('./index.html',response.clone()));return response});
      return cached||update;
    }).catch(()=>caches.match('./index.html',{ignoreSearch:true})));
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

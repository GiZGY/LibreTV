(() => {
 const ttl=7*86400000,valid=c=>c?.country==='US'&&['G','PG','PG-13','R','NC-17'].includes(c.label);
 const key=f=>f.type!=='电影'?'':f.catalogProvider==='tmdb'&&/^movie:\d+$/.test(f.catalogId)?f.catalogId:
   f.name&&/^\d{4}$/.test(String(f.year))?JSON.stringify([f.name.normalize('NFKC').trim(),String(f.year)]):'';
 const rows=load('searchCertificates',[]),cache=new Map((Array.isArray(rows)?rows:[]).filter(r=>Array.isArray(r)&&typeof r[0]==='string'&&valid(r[1]?.certificate)&&r[1].at<=Date.now()&&Date.now()-r[1].at<ttl).slice(-160));
 const peek=f=>{const hit=cache.get(key(f));return hit&&Date.now()-hit.at<ttl?hit.certificate:null;};
 function remember(f,certificate){
   const k=key(f);if(!k||!valid(certificate))return;
   cache.delete(k);cache.set(k,{at:Date.now(),certificate});while(cache.size>160)cache.delete(cache.keys().next().value);
   save('searchCertificates',[...cache]);
 }
 const needsScore=f=>f.scoreConflict&&f.ratingSource!=='TMDB';
 function watch(host,signal){
   const films=new WeakMap(),visible=new Set(),attempted=new WeakMap();let active=0;
   const observer=new IntersectionObserver(entries=>{
     for(const e of entries){if(e.isIntersecting)visible.add(e.target);else visible.delete(e.target);}pump();
   },{rootMargin:'0px'});
   function update(node,f,k,certificate){
     if(!valid(certificate)||signal.aborted||!host.contains(node)||films.get(node)!==f||key(f)!==k)return;
     f.certification=certificate;const html=posterMeta(f);node.querySelector('.poster-meta').innerHTML=html;node._posterMeta=html;
   }
   async function fetchOne(node,f,k){
     const cached=peek(f);if(cached){update(node,f,k,cached);if(!needsScore(f))return;}
     const match=f.catalogProvider==='tmdb'&&/^movie:\d+$/.test(f.catalogId)?{id:f.catalogId}:await LiveData.lookupTMDB(f,signal);
     if(signal.aborted||!match||!/^movie:\d+$/.test(match.id)||key(f)!==k)return;
     const details=await LiveData.detailTMDB(match.id,signal);
     if(signal.aborted||key(f)!==k||!host.contains(node)||films.get(node)!==f)return;
     if(Number(details.rate)>0&&Number(details.rate)<=10&&details.rating_source==='TMDB'){
       f.rating=details.rate;f.ratingSource='TMDB';
       const html=posterMeta(f);node.querySelector('.poster-meta').innerHTML=html;node._posterMeta=html;
     }
     if(!valid(details.certification))return;
     remember(f,details.certification);update(node,f,k,details.certification);
   }
   function pump(){
     if(signal.aborted)return;
     for(const node of visible){
       if(active>=2)break;
       if(!host.contains(node)){visible.delete(node);observer.unobserve(node);continue;}
       const f=films.get(node),k=f&&key(f);
       const attempt=k+':'+Number(!!needsScore(f));
       if(!k||(valid(f.certification)&&!needsScore(f))||attempted.get(node)===attempt)continue;
       attempted.set(node,attempt);active++;
       fetchOne(node,f,k).catch(()=>{}).finally(()=>{active--;pump();});
     }
   }
   signal.addEventListener('abort',()=>{observer.disconnect();visible.clear();},{once:true});
   return (node,f)=>{films.set(node,f);if((!valid(f.certification)||needsScore(f))&&key(f)){observer.observe(node);pump();}};
 }
 window.OpenStreamSearchCertificates={peek,remember,watch};
})();

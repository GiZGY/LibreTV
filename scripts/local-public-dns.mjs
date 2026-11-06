// Resolve the public origin before connecting: desktop VPNs can hand OS lookups a synthetic IP.
import {isIPv4} from 'node:net';
import {Agent,fetch as upstreamFetch} from 'undici';
import {proxyInternals} from '../api/proxy/[...path].mjs';

export function publicLookup(resolve) {
 const cache=new Map();
 return (host,options,callback)=>{
  if(proxyInternals.isForbiddenHostname(host))return callback(Object.assign(Error('Blocked host'),{code:'ERR_BLOCKED_ADDRESS'}));
  const now=Date.now();let entry=cache.get(host);
  if(!entry||entry.until<=now){
   entry={until:now+30000,query:Promise.resolve().then(()=>resolve(host)).then(answers=>{
    const rows=answers.filter(item=>item.type===1);
    if(!rows.length||rows.some(r=>!isIPv4(r.data)||proxyInternals.isForbiddenAddress(r.data)))throw Object.assign(Error('Not a public origin'),{code:'ERR_BLOCKED_ADDRESS'});
    entry.until=Date.now()+1000*Math.min(30,...rows.map(r=>Math.max(0,Number(r.TTL)||0)));
    return rows.map(r=>({address:r.data,family:4}));
   })};if(cache.size>=256)cache.delete(cache.keys().next().value);cache.set(host,entry);
  }
  entry.query.then(rows=>options?.all?callback(null,rows):callback(null,rows[0].address,4),error=>{if(cache.get(host)===entry)cache.delete(host);callback(error);});
 };
}

export function localPublicFetch(dnsFetch){
 const lookup=publicLookup(async host=>{
  const url=new URL('https://cloudflare-dns.com/dns-query');url.search=new URLSearchParams({name:host,type:'A'});
  const r=await dnsFetch(url,{headers:{Accept:'application/dns-json'},redirect:'error',signal:AbortSignal.timeout(4500)});
  if(!r.ok)throw Error('DNS service unavailable');const data=await r.json();if(data.Status!==0)throw Error('DNS lookup failed');return data.Answer||[];
 });
 const dispatcher=new Agent({connect:{lookup,family:4}});
 return (url,options)=>upstreamFetch(url,{...options,redirect:'manual',dispatcher});
}

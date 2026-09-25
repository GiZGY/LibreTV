import {readFile,writeFile} from 'node:fs/promises';
import dotenv from 'dotenv';
import {catalogDatabase} from '../server/catalog-index.mjs';
import {createSyncStore,syncBatch,tmdbSyncRequest,CATALOG_START_YEAR} from '../server/catalog-sync.mjs';
import {createRefreshStore,refreshBatch} from '../server/catalog-refresh.mjs';
dotenv.config({path:'.env.local',quiet:true});
dotenv.config({path:'.env.catalog.local',quiet:true});
const [command,...args]=process.argv.slice(2);
const value=key=>args.find(arg=>arg.startsWith(key+'='))?.slice(key.length+1);
let recordFailure;
try{
  const query=catalogDatabase(),refresh=command==='refresh',store=refresh?createRefreshStore(query):createSyncStore(query);
  if(command==='migrate'){
    const schema=await readFile(new URL('../server/catalog-schema.sql',import.meta.url),'utf8');
    for(const statement of schema.split(';').map(sql=>sql.trim()).filter(Boolean))await query(statement);
    console.log('Catalog schema ready.');
  }else if(command==='status'){
    console.log(JSON.stringify(await query(`SELECT r.id::text,r.status,r.coverage,r.published_at,
      r.cursor->'pages' AS scanned_pages,r.cursor->'complete' AS complete,
      (SELECT count(*)::int FROM catalog_entries e WHERE e.revision=r.id) AS entries
      FROM catalog_revisions r ORDER BY id DESC LIMIT 5`),null,2));
  }else if(command==='sync'||refresh){
    const options={};for(const key of ['from','to'])if(value(key))options[key]=Number(value(key));
    if(refresh)await store.prune();
    let state=refresh?await store.beginRefresh():await store.begin(options);
    if(!state){console.log('Catalog is up to date.');process.exit(0);}
    let fetchImpl=globalThis.fetch;
    const proxy=process.env.HTTPS_PROXY||process.env.https_proxy;
    if(proxy){const {ProxyAgent,fetch}=await import('undici');const dispatcher=new ProxyAgent(proxy);fetchImpl=(url,options)=>fetch(url,{...options,dispatcher});}
    const request=tmdbSyncRequest({token:process.env.TMDB_READ_ACCESS_TOKEN,fetchImpl});
    const batches=Number(value('batches')||1),minutes=Number(value('minutes')||90),started=Date.now();
    if(!Number.isInteger(batches)||batches<1||batches>10000||!Number.isFinite(minutes)||minutes<1||minutes>360)throw Error('Invalid bounded import budget');
    const saveStatus=async status=>writeFile(refresh?'.catalog-refresh-status.local':'.catalog-sync-status.local',JSON.stringify({pid:process.pid,startedAt:new Date(started).toISOString(),updatedAt:new Date().toISOString(),revision:state.id,pages:state.cursor.pages,requests:state.cursor.requests,remainingWindows:state.cursor.queue.length,complete:state.cursor.complete,status},null,2)+'\n',{mode:0o600});
    recordFailure=saveStatus;
    await saveStatus('running');
    let retries=0;
    for(let i=0;i<batches&&!state.cursor.complete&&Date.now()-started<minutes*60000;i++){
      try{
      state=await (refresh?refreshBatch:syncBatch)({store,state,request,maxRequests:Number(value('requests')||40)});
      retries=0;
      }catch(error){
        if((!error.status||[429,502,504].includes(error.status))&&retries<3){
          await saveStatus('retrying-'+(error.status||'database'));
          const delay=error.status===429?60000:5000*2**retries;retries++;
          if(Date.now()-started+delay>=minutes*60000){await saveStatus('budget-exhausted');break;}
          await new Promise(resolve=>setTimeout(resolve,delay));
          // Loading the saved checkpoint can also fail during a short DB outage.
          for(let attempt=0;;attempt++){
            try{state=await store.load(state.id);break;}catch(loadError){
              if(loadError.status===409||attempt>=2)throw loadError;
              await new Promise(resolve=>setTimeout(resolve,2000*(attempt+1)));
            }
          }
          continue;
        }
        await saveStatus('stopped-error-'+(error.status||'database'));throw error;
      }
      await saveStatus('running');
      console.log(JSON.stringify({revision:state.id,pages:state.cursor.pages,requests:state.batchRequests,stored:state.batchEntries,remainingWindows:state.cursor.queue.length,complete:state.cursor.complete}));
    }
    await saveStatus(state.cursor.complete?'complete-unpublished':'budget-exhausted');
    if(refresh&&state.cursor.complete){
      await store.publishRefresh(state);await saveStatus('published');console.log('Refreshed catalog published.');
    }else if(refresh){process.exitCode=2;}
  }else if(command==='narrow'){
    const id=value('revision');if(!/^[1-9]\d*$/.test(id||''))throw Error('Specify revision=<id>');
    const state=await store.narrow(await store.load(id),Number(value('from')||CATALOG_START_YEAR));
    console.log(JSON.stringify({revision:state.id,coverage:state.coverage,remainingWindows:state.cursor.queue.length}));
  }else if(command==='publish'){
    const id=value('revision');if(!/^[1-9]\d*$/.test(id||''))throw Error('Specify revision=<id>');
    const [state]=await query("SELECT id::text,version,cursor,coverage FROM catalog_revisions WHERE id=$1::bigint AND status='draft'",[id]);
    if(!state)throw Error('Draft not found');
    if(state.coverage.from!==CATALOG_START_YEAR||state.coverage.to<new Date().getUTCFullYear())throw Object.assign(Error('Incomplete year coverage'),{status:409});
    console.log(JSON.stringify(await store.publish(state)));
  }else throw Error('Usage: catalog-index.mjs migrate|status|sync [from=1990 batches=1 requests=40]|narrow revision=<id> from=1990|publish revision=<id>');
}catch(error){
  try{await recordFailure?.('stopped-error-'+(error.status||'database'));}catch{}
  // Database errors can contain connection details: never print raw exceptions.
  console.error(error.status?`Catalog operation stopped (${error.status}). Progress is retained.`:'Catalog operation failed. Check configuration and database connectivity.');
  process.exitCode=1;
}

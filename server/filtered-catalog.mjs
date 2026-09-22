import { createHash } from 'node:crypto';

const fail=(status,message)=>Object.assign(new Error(message),{status});
export function catalogItemAllowed(item){
  const title=String(item.title||'').replace(/<[^>]*>/g,'').trim();
  const score=Number(item.rate);
  return /[\u3400-\u9fff]/u.test(title)&&!/[\u3040-\u30ff\uac00-\ud7af]/u.test(title)
    && !(Number.isFinite(score)&&score>0&&score<5)
    && !/伦理片|伦理剧|色情|情色|成人片|里番|三级片|福利姬|AV女优|无码|有码|电影解说|影视解说|剧集解说|解说版|\[解说\]|【解说】/iu.test(title+' '+item.type_name);
}

// Logical pages are immutable within a cache generation. Source-page boundaries
// are deliberately unrelated to displayed page boundaries.
export function createFilteredCatalog({readPage,normalize,sharedCache,now=Date.now}){
  const pages=new Map(),pending=new Map();
  async function load(key){
    const local=pages.get(key);if(local&&local.until>now())return local;
    pages.delete(key);
    try{const remote=await sharedCache?.get(key);if(remote&&remote.until>now())return remote;}catch{}
  }
  async function save(key,value){
    pages.set(key,value);while(pages.size>50)pages.delete(pages.keys().next().value);
    try{await sharedCache?.set(key,value,{ttl:7200});}catch{}
  }
  return async query=>{
    const page=Number(query.page??1),size=Number(query.pageSize??40);
    if(!Number.isInteger(page)||page<1||page>500||![20,40].includes(size))throw fail(400,'分页参数无效');
    const snapshot=String(query.snapshot||'shared');
    if(!/^[a-zA-Z0-9-]{1,64}$/.test(snapshot))throw fail(400,'分页标识无效');
    const params={...query};delete params.pageSize;delete params.generation;
    params.kind='discover';params.page='1';
    const normalized=normalize(params);
    const generation=Number(query.generation??Math.floor(now()/3600000));
    if(!Number.isInteger(generation)||generation>Math.floor(now()/3600000)||generation<Math.floor(now()/3600000)-1)throw fail(410,'目录已更新，请刷新页面');
    const prefix='filtered-catalog-v1:'+createHash('sha256').update(normalized.url.href+':'+size+':'+generation+':'+snapshot).digest('hex');
    const wanted=prefix+':'+page;
    const cached=await load(wanted);if(cached)return cached.result;
    while(pending.has(prefix)){await pending.get(prefix);const hit=await load(wanted);if(hit)return hit.result;}
    if(pending.size>=3)throw fail(429,'目录繁忙，请稍后重试');
    const task=(async()=>{
      let reads=0;
      const deadline=now()+18000;
      let state={buffer:[],seen:[],sourcePage:1,done:false,total:0,capped:false,count:0};
      let first=1;
      const previous=page>1?await load(prefix+':'+(page-1)):null;
      const head=await load(prefix+':head');
      if(previous){state=structuredClone(previous.state);first=page;}
      else if(head){
        if(head.page>=page)throw fail(410,'目录已更新，请刷新页面');
        state=structuredClone(head.state);first=head.page+1;
      }
      for(let logical=first;logical<=page;logical++){
        const key=prefix+':'+logical,hit=await load(key);
        if(hit){state=structuredClone(hit.state);if(logical===page)return hit.result;continue;}
        const work=await load(key+':work');
        if(work)state=structuredClone(work.state);
        if(logical>1&&state.done&&!state.buffer.length)throw fail(404,'已到最后一页');
        const seen=new Set(state.seen);
        while(state.buffer.length<=size&&!state.done){
          if(reads>=6||now()>deadline)throw fail(503,'目录正在整理，请稍后重试');
          const batch=await readPage({...params,page:String(state.sourcePage)});reads++;
          state.total=batch.total;state.capped=!!batch.capped;
          for(const item of batch.items){
            if(!seen.has(item.id)&&catalogItemAllowed(item)){seen.add(item.id);state.buffer.push(item);}
          }
          state.sourcePage++;
          state.done=!batch.hasNext||state.sourcePage>500;
          state.seen=[...seen];
          await save(key+':work',{until:(generation+2)*3600000,state:structuredClone(state)});
        }
        state.seen=[...seen];
        const items=state.buffer.splice(0,size);state.count+=items.length;
        const hasNext=state.buffer.length>0||!state.done;
        const result={provider:'tmdb',items,page:logical,rawCount:items.length,total:state.total,
          totalPages:state.done?Math.ceil((state.count+state.buffer.length)/size):null,
          hasNext,capped:state.capped,filtered:true,generation};
        await save(key,{until:(generation+2)*3600000,state:structuredClone(state),result});
        pages.delete(key+':work');
        await save(prefix+':head',{until:(generation+2)*3600000,page:logical,state:structuredClone(state)});
        if(logical===page)return result;
        if(!hasNext)throw fail(404,'已到最后一页');
      }
    })();
    pending.set(prefix,task);
    try{return await task;}finally{if(pending.get(prefix)===task)pending.delete(prefix);}
  };
}

import {createHash, randomUUID} from 'node:crypto';
import {catalogDatabase} from './catalog-index.mjs';

const failure=(status,message,code)=>Object.assign(new Error(message),{status,code});
const hash=value=>createHash('sha256').update('openstream:device-sync:v1:'+value).digest('hex');
const uuid=value=>typeof value==='string'&&/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(value);
const secret=value=>typeof value==='string'&&/^[\w-]{43}$/.test(value);
const episodeKey=value=>typeof value==='string'&&value.length<=160&&value.length>0&&!/[<>\x00-\x1f]|:\/\//.test(value)&&/^(?:feature$|s\d{1,3}:e\d{1,4}(?::[上中下])?$|(?:special|label|unresolved):)/.test(value);
const key=value=>typeof value==='string'&&/^[\p{L}\p{N}_.:-]{1,160}$/u.test(value)&&!['__proto__','constructor','prototype'].includes(value);
const integer=(value,max)=>Number.isSafeInteger(value)&&value>=0&&value<=max;
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const text=(value,max)=>typeof value==='string'?value.replace(/<[^>]*>/g,'').replace(/[\x00-\x1f]/g,'').slice(0,max):undefined;
const validName=value=>typeof value==='string'&&value.length<=40&&!!text(value.trim(),40).trim();
const stamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():undefined;
const object=entries=>Object.fromEntries(entries.filter(([,value])=>value!==undefined));
function film(value){
  if(!plain(value)||typeof value.id!=='string'||!/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(value.id)||typeof value.name!=='string'||!value.name.trim())throw failure(400,'作品资料无效');
  const result={id:value.id,name:text(value.name,160),episodes:value.episodes===undefined?1:Number(value.episodes),seasons:value.seasons===undefined?1:Number(value.seasons)};
  if(!result.name.trim())throw failure(400,'作品名称无效');
  for(const name of ['en','type','genre','catalogProvider'])if(value[name]!==undefined)result[name]=text(value[name],160);
  for(const name of ['year','episodes','seasons'])if(value[name]!==undefined){if(!integer(Number(value[name]),1000000000))throw failure(400,'作品资料无效');result[name]=Number(value[name]);}
  if(value.episodes!==undefined&&(!integer(Number(value.episodes),5000)||Number(value.episodes)<1)||value.seasons!==undefined&&(!integer(Number(value.seasons),200)||Number(value.seasons)<1))throw failure(400,'作品集数无效');
  if(value.catalogId!==undefined){if(!/^(?:(?:movie|tv):)?\d{1,12}$/.test(String(value.catalogId)))throw failure(400,'作品标识无效');result.catalogId=String(value.catalogId);}
  return result;
}
export function syncRecordValue(bucket,value){
  if(!plain(value))throw failure(400,'同步内容无效');
  if(bucket==='favorite'){
    if(value.updatedAt!==undefined&&!stamp(value.updatedAt))throw failure(400,'收藏时间无效');
    if(!['watching','planned','completed'].includes(value.status))throw failure(400,'收藏分类无效');
    return object([['film',film(value.film)],['status',value.status],['updatedAt',stamp(value.updatedAt)||new Date(0).toISOString()]]);
  }
  if(bucket==='progress'){
    const p=value.progress;
    if(!plain(p)||p.watchedAt!==undefined&&!stamp(p.watchedAt)||!Number.isFinite(p.position)||p.position<0||p.position>86400||p.duration>0&&p.position>p.duration||!Number.isFinite(p.duration)||p.duration<0||p.duration>86400||!integer(p.episode,5000)||p.episode<1||!integer(p.season,200)||p.season<1)throw failure(400,'观看进度无效');
    if(p.totalEpisodes!==undefined&&(!integer(p.totalEpisodes,5000)||p.totalEpisodes<1))throw failure(400,'更新集数无效');
    const progress=object([['position',Math.floor(p.position)],['duration',Math.floor(p.duration)],['season',p.season],['episode',p.episode],['watchedAt',stamp(p.watchedAt)||new Date(0).toISOString()],['completed',p.completed===true],['totalEpisodes',integer(p.totalEpisodes,5000)&&p.totalEpisodes>=1?p.totalEpisodes:1]]);
    if(p.episodeKey!==undefined){if(!episodeKey(p.episodeKey))throw failure(400,'剧集标识无效');progress.episodeKey=p.episodeKey;}
    if(p.completedEpisodes!==undefined){if(!Array.isArray(p.completedEpisodes)||p.completedEpisodes.length>1000||p.completedEpisodes.some(value=>!episodeKey(value)))throw failure(400,'完成集数记录无效');progress.completedEpisodes=[...new Set(p.completedEpisodes)].sort();}
    return {film:film(value.film),progress};
  }
  if(bucket==='skip'){
    if(!integer(value.intro,300)||!integer(value.outro,300))throw failure(400,'跳过设置无效');
    return {intro:value.intro,outro:value.outro};
  }
  if(bucket==='preferences'){
    const result={};
    for(const name of ['autoplay','motion','darkMode','mobileAutoTheme'])if(value[name]!==undefined){if(typeof value[name]!=='boolean')throw failure(400,'播放偏好无效');result[name]=value[name];}
    if(value.playbackRate!==undefined){if(!Number.isFinite(value.playbackRate)||value.playbackRate<.25||value.playbackRate>4)throw failure(400,'倍速偏好无效');result.playbackRate=value.playbackRate;}
    return result;
  }
  throw failure(400,'同步类型无效');
}
const publicRecord=row=>({bucket:row.bucket,key:row.key,value:row.data,deleted:row.deleted,version:row.version,sessionId:row.active_session||null,sequence:row.last_sequence||0,updatedAt:new Date(row.updated_at).toISOString()});
const activeSQL='SELECT d.* FROM openstream_sync.devices d JOIN openstream_sync.spaces s ON s.id=d.space_id WHERE d.token_hash=$1 AND d.approved_at IS NOT NULL AND d.revoked_at IS NULL AND s.closed_at IS NULL';
export function createDeviceSyncStore({query=(...args)=>catalogDatabase()(...args),now=Date.now,capacityTTL=30000}={}){
  const execute=query;query=async(...args)=>{try{return await execute(...args);}catch(error){if(error.code==='22012')throw failure(507,'同步空间暂满，请先导出备份','sync_capacity');throw error;}};
  const date=()=>new Date(now()).toISOString();
  let capacityAt=0,capacityPromise;
  async function maintenance(){
    const locked=await query(`UPDATE openstream_sync.budget SET next_cleanup=$1::timestamptz+interval '5 minutes' WHERE singleton AND next_cleanup<=$1 RETURNING singleton`,[date()]);
    if(!locked.length)return;
    await query("DELETE FROM openstream_sync.requests WHERE (device_id,request_id) IN (SELECT device_id,request_id FROM openstream_sync.requests WHERE created_at<$1::timestamptz-interval '7 days' ORDER BY created_at LIMIT 200)",[date()]);
    await query("DELETE FROM openstream_sync.pairings WHERE id IN (SELECT id FROM openstream_sync.pairings WHERE expires_at<$1::timestamptz-interval '1 day' ORDER BY expires_at LIMIT 200)",[date()]);
    await query("DELETE FROM openstream_sync.devices WHERE id IN (SELECT d.id FROM openstream_sync.devices d WHERE d.approved_at IS NULL AND d.created_at<$1::timestamptz-interval '1 day' AND NOT EXISTS(SELECT 1 FROM openstream_sync.pairings p WHERE p.join_id=d.id) ORDER BY d.created_at LIMIT 200)",[date()]);
    await query("DELETE FROM openstream_sync.rate_limits WHERE key IN (SELECT key FROM openstream_sync.rate_limits WHERE window_at<$1::timestamptz-interval '1 day' ORDER BY window_at LIMIT 200)",[date()]);
  }
  async function capacity(){
    if(now()<capacityAt)return;
    if(!capacityPromise)capacityPromise=(async()=>{
      await maintenance();
      const [size]=await query(`SELECT pg_database_size(current_database())::text AS database_bytes,
        (SELECT COALESCE(sum(pg_total_relation_size(c.oid)),0)::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='openstream_sync' AND c.relkind='r') AS sync_bytes`);
      if(Number(size.database_bytes)>=350*1024*1024||Number(size.sync_bytes)>=32*1024*1024)throw failure(507,'同步存储暂满，请先导出备份；本机观看不受影响','sync_capacity');
      capacityAt=now()+capacityTTL;
    })().finally(()=>{capacityPromise=null;});
    await capacityPromise;
  }
  async function limit(identity,maximum=360){
    const [row]=await query(`INSERT INTO openstream_sync.rate_limits(key,window_at,count) VALUES($1,$2,1)
      ON CONFLICT(key) DO UPDATE SET window_at=CASE WHEN openstream_sync.rate_limits.window_at<=$2::timestamptz-interval '1 minute' THEN $2 ELSE openstream_sync.rate_limits.window_at END,
      count=CASE WHEN openstream_sync.rate_limits.window_at<=$2::timestamptz-interval '1 minute' THEN 1 ELSE openstream_sync.rate_limits.count+1 END
      WHERE openstream_sync.rate_limits.window_at<=$2::timestamptz-interval '1 minute' OR openstream_sync.rate_limits.count<$3 RETURNING count`,[hash(identity),date(),maximum]);
    if(!row)throw failure(429,'同步操作过于频繁，请稍后再试','rate_limited');
  }
  async function authenticate(token){
    if(!secret(token))throw failure(401,'此设备尚未配对','device_unauthorized');
    const [device]=await query(activeSQL,[hash(token)]);
    if(!device)throw failure(401,'此设备授权已失效，请重新配对','device_unauthorized');
    return device;
  }
  function credentials(input){
    if(!secret(input.credential)||!secret(input.recoveryCode)||!validName(input.name))throw failure(400,'设备信息无效');
  }
  async function create(input){
    credentials(input);const old=await query(activeSQL,[hash(input.credential)]);if(old.length)return {deviceId:old[0].id};
    await capacity();await limit('public-create',20);
    const [device]=await query(`WITH quota AS (UPDATE openstream_sync.budget SET space_count=space_count+1 WHERE singleton AND space_count<2000 RETURNING singleton), s AS (INSERT INTO openstream_sync.spaces(id,recovery_hash) SELECT $1,$2 FROM quota RETURNING id)
      INSERT INTO openstream_sync.devices(id,space_id,token_hash,name,slot,approved_at) SELECT $3,id,$4,$5,1,$6 FROM s RETURNING id`,[randomUUID(),hash(input.recoveryCode),randomUUID(),hash(input.credential),text(input.name.trim(),40),date()]);
    if(!device)throw failure(507,'同步空间暂满，请稍后再试','sync_capacity');
    return {deviceId:device.id};
  }
  async function status(token){
    if(!secret(token))throw failure(401,'此设备尚未配对','device_unauthorized');
    const [row]=await query(`SELECT d.id,d.approved_at,d.revoked_at,s.closed_at,p.match_code,p.expires_at,p.state
      FROM openstream_sync.devices d JOIN openstream_sync.spaces s ON s.id=d.space_id LEFT JOIN openstream_sync.pairings p ON p.join_id=d.id WHERE d.token_hash=$1`,[hash(token)]);
    if(!row||row.revoked_at||row.closed_at)throw failure(401,'此设备授权已失效','device_unauthorized');
    if(!row.approved_at&&(!row.expires_at||Date.parse(row.expires_at)<=now()||row.state==='cancelled'))throw failure(410,'配对已过期，请重新生成邀请','pair_expired');
    return {deviceId:row.id,approved:!!row.approved_at,matchCode:row.approved_at?undefined:row.match_code,expiresAt:row.approved_at?undefined:row.expires_at};
  }
  async function invite(token,input){
    const d=await authenticate(token);
    if(!uuid(input.id)||!secret(input.secret))throw failure(400,'配对邀请无效');
    const [previous]=await query("SELECT id,expires_at FROM openstream_sync.pairings WHERE id=$1 AND owner_id=$2 AND secret_hash=$3 AND state IN ('waiting','claimed','approved')",[input.id,d.id,hash(input.secret)]);if(previous)return {id:previous.id,expiresAt:previous.expires_at};
    await capacity();await limit('invite:'+d.id,60);
    await query("UPDATE openstream_sync.pairings SET state='cancelled' WHERE space_id=$1 AND state IN ('waiting','claimed') AND expires_at<=$2",[d.space_id,date()]);
    let row;
    for(let attempt=0;attempt<3&&!row;attempt++){
      [row]=await query(`INSERT INTO openstream_sync.pairings(id,space_id,owner_id,secret_hash,expires_at,slot)
        SELECT $1,$2,$3,$4,$5,n FROM generate_series(1,2) n
        WHERE EXISTS(SELECT 1 FROM openstream_sync.devices WHERE id=$3 AND revoked_at IS NULL)
        AND (SELECT count(*) FROM openstream_sync.devices WHERE space_id=$2 AND approved_at IS NOT NULL AND revoked_at IS NULL)<10
        AND NOT EXISTS(SELECT 1 FROM openstream_sync.pairings WHERE space_id=$2 AND slot=n AND state IN ('waiting','claimed'))
        ORDER BY n LIMIT 1 ON CONFLICT DO NOTHING RETURNING id,expires_at`,[input.id,d.space_id,d.id,hash(input.secret),new Date(now()+300000).toISOString()]);
    }
    if(!row)throw failure(409,'已有待用邀请或设备数量已满，请先取消邀请或移除设备');
    return {id:row.id,expiresAt:row.expires_at};
  }
  async function join(input){
    if(!uuid(input.id)||!secret(input.secret)||!secret(input.credential)||!validName(input.name))throw failure(400,'配对邀请无效');
    const [previous]=await query(`SELECT d.id FROM openstream_sync.devices d JOIN openstream_sync.pairings p ON p.join_id=d.id WHERE p.id=$1 AND p.secret_hash=$2 AND d.token_hash=$3 AND p.state IN ('claimed','approved')`,[input.id,hash(input.secret),hash(input.credential)]);
    if(previous)return status(input.credential);
    await capacity();await limit('public-join',120);
    const id=randomUUID(),match=String(Number.parseInt(hash(id).slice(0,10),16)%1000000).padStart(6,'0');
    const [row]=await query(`WITH eligible AS (
      SELECT p.id,p.space_id FROM openstream_sync.pairings p
      WHERE p.id=$1 AND p.secret_hash=$2 AND p.state='waiting' AND p.expires_at>$3
      AND EXISTS(SELECT 1 FROM openstream_sync.devices d JOIN openstream_sync.spaces s ON s.id=d.space_id WHERE d.id=p.owner_id AND d.revoked_at IS NULL AND s.closed_at IS NULL)
      FOR UPDATE OF p
    ), added AS (INSERT INTO openstream_sync.devices(id,space_id,token_hash,name) SELECT $5,space_id,$6,$7 FROM eligible RETURNING id)
      UPDATE openstream_sync.pairings SET state='claimed',join_id=(SELECT id FROM added),match_code=$4 WHERE id IN(SELECT id FROM eligible) RETURNING id`,[input.id,hash(input.secret),date(),match,id,hash(input.credential),text(input.name.trim(),40)]);
    if(!row)throw failure(410,'邀请已使用、取消或过期，请重新生成','pair_expired');
    return status(input.credential);
  }
  async function pairing(token,id){
    const d=await authenticate(token);await limit(d.id);if(!uuid(id))throw failure(400,'配对邀请无效');
    const [row]=await query(`SELECT p.id,p.state,p.match_code,p.expires_at,d.name AS device_name,p.join_id FROM openstream_sync.pairings p LEFT JOIN openstream_sync.devices d ON d.id=p.join_id WHERE p.id=$1 AND p.owner_id=$2`,[id,d.id]);
    if(!row)throw failure(404,'配对邀请不存在');
    return {id:row.id,state:Date.parse(row.expires_at)<=now()&&row.state!=='approved'?'expired':row.state,matchCode:row.match_code,deviceName:row.device_name,joinId:row.join_id,expiresAt:row.expires_at};
  }
  async function confirm(token,input){
    const d=await authenticate(token);await limit(d.id);
    if(!uuid(input.id)||!uuid(input.joinId)||!/^\d{6}$/.test(input.matchCode||''))throw failure(400,'配对确认无效');
    let row;
    for(let attempt=0;attempt<3&&!row;attempt++){
      try{[row]=await query(`WITH candidate AS MATERIALIZED (SELECT p.join_id,n AS slot FROM openstream_sync.pairings p CROSS JOIN generate_series(1,10) n
        WHERE p.id=$1 AND p.owner_id=$2 AND p.join_id=$3 AND p.match_code=$4 AND p.expires_at>$5 AND p.state='claimed'
        AND EXISTS(SELECT 1 FROM openstream_sync.devices WHERE id=$2 AND revoked_at IS NULL)
        AND NOT EXISTS(SELECT 1 FROM openstream_sync.devices d WHERE d.space_id=$6 AND d.slot=n AND d.revoked_at IS NULL)
        ORDER BY n LIMIT 1 FOR UPDATE OF p), added AS (
        UPDATE openstream_sync.devices d SET approved_at=$5,slot=c.slot FROM candidate c WHERE d.id=c.join_id AND d.revoked_at IS NULL RETURNING d.id)
        UPDATE openstream_sync.pairings SET state='approved' WHERE id=$1 AND join_id IN(SELECT id FROM added) RETURNING join_id`,[input.id,d.id,input.joinId,input.matchCode,date(),d.space_id]);}catch(error){if(error.code!=='23505')throw error;}
    }
    if(!row){const p=await pairing(token,input.id);if(p.state==='approved'&&p.joinId===input.joinId&&p.matchCode===input.matchCode)return {approved:true};throw failure(409,'配对已变化或过期，请重新生成邀请');}
    return {approved:true};
  }
  async function cancel(token,id){
    const d=await authenticate(token);await limit(d.id);if(!uuid(id))throw failure(400,'配对邀请无效');
    await query(`WITH cancelled AS (UPDATE openstream_sync.pairings SET state='cancelled' WHERE id=$1 AND owner_id=$2 AND state IN ('waiting','claimed') RETURNING join_id)
      UPDATE openstream_sync.devices SET revoked_at=$3 WHERE id IN(SELECT join_id FROM cancelled) AND approved_at IS NULL`,[id,d.id,date()]);
    return {cancelled:true};
  }
  async function devices(token){
    const d=await authenticate(token);await limit(d.id);
    const rows=await query('SELECT id,name,created_at FROM openstream_sync.devices WHERE space_id=$1 AND approved_at IS NOT NULL AND revoked_at IS NULL ORDER BY created_at,id',[d.space_id]);
    return {current:d.id,devices:rows.map(v=>({id:v.id,name:v.name,createdAt:v.created_at}))};
  }
  async function revoke(token,id){
    const d=await authenticate(token);await limit(d.id);if(!uuid(id))throw failure(400,'设备信息无效');
    await query(`WITH removed AS (UPDATE openstream_sync.devices SET revoked_at=$3 WHERE id=$1 AND space_id=$2 RETURNING id)
      UPDATE openstream_sync.pairings SET state='cancelled' WHERE owner_id IN(SELECT id FROM removed) AND state IN ('waiting','claimed')`,[id,d.space_id,date()]);
    return {revoked:true};
  }
  async function recover(input){
    credentials({...input,recoveryCode:input.newRecoveryCode});
    if(!secret(input.recoveryCode))throw failure(400,'恢复码无效');
    const prior=await query(activeSQL,[hash(input.credential)]);if(prior.length)return {deviceId:prior[0].id};
    await capacity();await limit('public-recovery',12);
    const [row]=await query(`WITH recovered AS (UPDATE openstream_sync.spaces SET recovery_hash=$2 WHERE recovery_hash=$1 AND closed_at IS NULL RETURNING id),
      revoked AS (UPDATE openstream_sync.devices SET revoked_at=$3 WHERE space_id IN(SELECT id FROM recovered) RETURNING id),
      cancelled AS (UPDATE openstream_sync.pairings SET state='cancelled' WHERE space_id IN(SELECT id FROM recovered) AND state IN ('waiting','claimed'))
      INSERT INTO openstream_sync.devices(id,space_id,token_hash,name,slot,approved_at) SELECT $4,id,$5,$6,1,$3 FROM recovered CROSS JOIN (SELECT count(*) FROM revoked) finished RETURNING id`,[hash(input.recoveryCode),hash(input.newRecoveryCode),date(),randomUUID(),hash(input.credential),text(input.name.trim(),40)]);
    if(!row)throw failure(403,'恢复码无效或已使用');return {deviceId:row.id};
  }
  async function withdraw(token){
    if(!secret(token))throw failure(401,'配对请求无效');
    await query(`WITH withdrawn AS (UPDATE openstream_sync.devices SET revoked_at=$2 WHERE token_hash=$1 AND approved_at IS NULL RETURNING id)
      UPDATE openstream_sync.pairings SET state='cancelled' WHERE join_id IN(SELECT id FROM withdrawn) AND state='claimed'`,[hash(token),date()]);
    return {withdrawn:true};
  }
  async function close(token){
    const d=await authenticate(token);await query(`WITH size AS (SELECT count(*)::int AS records,COALESCE(sum(octet_length(COALESCE(data::text,''))+512),0)::bigint AS bytes FROM openstream_sync.records WHERE space_id=$1), removed AS (DELETE FROM openstream_sync.spaces WHERE id=$1 RETURNING id) UPDATE openstream_sync.budget SET space_count=space_count-(SELECT count(*)::int FROM removed),record_count=record_count-(SELECT records FROM size),payload_bytes=GREATEST(0,payload_bytes-(SELECT bytes FROM size)) WHERE singleton`,[d.space_id]);return {closed:true};
  }
  async function pull(token){
    const d=await authenticate(token);await limit(d.id);
    const rows=await query(`SELECT bucket,key,data,deleted,version,active_session,last_sequence,updated_at FROM openstream_sync.records WHERE space_id=$1 ORDER BY bucket,key LIMIT 2001`,[d.space_id]);
    if(rows.length>2000)throw failure(507,'同步空间已满，请先导出备份');return {records:rows.map(publicRecord)};
  }
  const workSetup=`work_added AS (INSERT INTO openstream_sync.works(space_id,key,slot)
    SELECT $1,$3,n FROM generate_series(1,500) n WHERE NOT $6 AND $2<>'preferences'
    AND NOT EXISTS(SELECT 1 FROM openstream_sync.works WHERE space_id=$1 AND key=$3)
    AND NOT EXISTS(SELECT 1 FROM openstream_sync.works WHERE space_id=$1 AND slot=n) ORDER BY n LIMIT 1
    ON CONFLICT DO NOTHING RETURNING key),
    work_eligible AS (SELECT key FROM openstream_sync.works WHERE space_id=$1 AND key=$3 UNION SELECT key FROM work_added)`;
  const workCondition="($6 OR $2='preferences' OR EXISTS(SELECT 1 FROM work_eligible))";
  const workCleanup=changed=>`work_cleanup AS (DELETE FROM openstream_sync.works WHERE space_id=$1 AND key=$3 AND (
    ($6 AND EXISTS(SELECT 1 FROM ${changed}) AND NOT EXISTS(SELECT 1 FROM openstream_sync.records WHERE space_id=$1 AND key=$3 AND bucket<>$2 AND NOT deleted)) OR
    (EXISTS(SELECT 1 FROM work_added) AND NOT EXISTS(SELECT 1 FROM ${changed}) AND NOT EXISTS(SELECT 1 FROM openstream_sync.records WHERE space_id=$1 AND key=$3 AND NOT deleted))))`;
  async function write(token,input,{claim=false}={}){
    const d=await authenticate(token);await limit(d.id,360);
    if(!uuid(input.requestId)||!key(input.key)||!integer(input.baseVersion,2147483646)||!['favorite','progress','skip','preferences'].includes(input.bucket)||input.bucket==='preferences'&&input.key!=='selected')throw failure(400,'同步变更无效');
    if((claim||input.bucket==='progress'&&!input.deleted)&&(!uuid(input.sessionId)||!integer(input.sequence||0,2147483646)))throw failure(400,'观看会话无效');
    if(claim&&input.bucket!=='progress')throw failure(400,'观看会话无效');
    const value=input.deleted?null:syncRecordValue(input.bucket,input.value);
    if(value?.film&&value.film.id!==input.key)throw failure(400,'作品与记录标识不一致');
    if(!input.deleted)await capacity();
    if(Buffer.byteLength(JSON.stringify(value))>49152)throw failure(413,'单条同步内容过大');
    const requestHash=hash(JSON.stringify({bucket:input.bucket,key:input.key,baseVersion:input.baseVersion,value,deleted:!!input.deleted,claim,sessionId:input.sessionId,sequence:input.sequence||0}));
    const [receipt]=await query('SELECT request_hash,result FROM openstream_sync.requests WHERE device_id=$1 AND request_id=$2',[d.id,input.requestId]);
    if(receipt){if(receipt.request_hash!==requestHash)throw failure(409,'同一操作编号对应的内容发生变化');return receipt.result;}
    let row;
    if(input.baseVersion===0){
      for(let attempt=0;attempt<8;attempt++){
        [row]=await query(`WITH ${workSetup}, added AS (
          INSERT INTO openstream_sync.records(space_id,bucket,key,data,deleted,writer_id,request_id,request_hash,active_session,session_owner,last_sequence,updated_at,slot)
          SELECT $1,$2,$3,$4::jsonb,$6,$5,$7,$8,$9,$10,$11,$12,n FROM generate_series(1,2000) n
          WHERE EXISTS(SELECT 1 FROM openstream_sync.devices d JOIN openstream_sync.spaces s ON s.id=d.space_id WHERE d.id=$5 AND d.revoked_at IS NULL AND s.closed_at IS NULL)
          AND ${workCondition} AND NOT EXISTS(SELECT 1 FROM openstream_sync.records r WHERE r.space_id=$1 AND r.slot=n) ORDER BY n LIMIT 1
          ON CONFLICT DO NOTHING RETURNING *
        ), global_quota AS (UPDATE openstream_sync.budget SET record_count=record_count+(SELECT count(*)::int FROM added),payload_bytes=payload_bytes+(SELECT COALESCE(sum(octet_length(COALESCE(data::text,''))+512),0)::bigint FROM added) WHERE singleton AND record_count+(SELECT count(*) FROM added)<=20000 AND payload_bytes+(SELECT COALESCE(sum(octet_length(COALESCE(data::text,''))+512),0) FROM added)<=20971520 RETURNING singleton), counted AS (UPDATE openstream_sync.spaces SET slots=slots+(SELECT count(*)::int FROM added) WHERE id=$1 RETURNING id), ${workCleanup('added')}
        SELECT added.*,(SELECT 1/count(*)::int FROM global_quota) AS budget_check FROM added,counted`,[d.space_id,input.bucket,input.key,JSON.stringify(value),d.id,!!input.deleted,input.requestId,requestHash,input.bucket==='progress'?input.sessionId:null,input.bucket==='progress'?d.id:null,claim?0:input.sequence||0,date()]);
        if(row)break;
        const [existing]=await query('SELECT key FROM openstream_sync.records WHERE space_id=$1 AND bucket=$2 AND key=$3',[d.space_id,input.bucket,input.key]);
        if(existing)break;
        const [size]=await query('SELECT slots FROM openstream_sync.spaces WHERE id=$1',[d.space_id]);
        if(!size)throw failure(401,'此设备授权已失效','device_unauthorized');
        const [works]=await query('SELECT count(*)::int AS n FROM openstream_sync.works WHERE space_id=$1',[d.space_id]);
        if(!input.deleted&&input.bucket!=='preferences'&&works.n>=500)throw failure(507,'同步最多保存 500 部作品，请先移除一些记录','sync_capacity');
        if(size.slots>=2000)throw failure(507,'同步空间已满，请先导出备份');
        if(attempt===7)throw failure(503,'同步繁忙，请稍后重试');
      }
    }else{
      const sessionCondition=claim||input.bucket!=='progress'||input.deleted?'TRUE':'active_session=$9 AND session_owner=$5 AND last_sequence<$11';
      [row]=await query(`WITH ${workSetup}, prior AS (SELECT octet_length(COALESCE(data::text,''))+512 AS bytes FROM openstream_sync.records WHERE space_id=$1 AND bucket=$2 AND key=$3 FOR UPDATE), changed AS (UPDATE openstream_sync.records SET data=CASE WHEN bucket='progress' AND NOT $6 THEN jsonb_set($4::jsonb,'{progress,completedEpisodes}',(SELECT COALESCE(jsonb_agg(v),'[]'::jsonb) FROM (SELECT DISTINCT v FROM jsonb_array_elements(COALESCE(data#>'{progress,completedEpisodes}','[]'::jsonb)||COALESCE($4::jsonb#>'{progress,completedEpisodes}','[]'::jsonb)) v LIMIT 1000) merged)) ELSE $4::jsonb END,deleted=$6,version=version+1,writer_id=$5,request_id=$7,request_hash=$8,
        active_session=CASE WHEN $13 THEN $9 ELSE active_session END,session_owner=CASE WHEN $13 THEN $5 ELSE session_owner END,last_sequence=CASE WHEN $13 THEN 0 ELSE $11 END,updated_at=$12
        WHERE space_id=$1 AND bucket=$2 AND key=$3 AND version=$10 AND ${sessionCondition} AND EXISTS(SELECT 1 FROM prior) AND ${workCondition}
        AND EXISTS(SELECT 1 FROM openstream_sync.devices WHERE id=$5 AND revoked_at IS NULL) AND EXISTS(SELECT 1 FROM openstream_sync.spaces WHERE id=$1 AND closed_at IS NULL)
        RETURNING *), global_quota AS (UPDATE openstream_sync.budget SET payload_bytes=payload_bytes+(SELECT COALESCE(sum(octet_length(COALESCE(data::text,''))+512),0) FROM changed)-CASE WHEN EXISTS(SELECT 1 FROM changed) THEN (SELECT COALESCE(sum(bytes),0) FROM prior) ELSE 0 END WHERE singleton AND payload_bytes+(SELECT COALESCE(sum(octet_length(COALESCE(data::text,''))+512),0) FROM changed)-CASE WHEN EXISTS(SELECT 1 FROM changed) THEN (SELECT COALESCE(sum(bytes),0) FROM prior) ELSE 0 END<=20971520 RETURNING singleton), ${workCleanup('changed')} SELECT changed.*,(SELECT 1/count(*)::int FROM global_quota) AS budget_check FROM changed`,[d.space_id,input.bucket,input.key,JSON.stringify(value),d.id,!!input.deleted,input.requestId,requestHash,input.sessionId||null,input.baseVersion,input.sequence||0,date(),claim]);
    }
    if(!row){
      if(!input.deleted&&input.bucket!=='preferences'){const [works]=await query('SELECT count(*)::int AS n FROM openstream_sync.works WHERE space_id=$1',[d.space_id]);const [present]=await query('SELECT key FROM openstream_sync.works WHERE space_id=$1 AND key=$2',[d.space_id,input.key]);if(!present&&works.n>=500)throw failure(507,'同步最多保存 500 部作品，请先移除一些记录','sync_capacity');}
      [row]=await query('SELECT * FROM openstream_sync.records WHERE space_id=$1 AND bucket=$2 AND key=$3',[d.space_id,input.bucket,input.key]);
      if(row?.request_id!==input.requestId||row?.request_hash!==requestHash)return {conflict:true,current:row?publicRecord(row):null};
    }
    const result={record:publicRecord(row)};
    await query('INSERT INTO openstream_sync.requests(device_id,request_id,request_hash,result) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING',[d.id,input.requestId,requestHash,JSON.stringify(result)]);
    return result;
  }
  async function prune(){
    await query("DELETE FROM openstream_sync.requests WHERE created_at<now()-interval '7 days'");
    await query("DELETE FROM openstream_sync.pairings WHERE expires_at<now()-interval '1 day'");
    await query("DELETE FROM openstream_sync.rate_limits WHERE window_at<now()-interval '1 day'");
    return {pruned:true};
  }
  return {create,status,invite,join,pairing,confirm,cancel,withdraw,devices,revoke,recover,close,pull,write,claim:(token,input)=>write(token,{...input,bucket:'progress'},{claim:true}),prune};
}

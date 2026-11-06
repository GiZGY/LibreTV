import {createDeviceSyncStore} from '../../server/device-sync.mjs';
import {enforceHuman} from '../../server/human-access.mjs';
import {isRequestAuthenticated} from '../../server/auth-session.mjs';

export function createDeviceSyncHandler({env=process.env,store=createDeviceSyncStore()}={}){
  return async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    res.setHeader('Vercel-CDN-Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    const enabled=env.DEVICE_SYNC_ENABLED==='1';
    if(req.method==='GET')return res.status(200).json({enabled});
    if(req.method!=='POST'){res.setHeader('Allow','GET, POST');return res.status(405).json({message:'不支持此请求'});}
    if(!enabled)return res.status(503).json({message:'设备同步暂未开放',code:'sync_unavailable'});
    try{
      if(!req.headers?.origin||new URL(req.headers.origin).host!==req.headers.host||env.VERCEL==='1'&&new URL(req.headers.origin).protocol!=='https:'||req.headers['sec-fetch-site']==='cross-site')return res.status(403).json({message:'请求来源无效'});
    }catch{return res.status(403).json({message:'请求来源无效'});}
    if(!enforceHuman(req,res,env))return;
    if(!isRequestAuthenticated(req,env))return res.status(401).json({message:'请先验证访问权限'});
    try{
      const raw=req.body;
      if(Buffer.byteLength(typeof raw==='string'?raw:JSON.stringify(raw||null))>65536)return res.status(413).json({message:'同步内容过大'});
      const body=typeof raw==='string'?JSON.parse(raw):raw;
      if(!body||typeof body!=='object'||Array.isArray(body))return res.status(400).json({message:'同步请求无效'});
      const token=/^Bearer ([\w-]{43})$/.exec(String(req.headers.authorization||''))?.[1];
      let result;
      switch(body.action){
        case 'create':result=await store.create(body);break;
        case 'join':result=await store.join(body);break;
        case 'recover':result=await store.recover(body);break;
        case 'status':result=await store.status(token);break;
        case 'withdraw':result=await store.withdraw(token);break;
        case 'invite':result=await store.invite(token,body);break;
        case 'pairing':result=await store.pairing(token,body.id);break;
        case 'confirm':result=await store.confirm(token,body);break;
        case 'cancel':result=await store.cancel(token,body.id);break;
        case 'devices':result=await store.devices(token);break;
        case 'revoke':result=await store.revoke(token,body.id);break;
        case 'pull':result=await store.pull(token);break;
        case 'write':result=await store.write(token,body);break;
        case 'claim':result=await store.claim(token,body);break;
        case 'close':if(body.confirm!==true)return res.status(400).json({message:'请确认删除同步数据'});result=await store.close(token);break;
        default:return res.status(400).json({message:'同步操作无效'});
      }
      return res.status(200).json(result);
    }catch(error){
      const status=error.status||503;if(status===429)res.setHeader('Retry-After','60');
      return res.status(status).json({message:error.status?error.message:'同步暂时不可用，本机数据已保留',code:error.code||'sync_unavailable'});
    }
  };
}
export default createDeviceSyncHandler();

import {createCatalogService} from '../../server/tmdb-catalog.mjs';
import {isRequestAuthenticated,isPublicAccess} from '../../server/auth-session.mjs';
import {publicRequestStatus} from '../../server/public-access.mjs';
import {enforceHuman, humanConfig} from '../../server/human-access.mjs';
import {getCache} from '@vercel/functions';
import {createIndexReader} from '../../server/catalog-index.mjs';
export function createCatalogHandler(options){
const sharedCache=process.env.VERCEL==='1'?getCache({namespace:'openstream-tmdb-v2'}):null;
const discover=createCatalogService({sharedCache,...options});
const indexed=options?.indexReader||createIndexReader({sharedCache});
return async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({message:'不支持此请求'});}
  if(!enforceHuman(req,res))return;
  if(!isRequestAuthenticated(req,process.env))return res.status(401).json({message:'请先验证访问权限'});
  const publicAccess=isPublicAccess(process.env);
  if(publicAccess){const status=publicRequestStatus(req);if(status!==200)return res.status(status).json({message:'请求暂时不可用'});}
  try{
    const params=req.query||{};
    const useIndex=process.env.CATALOG_INDEX_ENABLED==='1'&&(!params.kind||['discover','browse'].includes(params.kind));
    const data=await (useIndex?indexed:discover)(params);
    if(humanConfig().enabled){res.setHeader('Cache-Control','private, max-age=300');res.setHeader('Vercel-CDN-Cache-Control','no-store');}
    if(publicAccess&&!humanConfig().enabled){res.setHeader('Cache-Control','public, max-age=300');res.setHeader('Vercel-CDN-Cache-Control','public, s-maxage=3600, stale-while-revalidate=86400');}
    return res.status(200).json(data);
  }catch(error){if(error.status===429)res.setHeader('Retry-After','60');return res.status(error.status||502).json({message:error.status?error.message:'影片目录暂时不可用'});}
};
}
export default createCatalogHandler();

// Public browsing is constrained to the configured catalogue, not arbitrary URLs.
const cmsEndpoints = new Set([
  'caiji.dyttzyapi.com/api.php/provide/vod',
  'bfzyapi.com/api.php/provide/vod',
  '360zy.com/api.php/provide/vod',
  'www.iqiyizyapi.com/api.php/provide/vod',
  'jszyapi.com/api.php/provide/vod',
  'www.mdzyapi.com/api.php/provide/vod',
  'api.zuidapi.com/api.php/provide/vod',
  'cj.lziapi.com/api.php/provide/vod',
  'api.guangsuapi.com/api.php/provide/vod/from/gsm3u8',
  'www.huyaapi.com/api.php/provide/vod/from/hym3u8/at/json',
  'www.hongniuzy2.com/api.php/provide/vod/from/hnm3u8'
]);
const requests = new Map();
export function isPublicTarget(value) {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port) return false;
    if (cmsEndpoints.has(url.hostname + url.pathname.replace(/\/$/, ''))) {
      const allowed = new Set(['ac','wd','pg','ids','year','class']);
      return [...url.searchParams.keys()].every(key => allowed.has(key)) &&
        ['detail','list','videolist'].includes(url.searchParams.get('ac'));
    }
    if (url.hostname === 'movie.douban.com') return ['/j/search_subjects','/j/new_search_subjects','/j/subject_abstract'].includes(url.pathname);
    return /^img\d*\.doubanio\.com$/.test(url.hostname) && /^\/view\/photo\//.test(url.pathname);
  } catch { return false; }
}
export function publicRequestStatus(req, env = process.env, now = Date.now()) {
  if (req.headers?.['sec-fetch-site'] === 'cross-site') return 403;
  const origin=req.headers?.origin;
  if(origin){try{if(new URL(origin).host!==req.headers?.host)return 403;}catch{return 403;}}
  // Instance-local backpressure. Production also needs a platform-wide WAF limit.
  const forwarded=env.VERCEL==='1'?String(req.headers?.['x-vercel-forwarded-for']||'').split(',')[0]:'';
  const key=forwarded||req.socket?.remoteAddress||'unknown';
  let entry=requests.get(key);
  if(!entry||now-entry.start>=60000){entry={start:now,count:0};requests.set(key,entry);}
  if(requests.size>2000)requests.delete(requests.keys().next().value);
  return ++entry.count>240?429:200;
}

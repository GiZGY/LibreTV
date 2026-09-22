import {humanConfig, humanStatus, humanCookie, verificationAllowed, verifyHuman} from '../../server/human-access.mjs';

export function createHumanHandler({env = process.env, fetchImpl = globalThis.fetch} = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const config = humanConfig(env);
    if (req.method === 'GET') return res.status(200).json({enabled:config.enabled, ready:config.ready, siteKey:config.siteKey, verified:humanStatus(req, env) === 200});
    if (req.method !== 'POST') {res.setHeader('Allow','GET, POST');return res.status(405).json({message:'不支持此请求'});}
    const origin = req.headers?.origin;
    try { if (!origin || new URL(origin).host !== req.headers?.host || req.headers?.['sec-fetch-site'] === 'cross-site') return res.status(403).json({message:'请求来源无效'}); }
    catch { return res.status(403).json({message:'请求来源无效'}); }
    if (!verificationAllowed(req, env)) {res.setHeader('Retry-After','60');return res.status(429).json({message:'验证过于频繁，请稍后再试'});}
    if (!config.enabled || !config.ready) return res.status(503).json({message:'安全验证暂不可用'});
    try {
      let body = req.body;
      if (typeof body === 'string') {if (Buffer.byteLength(body) > 4096) throw new Error();body = JSON.parse(body);}
      if (!await verifyHuman(body?.token, {env, fetchImpl})) return res.status(403).json({message:'验证未通过，请重试'});
      res.setHeader('Set-Cookie', humanCookie(req, env));
      return res.status(200).json({verified:true});
    } catch { return res.status(503).json({message:'验证服务暂不可用，请重试'}); }
  };
}
export default createHumanHandler();

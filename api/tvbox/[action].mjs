import { proxyTvboxBridgeRequest, writeBridgeJsonResponse } from '../../server/tvbox-bridge-proxy.mjs';
import {
  isPublicAccess,
  isRequestAuthenticated
} from '../../server/auth-session.mjs';
import { publicRequestStatus } from '../../server/public-access.mjs';
import { enforceHuman } from '../../server/human-access.mjs';

export default async function handler(req, res) {
  if (!enforceHuman(req, res)) return;
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ status: 'unsupported', message: 'Method not allowed' });
  }
  if (!isRequestAuthenticated(req, process.env)) {
    return res.status(401).json({ status: 'unsupported', message: 'Authentication required' });
  }
  if (isPublicAccess(process.env)) {
    const status=publicRequestStatus(req);
    if(status!==200)return res.status(status).json({status:'error',message:'Request limit or origin rejected'});
  }

  const result = await proxyTvboxBridgeRequest({
    action: req.query.action ?? req.params?.action,
    query: req.query,
    env: process.env,
    fetchImpl: globalThis.fetch
  });

  return writeBridgeJsonResponse(res, result);
}

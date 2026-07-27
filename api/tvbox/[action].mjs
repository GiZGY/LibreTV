import { proxyTvboxBridgeRequest, writeBridgeJsonResponse } from '../../server/tvbox-bridge-proxy.mjs';
import {
  isPasswordConfigured,
  isRequestAuthenticated
} from '../../server/auth-session.mjs';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ status: 'unsupported', message: 'Method not allowed' });
  }
  if (!isPasswordConfigured(process.env)) {
    return res.status(503).json({ status: 'unsupported', message: 'PASSWORD is not configured' });
  }
  if (!isRequestAuthenticated(req, process.env)) {
    return res.status(401).json({ status: 'unsupported', message: 'Authentication required' });
  }

  const result = await proxyTvboxBridgeRequest({
    action: req.query.action ?? req.params?.action,
    query: req.query,
    env: process.env,
    fetchImpl: globalThis.fetch
  });

  return writeBridgeJsonResponse(res, result);
}

import { proxyTvboxBridgeRequest } from '../../server/tvbox-bridge-proxy.mjs';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ status: 'unsupported', message: 'Method not allowed' });
  }

  const result = await proxyTvboxBridgeRequest({
    action: req.query.action,
    query: req.query,
    env: process.env,
    fetchImpl: globalThis.fetch
  });

  res.setHeader('Cache-Control', 'no-store');
  return res.status(result.httpStatus || 200).json(result.body);
}

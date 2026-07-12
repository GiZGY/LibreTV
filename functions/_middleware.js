import { sha256 } from '../js/sha256.js';

export async function onRequest(context) {
  const { request, env, next } = context;
  const response = await next();
  const contentType = response.headers.get("content-type") || "";
  
  if (contentType.includes("text/html")) {
    let html = await response.text();
    
    // 处理普通密码
    const password = env.PASSWORD || "";
    let passwordHash = "";
    if (password) {
      passwordHash = await sha256(password);
    }
    html = html.replace('window.__ENV__.PASSWORD = "{{PASSWORD}}";', 
      `window.__ENV__.PASSWORD = "${passwordHash}";`);
    html = html
      .replace(
        'window.__ENV__.TVBOX_BRIDGE_URL = "{{TVBOX_BRIDGE_URL}}";',
        `window.__ENV__.TVBOX_BRIDGE_URL = ${JSON.stringify(env.TVBOX_BRIDGE_URL || '')};`
      )
      .replace(
        'window.__ENV__.TVBOX_BRIDGE_TOKEN = "{{TVBOX_BRIDGE_TOKEN}}";',
        `window.__ENV__.TVBOX_BRIDGE_TOKEN = ${JSON.stringify(env.TVBOX_BRIDGE_TOKEN || '')};`
      );
    
    return new Response(html, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
  }
  
  return response;
}

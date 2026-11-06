import express from 'express';
import compression from 'compression';
import dotenv from 'dotenv';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import auth from '../api/auth/[action].mjs';
import proxy, {createProxyHandler} from '../api/proxy/[...path].mjs';
import {localPublicFetch} from './local-public-dns.mjs';
import tvbox from '../api/tvbox/[action].mjs';
import { createCatalogHandler } from '../api/catalog/tmdb.mjs';
import {createLocalDeviceSyncPreview} from './local-device-sync.mjs';
import { createHumanHandler } from '../api/security/human.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ui = path.resolve(root, 'web');
dotenv.config({ path: path.join(root, '.env.local') });
dotenv.config({ path: path.join(root, '.env.catalog.local') });
// Local Node fetch does not automatically honor the desktop proxy environment.
const catalogProxy = process.env.HTTPS_PROXY || process.env.https_proxy;
let catalogFetch = globalThis.fetch;
if (catalogProxy) {
  const { ProxyAgent, fetch } = await import('undici');
  const dispatcher = new ProxyAgent(catalogProxy);
  catalogFetch = (url, options) => fetch(url, { ...options, dispatcher });
}
const tmdbCatalog = createCatalogHandler({ fetchImpl: catalogFetch });
const humanHandler = createHumanHandler({ fetchImpl: catalogFetch });
const app = express();
app.disable('x-powered-by');
app.use((req,res,next)=>{
 if(!['localhost','127.0.0.1','[::1]'].includes(req.hostname))return res.sendStatus(403);
 next();
});
app.use(compression());
const localSync=await createLocalDeviceSyncPreview({dataDir:process.env.NEW_UI_SYNC_DIR});
app.all('/api/sync/device', express.json({limit:'64kb'}),localSync.handler);
app.use(express.json({ limit: '4kb' }));
if (process.env.NEW_UI_TEST_MUTED === '1' && process.env.NEW_UI_TEST_NATIVE === '1') {
  let observation = null;
  app.post('/__qa/native-status', (req, res) => {
    const input = req.body;
    observation = { status: String(input?.status || '').slice(0, 80),
      muted: input?.muted === true, volume: Number(input?.volume),
      duration: Number(input?.duration), position: Number(input?.position) };
    res.sendStatus(204);
  });
  app.get('/__qa/native-status', (_req, res) => res.set('Cache-Control', 'no-store').json(observation));
}
app.use((_req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'SAMEORIGIN', 'Cache-Control': 'no-store' });
  next();
});
app.all('/api/auth/:action', auth);
app.all('/proxy/:encodedUrl', process.env.NEW_UI_PUBLIC_DNS==='1'?createProxyHandler({fetchImpl:localPublicFetch(catalogFetch)}):proxy);
app.get('/api/tvbox/:action', tvbox);
app.get('/api/catalog/tmdb', tmdbCatalog);
app.all('/api/security/human', humanHandler);
// Review the actual build with the same API routes, never the static demo or repository root.
if(process.env.NEW_UI_BUILT==='1'){
 const dist=path.join(root,'public');
 await readFile(path.join(dist,'index.html'));
 app.get(['/', '/index.html'],async(_req,res,next)=>{try{
  let html=await readFile(path.join(dist,'index.html'),'utf8');
  if(process.env.NEW_UI_TEST_MUTED==='1')html=html.replace('<head>','<head><script>try{if(localStorage.getItem("openstream_live_muted")===null)localStorage.setItem("openstream_live_muted","true")}catch{}</script>');
  res.type('html').send(html);
 }catch(error){next(error);}});
 app.use(express.static(dist,{dotfiles:'deny',index:false}));
 app.use((_req,res)=>res.sendStatus(404));
}
const core = ['config.js', 'proxy-auth.js', 'source-catalog.js', 'search.js', 'source-health.js', 'source-adapter.js', 'result-aggregator.js', 'streaming-search.js', 'ad-rules.js', 'ad-guard.js', 'native-ad-timelines.js', 'native-ad-evidence.js', 'native-ad-guard.js', 'native-ad-verifier.js', 'native-ad-transport.js', 'native-ad-session.js'];
for (const file of core) app.get('/core/' + file, (_req, res) => res.sendFile(path.join(root, 'js', file)));
app.get('/libs/hls.min.js', (_req, res) => res.sendFile(path.join(root, 'libs/hls.min.js')));
app.get(['/', '/index.html'], async (_req, res) => {
  const scripts = ['core/config.js', 'live-mode.js', 'human-access.js', ...core.slice(1).map(file => 'core/' + file), 'app.js', 'local-data.js', 'library-tools.js', 'watchlist.js', 'backup-ui.js', 'film-metadata.js', 'live-data.js', 'episode-identity.js', 'playback-session.js', 'live-ui.js', 'device-sync.js', 'player-tools.js', 'player-preview.js'];
  let html = await readFile(path.join(ui, 'index.html'), 'utf8');
  html = html.replace(/<script defer src="(?:app|player-preview|playback-session)\.js"><\/script>/g, '');
  html=html.replace('</head>','<link rel="stylesheet" href="library-tools.css"><link rel="stylesheet" href="player-tools.css"><link rel="stylesheet" href="device-sync.css"></head>');
  res.type('html').send(html.replace('</head>', scripts.map(src => `<script defer src="${src}"></script>`).join('') + '</head>'));
});
// Explicit public directories: never expose environment files or repository files.
for (const file of ['styles.css', 'library-tools.css', 'player-tools.css', 'device-sync.css', 'app.js', 'local-data.js', 'library-tools.js', 'watchlist.js', 'backup-ui.js', 'playback-session.js', 'live-mode.js', 'human-access.js', 'film-metadata.js', 'live-data.js', 'episode-identity.js', 'live-ui.js', 'device-sync.js', 'player-tools.js', 'player-preview.js']) {
  app.get('/' + file, async (_req, res, next) => {
    if (file !== 'player-preview.js' || process.env.NEW_UI_TEST_MUTED !== '1') {
      return res.sendFile(path.join(ui, file));
    }
    try {
      let source = await readFile(path.join(ui, file), 'utf8');
      if (process.env.NEW_UI_TEST_NATIVE === '1') {
        const capability = 'if(window.Hls?.isSupported())';
        if (!source.includes(capability)) throw new Error('Native test capability marker changed');
        source = source.replace(capability, 'if(false)');
        const attach = 'guard=window.OpenStreamNativeAdSession?.attach({video,host:next,url});';
        if (!source.includes(attach)) throw new Error('Native session test marker changed');
        source = source.replace(attach, attach + "guard?.ready.then(()=>fetch('/__qa/native-status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:guard?.getStatus().status,muted:video.muted,volume:video.volume,duration:video.duration,position:video.currentTime})})).catch(()=>{});");
      }
      const marker = "volume:previousSound?.volume??load('volume',.8),muted:previousSound?.muted??load('muted',false),setting:true";
      const beforeSource = 'customType:{m3u8(video,url){';
      const afterConstructor = 'const instance=art;';
      if (![marker,beforeSource,afterConstructor].every(value=>source.includes(value))) throw new Error('Silent test player configuration changed');
      // Local QA only: every replacement player starts silent, including auto-fallback.
      res.type('js').send(source.replace(marker, 'volume:0,muted:true,setting:true')
        .replace(beforeSource,beforeSource+'video.muted=true;video.defaultMuted=true;video.volume=0;')
        .replace(afterConstructor,afterConstructor+'instance.video.muted=true;instance.video.defaultMuted=true;instance.video.volume=0;'));
    } catch (error) { next(error); }
  });
}
app.use('/assets', express.static(path.join(ui, 'assets'), { dotfiles: 'deny' }));
app.use('/libs', express.static(path.join(ui, 'libs'), { dotfiles: 'deny' }));
app.use((_req, res) => res.status(404).send('Not found'));
app.use((error, _req, res, _next) => res.status(error.type === 'entity.too.large' ? 413 : 500).json({ error: 'Request failed' }));
const port = Number(process.env.NEW_UI_PORT || 18441);
const server=app.listen(port,'127.0.0.1',()=>console.log(`OpenStream local integration: http://127.0.0.1:${port}`));
server.once('error',async error=>{await localSync.close();console.error(error.code||'Listen failed');process.exitCode=1;});
let stopping=false;
function stop(){if(stopping)return;stopping=true;server.close(async()=>{await localSync.close();process.exit(0);});}
process.once('SIGTERM',stop);process.once('SIGINT',stop);

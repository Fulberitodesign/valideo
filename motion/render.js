// Rendu du film Validéo : pilote Edge en mode headless via le protocole DevTools,
// capture chaque image à 120 i/s, puis ffmpeg fusionne 2 images -> 60 i/s (flou de mouvement).
// Usage : node render.js <dossier_images> [fps] [début] [fin] [port]  (plusieurs instances en parallèle)
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = process.argv[2], FPS = +(process.argv[3] || 120), START = +(process.argv[4] || 0), PORT = +(process.argv[6] || 9333);
const PAGE = 'file:///' + path.resolve(__dirname, 'valideo-motion.html').replace(/\\/g, '/');
fs.mkdirSync(OUT, { recursive: true });
const prof = path.join(OUT, '..', 'edge-profile-' + PORT);
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, '--window-size=1920,1080', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  let target;
  for (let i = 0; i < 60 && !target; i++) { try { const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); target = list.find(x => x.type === 'page'); } catch (e) {} if (!target) await sleep(500); }
  if (!target) throw new Error('Edge ne répond pas');
  const ws = new WebSocket(target.webSocketDebuggerUrl); let id = 0; const pending = {};
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pending[d.id]) { pending[d.id](d); delete pending[d.id]; } };
  await new Promise(r => ws.onopen = r);
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending[i] = d => d.error ? rej(new Error(method + ': ' + d.error.message)) : res(d.result); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: PAGE });
  for (let i = 0; i < 120; i++) { const r = await send('Runtime.evaluate', { expression: 'window.__ready === true', returnByValue: true }); if (r.result.value) break; await sleep(250); }
  await sleep(800);
  const dur = (await send('Runtime.evaluate', { expression: 'window.DURATION', returnByValue: true })).result.value;
  const total = Math.round(dur * FPS), END = Math.min(total, +(process.argv[5] || total)), t0 = Date.now();
  for (let f = START; f < END; f++) {
    await send('Runtime.evaluate', { expression: `seek(${(f / FPS).toFixed(5)})` });
    const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 94, captureBeyondViewport: false });
    fs.writeFileSync(path.join(OUT, `f${String(f).padStart(5, '0')}.jpg`), Buffer.from(data, 'base64'));
    if (f % 120 === 0) console.log(`[${PORT}] ${f}/${END} images · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  console.log(`[${PORT}] terminé : ${END - START} images en ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  ws.close(); edge.kill(); process.exit(0);
})().catch(e => { console.error(e); edge.kill(); process.exit(1); });

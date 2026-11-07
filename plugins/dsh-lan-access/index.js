import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import httpProxy from 'http-proxy';
import { ensureCertificate } from './certificate.js';

export const inject = ['connection', 'webServer'];

export async function apply(ctx, config) {
  const httpsConfig = JSON.parse(await readFile(new URL('./https-config.json', import.meta.url), 'utf8'));
  const tls = await ensureCertificate(httpsConfig);
  const securePort = config.securePort ?? 3443;
  const secureOrigin = `https://${httpsConfig.domain}:${securePort}`;
  const target = `http://127.0.0.1:${ctx.webServer.port}`;
  const login = await fetch(ctx.connection.authenticatedUrl(`${target}/`), { redirect: 'manual' });
  if (login.status !== 303) throw new Error(`DSH 登录失败：HTTP ${login.status}`);
  const cookies = login.headers.getSetCookie();
  if (cookies.length !== 1) throw new Error('DSH 未提供登录凭据');
  const cookie = cookies[0].split(';', 1)[0];
  const proxy = httpProxy.createProxyServer({
    target, ws: true, changeOrigin: true,
    headers: { cookie, origin: target },
  });
  proxy.on('error', (error, _request, response) => {
    if ('writeHead' in response) {
      if (!response.headersSent) response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(`DSH 连接失败：${error.message}`);
    } else response.destroy(error);
  });
  const forward = (request, response) => {
    request.headers.cookie = cookie;
    request.headers.origin = target;
    request.headers['sec-fetch-site'] = 'same-origin';
    proxy.web(request, response);
  };
  const secureServer = createHttpsServer(tls, forward);
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://dsh.local');
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      response.writeHead(302, { location: `${secureOrigin}${url.pathname}${url.search}`, 'cache-control': 'no-store' });
      response.end();
    } else forward(request, response);
  });
  const upgrade = (request, socket, head) => {
    request.headers.cookie = cookie;
    request.headers.origin = target;
    request.headers['sec-fetch-site'] = 'same-origin';
    proxy.ws(request, socket, head);
  };
  server.on('upgrade', upgrade);
  secureServer.on('upgrade', upgrade);
  const sockets = new Set();
  const track = socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  };
  server.on('connection', track);
  secureServer.on('connection', track);
  const listen = (listener, port) => new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(port, config.host, () => { listener.removeListener('error', reject); resolve(); });
  });
  await listen(secureServer, securePort);
  await listen(server, config.port);
  let renewing = false;
  const renewal = setInterval(async () => {
    if (renewing) return;
    renewing = true;
    try { secureServer.setSecureContext(await ensureCertificate(httpsConfig)); }
    catch (error) { console.error('DSH HTTPS 证书续期失败', error); }
    finally { renewing = false; }
  }, 86400000);
  renewal.unref();
  return async () => {
    clearInterval(renewal);
    for (const socket of sockets) socket.destroy();
    proxy.close();
    await Promise.all([server, secureServer].map(listener => new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()))));
  };
}

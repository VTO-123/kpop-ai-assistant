/**
 * 图片同源代理。
 *
 * 为什么需要：
 *   1. WebGL 纹理必须同源（或带 CORS），B 站/网易云在浏览器直连时偶发 412 / 限流；
 *   2. 统一走自己的域名，后续加缓存、防盗链、换图源都只改这一处。
 *
 * 安全：只允许白名单域名 + https，限制大小与超时，避免变成任意 URL 的开放代理。
 */
const ALLOWED_HOSTS = ['hdslb.com', 'music.126.net'];
const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 8000;
const TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 80;

const cache = new Map(); // url -> { body, type, at }

function allowed(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  const ok = ALLOWED_HOSTS.some((allowedHost) => host === allowedHost || host.endsWith(`.${allowedHost}`));
  return ok ? url : null;
}

export function isAllowedImageUrl(rawUrl) {
  return Boolean(allowed(rawUrl));
}

export async function proxyImage(req, res, rawUrl) {
  const url = allowed(rawUrl);
  if (!url) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('forbidden image host');
  }

  const key = url.toString();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return send(req, res, hit.body, hit.type, 'HIT');
  }

  let upstream;
  try {
    upstream = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        Referer: url.hostname.endsWith('hdslb.com') ? 'https://www.bilibili.com/' : 'https://music.163.com/',
        Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    res.writeHead(504, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('image upstream timeout');
  }

  if (!upstream.ok) {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(`image upstream ${upstream.status}`);
  }

  const type = upstream.headers.get('content-type') || 'application/octet-stream';
  if (!type.startsWith('image/')) {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('not an image');
  }

  const length = Number(upstream.headers.get('content-length') || 0);
  if (length > MAX_BYTES) {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('image too large');
  }

  const body = Buffer.from(await upstream.arrayBuffer());
  if (body.length > MAX_BYTES) {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('image too large');
  }

  remember(key, body, type);
  return send(req, res, body, type, 'MISS');
}

function remember(key, body, type) {
  cache.set(key, { body, type, at: Date.now() });
  if (cache.size <= MAX_ENTRIES) return;

  const now = Date.now();
  for (const [entryKey, entry] of cache) {
    if (now - entry.at >= TTL_MS || cache.size > MAX_ENTRIES) cache.delete(entryKey);
    if (cache.size <= MAX_ENTRIES) break;
  }
}

function send(req, res, body, type, cacheState) {
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': body.length,
    'Cache-Control': 'public, max-age=86400',
    'Access-Control-Allow-Origin': '*',
    'X-Cache': cacheState,
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

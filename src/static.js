import { readFile } from 'node:fs/promises';
import path from 'node:path';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

export function sendJson(res, status, data) {
  if (res.writableEnded) return;
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

/**
 * 只暴露 public/ 目录，且做路径穿越校验。
 * 无扩展名的路径回退到 index.html（单页应用友好）。
 */
export async function serveStatic(req, res, pathname, config) {
  let relative = pathname === '/' ? '/index.html' : pathname;
  if (relative.endsWith('/')) relative += 'index.html';

  const filePath = path.resolve(config.publicDir, '.' + relative);
  if (filePath !== config.publicDir && !filePath.startsWith(config.publicDir + path.sep)) {
    return sendJson(res, 403, { error: '禁止访问' });
  }

  let data;
  try {
    data = await readFile(filePath);
  } catch {
    if (!path.extname(filePath)) {
      try {
        data = await readFile(path.join(config.publicDir, 'index.html'));
        return respond(res, req, data, '.html');
      } catch {
        /* fallthrough */
      }
    }
    return sendJson(res, 404, { error: '资源不存在' });
  }

  return respond(res, req, data, path.extname(filePath).toLowerCase());
}

function respond(res, req, data, ext) {
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    'Content-Length': data.length,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(req.method === 'HEAD' ? undefined : data);
}

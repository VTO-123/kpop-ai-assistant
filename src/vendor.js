/**
 * 把 node_modules 里的 ESM 包暴露给浏览器（目前只有 ogl）。
 * 浏览器原生 import 需要真实路径，所以把 /vendor/ogl/<file> 映射到 node_modules/ogl/src/<file>。
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT_DIR } from './config.js';

const OGL_DIR = path.join(ROOT_DIR, 'node_modules', 'ogl', 'src');

export async function serveOgl(req, res, pathname) {
  const relative = pathname.replace(/^\/vendor\/ogl\/?/, '') || 'index.js';
  const file = path.resolve(OGL_DIR, relative);

  if (file !== OGL_DIR && !file.startsWith(OGL_DIR + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('forbidden');
  }

  const data = await readFile(file).catch(() => null);
  if (!data) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('ogl is not installed: run `npm install`');
  }

  res.writeHead(200, {
    'Content-Type': 'text/javascript; charset=utf-8',
    'Content-Length': data.length,
    'Cache-Control': 'public, max-age=3600',
  });
  return res.end(req.method === 'HEAD' ? undefined : data);
}

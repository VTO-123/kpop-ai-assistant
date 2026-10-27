import http from 'node:http';
import { renderArtistPage } from './src/artist-page.js';
import { resolveArtistProfile } from './src/artist-profile.js';
import { authenticate, login, register } from './src/auth.js';
import { resolveBilibiliTarget } from './src/bilibili.js';
import { config } from './src/config.js';
import { handleChat } from './src/chat.js';
import { resolveCover } from './src/cover.js';
import { buildDefaultPool } from './src/images.js';
import { proxyImage } from './src/image-proxy.js';
import { listGroups, listMembers } from './src/groups.js';
import { sanitizeGroup } from './src/prompt.js';
import { renderSongPage } from './src/song-page.js';
import { listFeaturedSongs, songLinkMap, toCarouselItem } from './src/songs.js';
import { sendJson, serveStatic } from './src/static.js';
import {
  addFavorite,
  clearSearches,
  getUserData,
  pushRecent,
  pushSearch,
  removeFavorite,
} from './src/userstore.js';
import { serveOgl } from './src/vendor.js';

const AUTH_MAX_BODY_BYTES = 4 * 1024;

function readAuthBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > AUTH_MAX_BODY_BYTES) {
        reject(Object.assign(new Error('payload too large'), { code: 'TOO_LARGE' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(Object.assign(new Error('invalid json'), { code: 'BAD_JSON' }));
      }
    });
    req.on('error', reject);
  });
}

function authUser(req, res) {
  const user = authenticate(req);
  if (!user) {
    sendJson(res, 401, { error: '请先登录' });
    return null;
  }
  return user;
}

const server = http.createServer(async (req, res) => {
  let pathname = '/';
  let searchParams = new URLSearchParams();
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    pathname = decodeURIComponent(url.pathname);
    searchParams = url.searchParams;
  } catch {
    return sendJson(res, 400, { error: '非法请求地址' });
  }

  try {
    if (pathname === '/api/config') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return sendJson(res, 405, { error: '只支持 GET' });
      }
      return sendJson(res, 200, {
        demo: config.demo,
        model: config.demo ? 'demo' : config.model,
        provider: config.providerLabel,
      });
    }

    if (pathname === '/api/chat') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: '只支持 POST' });
      return await handleChat(req, res);
    }

    // —— 账号体系：每个用户独立收藏 / 最近看过 / 搜索历史 ——
    if (pathname === '/api/register') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: '只支持 POST' });
      const body = await readAuthBody(req).catch(() => ({}));
      const result = register(body.username, body.password);
      if (!result.ok) return sendJson(res, 400, { error: result.message });
      return sendJson(res, 200, { token: result.token, username: result.username });
    }

    if (pathname === '/api/login') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: '只支持 POST' });
      const body = await readAuthBody(req).catch(() => ({}));
      const result = login(body.username, body.password);
      if (!result.ok) return sendJson(res, 401, { error: result.message });
      return sendJson(res, 200, { token: result.token, username: result.username });
    }

    if (pathname === '/api/me') {
      const user = authUser(req, res);
      if (!user) return;
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return sendJson(res, 405, { error: '只支持 GET' });
      }
      return sendJson(res, 200, { username: user, ...getUserData(user) });
    }

    if (pathname === '/api/me/favorites') {
      const user = authUser(req, res);
      if (!user) return;
      if (req.method === 'GET' || req.method === 'HEAD') {
        return sendJson(res, 200, { favorites: getUserData(user).favorites });
      }
      if (req.method === 'POST') {
        const body = await readAuthBody(req).catch(() => ({}));
        const favorites = addFavorite(user, body);
        return sendJson(res, 200, { favorites });
      }
      if (req.method === 'DELETE') {
        const name = sanitizeGroup(searchParams.get('name'));
        if (!name) return sendJson(res, 400, { error: '缺少歌手名称' });
        return sendJson(res, 200, { favorites: removeFavorite(user, name) });
      }
      return sendJson(res, 405, { error: '不支持的请求方式' });
    }

    if (pathname === '/api/me/recent') {
      const user = authUser(req, res);
      if (!user) return;
      if (req.method !== 'POST') return sendJson(res, 405, { error: '只支持 POST' });
      const body = await readAuthBody(req).catch(() => ({}));
      return sendJson(res, 200, { recent: pushRecent(user, body.name) });
    }

    if (pathname === '/api/me/searches') {
      const user = authUser(req, res);
      if (!user) return;
      if (req.method === 'DELETE') {
        return sendJson(res, 200, { searches: clearSearches(user) });
      }
      if (req.method !== 'POST') return sendJson(res, 405, { error: '只支持 POST' });
      const body = await readAuthBody(req).catch(() => ({}));
      return sendJson(res, 200, { searches: pushSearch(user, body.keyword) });
    }

    // 歌曲链接解析：bvid 直链 → B 站搜索接口 → 搜索页
    if (pathname === '/api/bilibili') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return sendJson(res, 405, { error: '只支持 GET' });
      }
      const artist = sanitizeGroup(searchParams.get('artist'));
      const title = String(searchParams.get('title') || '')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);
      const bvid = String(searchParams.get('bvid') || '').trim().slice(0, 24);
      if (!artist && !title && !bvid) return sendJson(res, 400, { error: '缺少歌曲信息' });

      const target = await resolveBilibiliTarget({ artist, title, bvid });
      return sendJson(res, 200, target);
    }

    // 档案页「资料」面板：出道年 / 公司 / 成员 / 代表作 / 奖项 + 来源
    if (pathname === '/api/artist-profile') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return sendJson(res, 405, { error: '只支持 GET' });
      }
      const name = sanitizeGroup(searchParams.get('name'));
      if (!name) return sendJson(res, 400, { error: '缺少歌手名称' });

      const profile = await resolveArtistProfile(name);
      return sendJson(res, 200, profile);
    }

    // 封面兜底：内置没有 cover 时，按团体名自动取一张（带缓存）
    if (pathname === '/api/cover') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return sendJson(res, 405, { error: '只支持 GET' });
      }
      const name = sanitizeGroup(searchParams.get('name'));
      if (!name) return sendJson(res, 400, { error: '缺少团体名称' });

      const cover = await resolveCover(name);
      return sendJson(res, 200, { name, ...cover });
    }

    // 图片同源代理：WebGL 纹理要求同源，顺便绕开图源限流
    if (pathname === '/api/img') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return sendJson(res, 405, { error: '只支持 GET' });
      }
      const target = searchParams.get('u');
      if (!target) return sendJson(res, 400, { error: '缺少图片地址' });
      return await proxyImage(req, res, target);
    }

    // 详情页轮播图：热门团体照片池
    if (pathname === '/api/images') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return sendJson(res, 405, { error: '只支持 GET' });
      }
      const items = buildDefaultPool(12);
      return sendJson(res, 200, { total: items.length, items });
    }

    // 首页「热门视频」数据
    if (pathname === '/api/songs') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return sendJson(res, 405, { error: '只支持 GET' });
      }
      const songs = listFeaturedSongs();
      return sendJson(res, 200, { total: songs.length, items: songs.map(toCarouselItem) });
    }

    // 搜索联想：首页输入框用的歌手索引
    if (pathname === '/api/artists') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return sendJson(res, 405, { error: '只支持 GET' });
      }
      const artists = listGroups().map((group) => ({
        key: group.key,
        name: group.name,
        nameZh: group.nameZh || '',
        type: group.type || 'group',
        aliases: group.aliases || [],
      }));
      return sendJson(res, 200, { total: artists.length, artists });
    }

    // 成员名单映射：档案页把成员名变成 /artist/{成员名} 链接
    if (pathname === '/api/members') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return sendJson(res, 405, { error: '只支持 GET' });
      }
      const members = listMembers();
      return sendJson(res, 200, { total: members.length, members });
    }

    // 歌手档案页「十首必听」的 B 站链接映射
    if (pathname === '/api/song-links') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return sendJson(res, 405, { error: '只支持 GET' });
      }
      const links = songLinkMap();
      return sendJson(res, 200, { total: Object.keys(links).length, links });
    }

    // 歌曲详情页 /song/[id]
    if (pathname === '/song' || pathname === '/song/') {
      res.writeHead(302, { Location: '/' });
      return res.end();
    }

    if (pathname.startsWith('/song/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return sendJson(res, 405, { error: '只支持 GET' });
      }

      const songId = pathname.slice('/song/'.length).trim();
      if (!songId || songId.length > 80 || /[\\/]/.test(songId)) {
        res.writeHead(302, { Location: '/' });
        return res.end();
      }

      const page = await renderSongPage(songId);
      if (!page) {
        res.writeHead(302, { Location: '/' });
        return res.end();
      }

      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': Buffer.byteLength(page.html),
        'Cache-Control': 'no-store',
      });
      return res.end(req.method === 'HEAD' ? undefined : page.html);
    }

    // 浏览器端 ESM 依赖（ogl）
    if (pathname.startsWith('/vendor/ogl')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return sendJson(res, 405, { error: '只支持 GET' });
      }
      return await serveOgl(req, res, pathname);
    }

    // 详情页 /artist/[name]：服务端注入标题与封面，正文由前端流式获取
    if (pathname === '/artist' || pathname === '/artist/') {
      res.writeHead(302, { Location: '/' });
      return res.end();
    }

    if (pathname.startsWith('/artist/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return sendJson(res, 405, { error: '只支持 GET' });
      }

      const rawName = pathname.slice('/artist/'.length).trim();
      if (!rawName || rawName.length > 40 || /[\\/]/.test(rawName)) {
        res.writeHead(302, { Location: '/' });
        return res.end();
      }

      const { html } = renderArtistPage(rawName);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': Buffer.byteLength(html),
        'Cache-Control': 'no-store',
      });
      return res.end(req.method === 'HEAD' ? undefined : html);
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      return await serveStatic(req, res, pathname, config);
    }

    return sendJson(res, 405, { error: 'Method Not Allowed' });
  } catch (err) {
    console.error('[server]', err);
    if (!res.headersSent) return sendJson(res, 500, { error: '服务器开小差了，请稍后重试' });
    if (!res.writableEnded) res.end();
  }
});

server.requestTimeout = 120000;
server.headersTimeout = 65000;

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  端口 ${config.port} 已被占用。换一个端口：PORT=4322 npm start\n`);
  } else {
    console.error('[server]', err);
  }
  process.exit(1);
});

server.listen(config.port, config.host, () => {
  const url = `http://${config.host}:${config.port}`;
  console.log('');
  console.log('  ✦ K-POP 档案室');
  console.log(`  ${url}`);
  console.log(
    config.demo
      ? '  模式：DEMO（未检测到 AI_API_KEY，使用内置演示数据）'
      : `  模式：LIVE · ${config.model} @ ${config.providerLabel}`,
  );
  console.log('');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log('\n  正在关闭服务…');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}

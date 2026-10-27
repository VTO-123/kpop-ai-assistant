import { config } from './config.js';
import { fetchBaikeProfile } from './baike.js';
import { resolveArtistProfile } from './artist-profile.js';
import { streamDemo } from './demo.js';
import { buildProfileArchive } from './profile.js';
import { fetchArtistProfile, profileToContext } from './netease.js';
import { buildMessages, sanitizeGroup } from './prompt.js';
import { fetchQQArtist, qqToContext } from './qqmusic.js';
import { resolveSource } from './sources.js';
import { sendJson } from './static.js';

const MAX_BODY_BYTES = 8 * 1024;

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
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

function friendlyError(err) {
  const message = String(err?.message || '');
  if (/abort/i.test(err?.name || '')) return '请求已取消';
  if (/timeout|timed out|ETIMEDOUT/i.test(message)) return '资料服务响应超时，请稍后重试';
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|getaddrinfo/i.test(message)) {
    return '资料服务暂时不可用，请稍后重试';
  }
  if (/401|invalid.*key|unauthorized/i.test(message)) return '资料服务配置无效，请联系管理员';
  if (/429|rate limit/i.test(message)) return '请求太频繁，已被接口限流，请稍后再试';
  return message.slice(0, 200) || '生成失败，请重试';
}

/** 把实时抓到的资料（百科/网易云/QQ）转成给模型看的上下文，字段全带上。 */
function liveToContext(p) {
  if (!p) return '';
  const parts = [];
  const factsLines = (Array.isArray(p.facts) ? p.facts : [])
    .map((fact) => `${String(fact.label || '').trim()}：${String(fact.value || '').trim()}`)
    .filter(Boolean);
  if (p.bio) factsLines.push(`简介：${String(p.bio).trim()}`);
  if (factsLines.length) parts.push(`【百度百科资料】\n${factsLines.join('\n')}`);
  if (Array.isArray(p.songs) && p.songs.length) {
    parts.push(`【网易云音乐资料】\n热门歌曲：${p.songs.join('、')}`);
  }
  return parts.join('\n\n');
}

/**
 * POST /api/chat
 * body: { group: string }
 * 响应：text/event-stream，事件为 `data: {"type": "...", ...}`
 *   meta  -> { model, demo, source: 'builtin' | 'ai' }
 *   delta -> { text }
 *   done  -> {}
 *   error -> { message }
 */
export async function handleChat(req, res) {
  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (err) {
    const message = err.code === 'TOO_LARGE' ? '请求体太大' : '请求格式不正确';
    return sendJson(res, 400, { error: message });
  }

  const group = sanitizeGroup(payload?.group);
  if (!group) {
    return sendJson(res, 400, { error: '请输入想了解的团体名称（1–40 个字符）' });
  }

  // 来源判定：内置命中就用内置，其余交给 AI 实时生成
  const { source, entry, profile: libProfile } = resolveSource(group);

  const controller = new AbortController();
  const abortUpstream = () => controller.abort();
  res.on('close', abortUpstream);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  let closed = false;
  const send = (event) => {
    if (closed || res.writableEnded) return;
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  // 心跳：防止反向代理/浏览器把「正在思考」的空闲连接掐掉
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, 15000);

  const finish = () => {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  };

  try {
    // 不在歌手库里的名字：先实时查百科 / 网易云，抓得到就按资料出档案，
    // 抓不到才交给模型（DEMO 模式下直接说明无法生成，绝不编造）。
    let live = null;
    if (source === 'ai') {
      live = await resolveArtistProfile(group).catch(() => null);
    }
    const liveReady = Boolean(live?.hasData);
    const effectiveSource = source === 'ai' ? (liveReady ? 'builtin' : 'ai') : 'builtin';
    const effectiveKind = source === 'ai' ? (liveReady ? 'live' : 'ai') : source;

    send({
      type: 'meta',
      model: config.demo ? 'demo' : config.model,
      demo: config.demo,
      source: effectiveSource,
      kind: effectiveKind,
      sources: source === 'ai' ? live?.sources || [] : entry?.sources || [],
    });

    if (source === 'builtin') {
      // 内置精选：直接用人工核对过的档案
      await streamDemo({ text: entry.text, send, signal: controller.signal });
    } else if (source === 'profile') {
      // 歌手库资料：资料齐全直接拼档案（快且真实）；
      // 关键字段缺太多（如出道/公司/简介/成员都不全）时交给模型按完整模板写，
      // 模型只基于抓到的真实资料写，不编造；DEMO 模式退回拼档案。
      const p = libProfile || entry.profile || {};
      const rich = Boolean(p.debut || p.agency || p.bio || (p.members?.length || 0) >= 2);
      send({ type: 'context', grounded: true, profileName: p.name || group, sources: entry.sources });
      if (config.demo || rich) {
        await streamDemo({ text: entry.text, send, signal: controller.signal });
      } else {
        await streamUpstream({
          group,
          send,
          signal: controller.signal,
          profileContext: liveToContext(p),
        });
      }
    } else if (liveReady) {
      // 实时抓到的百科 / 网易云资料：交给模型按完整档案模板写（内容更丰富），
      // 模型只基于抓到的真实资料写，不编造；没配 Key 时退回拼档案兜底。
      send({ type: 'context', grounded: true, profileName: live.name || group, sources: live.sources });
      if (config.demo) {
        await streamDemo({ text: buildProfileArchive(live), send, signal: controller.signal });
      } else {
        await streamUpstream({
          group,
          send,
          signal: controller.signal,
          profileContext: liveToContext(live),
        });
      }
    } else if (config.demo) {
      // 没配 Key 又没有任何公开资料：明确告知，绝不编造假档案
      throw Object.assign(
        new Error(`「${group}」的档案暂时无法生成，请稍后再试。`),
        { expected: true },
      );
    } else {
      // 先抓网易云 + QQ 音乐 + 百度百科的真实资料，合并后作为上下文
      let context = '';
      let profileName = '';
      const sources = [];
      if (config.profileLookup || config.baikeLookup) {
        const [netease, qq, baike] = await Promise.allSettled([
          config.profileLookup ? fetchArtistProfile(group) : Promise.resolve(null),
          config.profileLookup ? fetchQQArtist(group) : Promise.resolve(null),
          config.baikeLookup ? fetchBaikeProfile(group) : Promise.resolve(null),
        ]);
        const ne = netease.status === 'fulfilled' ? netease.value : null;
        const qqProfile = qq.status === 'fulfilled' ? qq.value : null;
        const bk = baike.status === 'fulfilled' ? baike.value : null;

        const parts = [];
        if (bk) {
          const fields = Object.entries(bk.fields || {})
            .map(([label, value]) => `${label}：${value}`)
            .join('\n');
          parts.push(`【百度百科资料】\n名称：${bk.title}\n词条定性：${bk.desc}\n${fields}\n简介：${bk.abstract}`);
          sources.push('baike');
        }
        if (ne) {
          parts.push(`【网易云音乐资料】\n${profileToContext(ne)}`);
          sources.push('netease');
        }
        if (qqProfile) {
          parts.push(`【QQ 音乐资料】\n${qqToContext(qqProfile)}`);
          sources.push('qqmusic');
        }
        context = parts.join('\n\n');
        profileName = ne?.name || qqProfile?.name || bk?.title || '';
      }

      send({ type: 'context', grounded: Boolean(context), profileName, sources });
      await streamUpstream({
        group,
        send,
        signal: controller.signal,
        profileContext: context,
      });
    }

    send({ type: 'done' });
    closed = true;
    finish();
  } catch (err) {
    if (err?.name === 'AbortError') {
      closed = true;
      finish();
      return;
    }
    if (!err?.expected) console.error('[chat]', err);
    send({ type: 'error', message: friendlyError(err) });
    closed = true;
    finish();
  } finally {
    clearInterval(heartbeat);
    res.off('close', abortUpstream);
  }
}

async function streamUpstream({ group, send, signal, profileContext = '' }) {
  // 客户端断开或超时，两条路径最终都收敛到同一个 AbortSignal
  const timeoutController = new AbortController();
  const onAbort = () => timeoutController.abort();
  signal.addEventListener('abort', onAbort, { once: true });

  const abortTimer = setTimeout(() => timeoutController.abort(), config.timeoutMs);
  if (signal.aborted) timeoutController.abort();

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: buildMessages(group, profileContext),
        stream: true,
        temperature: 0.75,
        max_tokens: 1400,
      }),
      signal: timeoutController.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`上游接口返回 ${response.status} ${detail.slice(0, 200)}`.trim());
    }
    if (!response.body) throw new Error('上游接口没有返回流式内容');

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith('data:')) continue;

        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') {
          if (data === '[DONE]') return;
          continue;
        }

        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue; // 不完整的 JSON，等下一片
        }
        const delta = parsed?.choices?.[0]?.delta;
        if (delta?.content) send({ type: 'delta', text: delta.content });
      }
    }
  } finally {
    clearTimeout(abortTimer);
    signal.removeEventListener('abort', onAbort);
  }
}

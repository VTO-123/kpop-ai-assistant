import { config } from './config.js';
import { streamDemo } from './demo.js';
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
  if (/timeout|timed out|ETIMEDOUT/i.test(message)) return '上游接口超时，请稍后重试';
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|getaddrinfo/i.test(message)) {
    return `无法连接 AI 接口（${config.providerLabel}），请检查网络或 AI_BASE_URL`;
  }
  if (/401|invalid.*key|unauthorized/i.test(message)) return 'API Key 无效或已过期，请检查 .env.local';
  if (/429|rate limit/i.test(message)) return '请求太频繁，已被接口限流，请稍后再试';
  return message.slice(0, 200) || '生成失败，请重试';
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
  const { source, entry } = resolveSource(group);

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
    send({
      type: 'meta',
      model: config.demo ? 'demo' : config.model,
      demo: config.demo,
      source,
    });

    if (source === 'builtin') {
      // 内置资料准确且免费，优先使用；未知团体才走模型
      await streamDemo({ text: entry.text, send, signal: controller.signal });
    } else if (config.demo) {
      // 没配 Key 又不在内置清单里：明确告知，绝不编造假档案
      throw Object.assign(
        new Error(
          `「${group}」暂无内置资料，需要由 AI 实时生成；当前是 DEMO 模式（未配置 AI_API_KEY）。` +
            '请在 .env.local 填写 AI_API_KEY 后重启服务，再试一次。',
        ),
        { expected: true },
      );
    } else {
      // 先抓网易云 + QQ 音乐的真实资料，合并后作为上下文喂给模型
      let context = '';
      let profileName = '';
      const sources = [];
      if (config.profileLookup) {
        const [netease, qq] = await Promise.allSettled([
          fetchArtistProfile(group),
          fetchQQArtist(group),
        ]);
        const ne = netease.status === 'fulfilled' ? netease.value : null;
        const qqProfile = qq.status === 'fulfilled' ? qq.value : null;

        const parts = [];
        if (ne) {
          parts.push(`【网易云音乐资料】\n${profileToContext(ne)}`);
          sources.push('netease');
        }
        if (qqProfile) {
          parts.push(`【QQ 音乐资料】\n${qqToContext(qqProfile)}`);
          sources.push('qqmusic');
        }
        context = parts.join('\n\n');
        profileName = ne?.name || qqProfile?.name || '';
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

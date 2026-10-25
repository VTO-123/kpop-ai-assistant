/** 与 /api/chat 的交互：发起请求 + 解析 SSE。 */

async function readErrorMessage(res) {
  try {
    const data = await res.json();
    if (data && data.error) return data.error;
  } catch {
    /* ignore */
  }
  return `服务返回 ${res.status}，请稍后重试`;
}

/**
 * 发起一次生成请求，返回可读流。
 * @param {string} group
 * @param {{ signal?: AbortSignal }} [options]
 */
export async function postChat(group, { signal } = {}) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ group }),
    signal,
  });

  if (!res.ok) throw new Error(await readErrorMessage(res));
  return res.body;
}

/**
 * 消费 SSE 流，逐个事件回调。
 * 服务端事件：meta / delta / done / error
 */
export async function consumeStream(body, onEvent) {
  if (!body) throw new Error('浏览器不支持流式响应');

  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);

      for (const line of block.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload) continue;

        let event;
        try {
          event = JSON.parse(payload);
        } catch {
          continue;
        }
        onEvent(event);
      }
    }
  }
}

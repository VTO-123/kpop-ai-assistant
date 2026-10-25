/**
 * 数据来源判定：一次生成请求到底用「内置资料」还是「AI 实时生成」。
 *
 * 规则（与产品约定一致）：
 *   1. 内置资料命中 → builtin，优先使用。理由：这 8 个团体的事实经过人工核对，
 *      既准确又不花 token，还能在没配 Key 时离线演示。
 *   2. 其余任何名字 → ai，交给大模型实时生成，输出必须带「AI 生成」标注。
 *   3. 未配 Key 又没命中内置 → 明确告知用户，绝不编造一份假档案。
 */
import { lookupGroup } from './demo.js';

/**
 * @typedef {{ source: 'builtin', entry: { name: string, text: string } }
 *         | { source: 'ai', entry: null }} SourceResolution
 */

/**
 * @param {string} rawName 已经过 sanitizeGroup 的团体名
 * @returns {SourceResolution}
 */
export function resolveSource(rawName) {
  const entry = lookupGroup(rawName);
  if (entry) return { source: 'builtin', entry };
  return { source: 'ai', entry: null };
}

/** 内置资料覆盖的团体名（供 /api/config 与前端提示使用）。 */
export { lookupGroup };

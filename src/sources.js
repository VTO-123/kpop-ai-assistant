/**
 * 数据来源判定：一次请求到底用「人工整理的内置档案」、
 * 「从百科 / 音乐平台抓取的真实资料」，还是交给模型补写。
 *
 * 规则：
 *   1. 命中内置精选档案（8 个团体）→ builtin，正文经过人工核对；
 *   2. 歌手库里有资料（出道年 / 成员 / 代表作 / 热歌）→ profile，
 *      直接用抓取到的真实字段拼档案，不经过模型；
 *   3. 其余任何名字 → ai，交给模型实时整理；未配 Key 时明确告知，绝不编造。
 */
import { lookupGroup } from './demo.js';
import { buildProfileArchive, getLibraryProfile } from './profile.js';

/**
 * @typedef {{ source: 'builtin' | 'profile', entry: { name: string, text: string }, profile?: object }
 *         | { source: 'ai', entry: null }} SourceResolution
 */

/**
 * @param {string} rawName 已经过 sanitizeGroup 的名字
 * @returns {SourceResolution}
 */
export function resolveSource(rawName) {
  const entry = lookupGroup(rawName);
  if (entry) return { source: 'builtin', entry };

  const profile = getLibraryProfile(rawName);
  if (profile?.hasData) {
    return {
      source: 'profile',
      entry: { name: profile.name, text: buildProfileArchive(profile), sources: profile.sources },
      profile,
    };
  }

  return { source: 'ai', entry: null };
}

/** 内置资料覆盖的团体名（供 /api/config 与前端提示使用）。 */
export { lookupGroup };

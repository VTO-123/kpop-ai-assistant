/**
 * data/groups.json 的读取与查找。
 * 这里只放「展示用元信息」（团体名、别名、封面 URL），
 * 档案正文仍由 src/demo.js（内置）或大模型（实时生成）提供。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from './config.js';

const FILE = path.join(ROOT_DIR, 'data', 'groups.json');

let cache = null;

/** 与 src/demo.js 保持一致的归一化：忽略大小写、空格与常见标点。 */
export function normalizeName(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[\s\-_.·'"“”‘’()（）[\]]/g, '')
    .trim();
}

export function loadGroups() {
  if (cache) return cache;

  let parsed = { groups: [] };
  try {
    parsed = JSON.parse(readFileSync(FILE, 'utf8'));
  } catch (err) {
    console.warn(`[groups] 读取 data/groups.json 失败：${err.message}`);
  }

  const groups = (Array.isArray(parsed.groups) ? parsed.groups : []).map((group) => ({
    ...group,
    key: normalizeName(group.key || group.name),
    aliases: (group.aliases || []).map(normalizeName).filter(Boolean),
  }));

  cache = { ...parsed, groups };
  return cache;
}

/** 按团体名 / 中文名 / 别名查元信息；查不到返回 null（详情页会用占位封面）。 */
export function findGroup(rawName) {
  const key = normalizeName(rawName);
  if (!key) return null;
  return (
    loadGroups().groups.find(
      (group) =>
        group.key === key ||
        group.aliases.includes(key) ||
        (group.nameZh && normalizeName(group.nameZh) === key),
    ) || null
  );
}

export function listGroups() {
  return loadGroups().groups;
}

/** 所有已知成员（用于档案页「成员名单」的可点击跳转）。 */
export function listMembers() {
  const members = [];
  for (const group of loadGroups().groups) {
    for (const name of group.members || []) {
      if (typeof name === 'string' && name.trim()) {
        members.push({ name: name.trim(), group: group.name });
      }
    }
  }
  return members;
}

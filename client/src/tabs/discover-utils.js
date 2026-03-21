// Shared utilities for Discover components (Discover 组件共享工具函数)

export const TRUST_COLORS = {
  official: 'bg-blue-900/50 text-blue-300 border-blue-700',
  trusted: 'bg-orange-900/50 text-orange-300 border-orange-700',
  unverified: 'bg-red-900/50 text-red-300 border-red-700',
}

const TRUST_LABELS = {
  official: { en: 'Official', zh: '官方' },
  trusted: { en: 'Trusted', zh: '可信' },
  unverified: { en: 'Unverified', zh: '未验证' },
}

export function getTrustLabel(id, lang) {
  return TRUST_LABELS[id] ? (lang === 'zh' ? TRUST_LABELS[id].zh : TRUST_LABELS[id].en) : id
}

// Old category ID -> new enum ID mapping (旧分类 ID → 新枚举 ID 映射)
const OLD_CAT_MAP = {
  'security': 'security',
  'code-review': 'development',
  'language-support': 'development',
  'git-workflow': 'devops',
  'testing': 'testing',
  'output-style': 'documentation',
  'setup': 'devops',
  'integration': 'automation',
  'frontend': 'design-creative',
  'other': 'other',
}

export function getCatLabel(id, enums, lang) {
  if (enums?.categories?.[id]) return lang === 'zh' ? enums.categories[id].zh : enums.categories[id].en
  const mapped = OLD_CAT_MAP[id]
  if (mapped && enums?.categories?.[mapped]) return lang === 'zh' ? enums.categories[mapped].zh : enums.categories[mapped].en
  return id || ''
}

export function getActLabel(id, enums, lang) {
  if (enums?.actions?.[id]) return lang === 'zh' ? enums.actions[id].zh : enums.actions[id].en
  return id || ''
}

export function formatStars(n) {
  if (!n) return null
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
  return String(n)
}

export function timeAgo(dateStr) {
  if (!dateStr) return null
  const diff = Date.now() - new Date(dateStr).getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  if (days < 1) return 'today'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

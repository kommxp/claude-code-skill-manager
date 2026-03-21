import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/api'
import { useI18n } from '../lib/i18n'

const TRUST_COLORS = {
  official: 'bg-blue-900/50 text-blue-300 border-blue-700',
  trusted: 'bg-orange-900/50 text-orange-300 border-orange-700',
  unverified: 'bg-red-900/50 text-red-300 border-red-700',
}

// Tag enums loaded from API dynamically

// 独立的标签显示函数（DetailPanel 和主组件都能用）
const TRUST_LABELS = {
  official: { en: 'Official', zh: '官方' },
  trusted: { en: 'Trusted', zh: '可信' },
  unverified: { en: 'Unverified', zh: '未验证' },
}
function getTrustLabel(id, lang) {
  return TRUST_LABELS[id] ? (lang === 'zh' ? TRUST_LABELS[id].zh : TRUST_LABELS[id].en) : id
}

// 旧分类 ID → 新枚举 ID 映射（discover.js inferCategory 产生的旧值）
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

function getCatLabel(id, enums, lang) {
  // 先查新枚举
  if (enums?.categories?.[id]) return lang === 'zh' ? enums.categories[id].zh : enums.categories[id].en
  // 旧值映射到新值再查
  const mapped = OLD_CAT_MAP[id]
  if (mapped && enums?.categories?.[mapped]) return lang === 'zh' ? enums.categories[mapped].zh : enums.categories[mapped].en
  return id || ''
}
function getActLabel(id, enums, lang) {
  if (enums?.actions?.[id]) return lang === 'zh' ? enums.actions[id].zh : enums.actions[id].en
  return id || ''
}

function formatStars(n) {
  if (!n) return null
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
  return String(n)
}

function timeAgo(dateStr) {
  if (!dateStr) return null
  const diff = Date.now() - new Date(dateStr).getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  if (days < 1) return 'today'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

// ─── Detail Panel ─────────────────────────────────────────
function DetailPanel({ skill, onClose, lang, enums }) {
  const { t } = useI18n()
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const fetchDetail = useCallback(async () => {
    setLoading(true)
    try {
      const d = await api.discoverDetail(skill.name)
      setDetail(d)
    } catch {
      // detail fetch failed, will show fallback
    } finally {
      setLoading(false)
    }
  }, [skill.name])

  // Auto-fetch if no cached zh description
  useEffect(() => {
    if (skill.descriptionZh) {
      setDetail({ ...skill })
    } else {
      fetchDetail()
    }
  }, [skill.name])

  const handleCopy = () => {
    const source = skill.source === 'claude-plugins-official' ? 'claude-plugins-official' : skill.source
    navigator.clipboard.writeText(`/plugin install ${skill.name}@${source}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const desc = detail || skill
  const showZh = lang === 'zh'

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose} role="dialog" aria-modal="true" aria-label={skill.name}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative w-full max-w-xl bg-zinc-900 border-l border-zinc-700 h-full overflow-y-auto shadow-2xl animate-slide-in"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-zinc-900/95 backdrop-blur border-b border-zinc-800 px-6 py-4 flex items-start justify-between z-10">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-mono text-zinc-100 truncate">{skill.name}</h2>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">
                {skill.categoryLabel || getCatLabel(skill.category, enums, lang)}
              </span>
              {formatStars(skill.repoStars) && (
                <span className="text-xs text-zinc-500">★ {formatStars(skill.repoStars)}</span>
              )}
              {skill.installed && (
                <span className="text-xs px-2 py-0.5 rounded bg-emerald-900/50 text-emerald-300 border border-emerald-700">
                  {t('discover.installed')}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="ml-4 text-zinc-500 hover:text-zinc-200 text-xl leading-none p-1"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="px-6 py-5 space-y-6">
          {/* Description */}
          <section>
            <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">{t('discover.detail.desc')}</h3>
            {loading ? (
              <p className="text-sm text-zinc-500 animate-pulse">{t('discover.detail.loading')}</p>
            ) : (
              <p className="text-sm text-zinc-300 leading-relaxed">
                {showZh
                  ? (desc.descriptionZh || desc.description || skill.description || t('discover.detail.noDesc'))
                  : (desc.descriptionEn || desc.description || skill.description || t('discover.detail.noDesc'))}
              </p>
            )}
          </section>

          {/* Use Case */}
          {(showZh ? desc.useCaseZh : desc.useCaseEn) && (
            <section>
              <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">{t('discover.detail.useCase')}</h3>
              <div className="bg-zinc-800/50 rounded-lg p-4">
                <p className="text-sm text-zinc-300 leading-relaxed">
                  {showZh ? desc.useCaseZh : desc.useCaseEn}
                </p>
              </div>
            </section>
          )}

          {/* Fetch button if no detail */}
          {!loading && !desc.descriptionZh && (
            <button
              onClick={fetchDetail}
              className="w-full py-2 text-sm bg-violet-900/30 hover:bg-violet-900/50 text-violet-300 border border-violet-800 rounded-lg transition-colors"
            >
              {t('discover.detail.fetchDetail')}
            </button>
          )}

          {/* Info Grid */}
          <section>
            <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">{t('discover.detail.info')}</h3>
            <div className="grid grid-cols-2 gap-3">
              <InfoItem label={t('discover.detail.source')} value={skill.source} />
              <InfoItem label={t('discover.detail.stars')} value={formatStars(skill.repoStars) || '-'} />
              <InfoItem label={t('discover.detail.lastUpdate')} value={timeAgo(skill.pushedAt) || '-'} />
              <InfoItem label={t('discover.detail.category')} value={skill.categoryLabel || getCatLabel(skill.category, enums, lang)} />
            </div>
          </section>

          {/* Tags（合并 AI 标签 + GitHub topics，去重） */}
          {(() => {
            const actionTags = (skill.actionLabels || skill.actions || []);
            const targetTags = (skill.targets || []);
            const usedKeys = new Set([...actionTags.map(a => a.toLowerCase()), ...targetTags.map(t => t.toLowerCase())]);
            // GitHub topics 去重（排除已在 actions/targets 中出现的）
            const extraTags = (skill.tags || []).filter(t => !usedKeys.has(t.toLowerCase()));
            const hasAny = actionTags.length > 0 || targetTags.length > 0 || extraTags.length > 0 || skill.complexity;
            if (!hasAny) return null;
            return (
              <section>
                <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">{t('discover.detail.tags')}</h3>
                <div className="flex flex-wrap gap-1.5">
                  {actionTags.map(a => (
                    <span key={'a-'+a} className="text-xs px-2 py-0.5 rounded-full bg-violet-900/30 text-violet-300 border border-violet-800">{a}</span>
                  ))}
                  {targetTags.map(t => (
                    <span key={'t-'+t} className="text-xs px-2 py-0.5 rounded-full bg-blue-900/30 text-blue-300 border border-blue-800">{t}</span>
                  ))}
                  {skill.complexity && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-900/30 text-emerald-300 border border-emerald-800">
                      {skill.complexityLabel || skill.complexity}
                    </span>
                  )}
                  {extraTags.map(tag => (
                    <span key={'g-'+tag} className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400">{tag}</span>
                  ))}
                </div>
              </section>
            );
          })()}

          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t border-zinc-800">
            <button
              onClick={handleCopy}
              className="flex-1 py-2.5 text-sm bg-violet-600 hover:bg-violet-500 rounded-lg text-white font-medium transition-colors"
            >
              {copied ? t('discover.copied') : t('discover.copyCmd')}
            </button>
            <button
              onClick={() => window.open(skill.repoUrl, '_blank')}
              className="px-5 py-2.5 text-sm bg-zinc-800 hover:bg-zinc-700 rounded-lg text-zinc-300 transition-colors"
            >
              GitHub
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function InfoItem({ label, value }) {
  return (
    <div className="bg-zinc-800/40 rounded-lg px-3 py-2">
      <div className="text-[10px] text-zinc-600 uppercase">{label}</div>
      <div className="text-sm text-zinc-300 mt-0.5 truncate">{value}</div>
    </div>
  )
}

// ─── Main Discover Page ───────────────────────────────────
export default function Discover() {
  const { t, lang } = useI18n()
  const [skills, setSkills] = useState([])
  const [categories, setCategories] = useState([])
  const [enums, setEnums] = useState(null) // { categories, actions, complexity }
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [action, setAction] = useState('all')
  const [complexity, setComplexity] = useState('all')
  const [trust, setTrust] = useState('all')
  const [sortBy, setSortBy] = useState(() => {
    const saved = localStorage.getItem('discover-sort') || ''
    // 清理无效的旧值
    return ['', 'hot', 'recent', 'name'].includes(saved) ? saved : ''
  })
  const [refreshing, setRefreshing] = useState(false)
  const [selected, setSelected] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  const handleSortChange = (v) => { setSortBy(v); localStorage.setItem('discover-sort', v); setCurrentPage(1); }

  // 获取标签枚举
  const loadEnums = async () => {
    try {
      const e = await api.discoverEnums()
      setEnums(e)
    } catch { /* ignore */ }
  }

  const loadCategories = async () => {
    try {
      const cats = await api.discoverCategories()
      setCategories(cats)
    } catch { /* ignore */ }
  }

  const loadSkills = async (append = false) => {
    try {
      if (append) setLoadingMore(true)
      else setLoading(true)

      const pg = append ? currentPage + 1 : 1
      const params = { lang, page: pg, pageSize: 60 }
      if (category !== 'all') params.category = category
      if (action !== 'all') params.action = action
      if (complexity !== 'all') params.complexity = complexity
      if (search) params.search = search
      if (sortBy) params.sort = sortBy

      const res = await api.discover(params)
      // 兼容旧格式（数组）和新格式（对象）
      if (Array.isArray(res)) {
        setSkills(res)
        setTotal(res.length)
        setHasMore(false)
        setCurrentPage(1)
      } else {
        setSkills(append ? [...skills, ...res.skills] : res.skills)
        setTotal(res.total)
        setHasMore(res.hasMore)
        setCurrentPage(pg)
      }
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  const load = async () => {
    await Promise.all([loadSkills(), loadCategories(), loadEnums()])
  }

  const catLabel = (id) => getCatLabel(id, enums, lang)

  useEffect(() => { load() }, [category, action, complexity, trust, sortBy, lang])

  const handleSearch = (e) => {
    e.preventDefault()
    loadSkills()
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await api.discoverRefresh()
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setRefreshing(false)
    }
  }

  const filteredSkills = skills

  if (loading && skills.length === 0 && categories.length === 0) {
    return <div className="text-zinc-500 py-8 text-center">{t('loading')}</div>
  }

  return (
    <div className="space-y-4">
      {/* ═══ 第一层：标题 + 搜索 + 排序 + 筛选下拉 ═══ */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-zinc-100">{t('discover.title')}</h2>

        <div className="flex flex-wrap gap-2 items-center">
          {/* 排序 */}
          <select
            value={sortBy}
            onChange={e => handleSortChange(e.target.value)}
            className="h-9 bg-zinc-900 border border-zinc-800 rounded-lg px-3 text-xs text-zinc-300 focus:outline-none focus:border-violet-500"
          >
            <option value="">{t('discover.sortDefault')}</option>
            <option value="hot">{t('discover.sortHot')}</option>
            <option value="recent">{t('discover.sortRecent')}</option>
            <option value="name">{t('discover.sortName')}</option>
          </select>

          {/* 分类 */}
          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            className="h-9 bg-zinc-900 border border-zinc-800 rounded-lg px-3 text-xs text-zinc-300 focus:outline-none focus:border-violet-500"
          >
            <option value="all">{lang === 'zh' ? '所有分类' : 'All Categories'}</option>
            {categories.map(cat => (
              <option key={cat.name} value={cat.name}>
                {catLabel(cat.name)} ({cat.count})
              </option>
            ))}
          </select>

          {/* 动作 */}
          {enums?.actions && (
            <select
              value={action}
              onChange={e => setAction(e.target.value)}
              className="h-9 bg-zinc-900 border border-zinc-800 rounded-lg px-3 text-xs text-zinc-300 focus:outline-none focus:border-violet-500"
            >
              <option value="all">{lang === 'zh' ? '所有动作' : 'All Actions'}</option>
              {Object.entries(enums.actions).map(([id, meta]) => (
                <option key={id} value={id}>{lang === 'zh' ? meta.zh : meta.en}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* ═══ 第二层：Complexity segmented + 结果计数 ═══ */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Complexity segmented */}
        {enums?.complexity && (
          <div className="inline-flex rounded-lg bg-zinc-900 p-0.5 border border-zinc-800">
            <button
              onClick={() => setComplexity('all')}
              className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                complexity === 'all' ? 'bg-zinc-700 text-zinc-100 shadow-sm' : 'text-zinc-500 hover:text-zinc-200'
              }`}
            >
              {lang === 'zh' ? '全部' : 'All'}
            </button>
            {Object.entries(enums.complexity).map(([id, meta]) => (
              <button
                key={id}
                onClick={() => setComplexity(id)}
                className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                  complexity === id ? 'bg-zinc-700 text-zinc-100 shadow-sm' : 'text-zinc-500 hover:text-zinc-200'
                }`}
              >
                {lang === 'zh' ? meta.zh : meta.en}
              </button>
            ))}
          </div>
        )}

        {/* 结果计数 */}
        <span className="ml-auto text-xs text-zinc-600">
          {filteredSkills.length} / {total || categories.reduce((s, c) => s + c.count, 0) || '...'}
        </span>
      </div>

      {/* ═══ 第三层：活跃筛选标签（有选中时才显示） ═══ */}
      {(category !== 'all' || action !== 'all' || complexity !== 'all') && (
        <div className="flex flex-wrap items-center gap-1.5">
          {category !== 'all' && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-violet-900/30 text-violet-300 border border-violet-800">
              {catLabel(category)}
              <button onClick={() => setCategory('all')} className="hover:text-white">×</button>
            </span>
          )}
          {action !== 'all' && enums?.actions?.[action] && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-blue-900/30 text-blue-300 border border-blue-800">
              {lang === 'zh' ? enums.actions[action].zh : enums.actions[action].en}
              <button onClick={() => setAction('all')} className="hover:text-white">×</button>
            </span>
          )}
          {complexity !== 'all' && enums?.complexity?.[complexity] && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-emerald-900/30 text-emerald-300 border border-emerald-800">
              {lang === 'zh' ? enums.complexity[complexity].zh : enums.complexity[complexity].en}
              <button onClick={() => setComplexity('all')} className="hover:text-white">×</button>
            </span>
          )}
          <button
            onClick={() => { setCategory('all'); setAction('all'); setComplexity('all'); }}
            className="text-xs text-red-400 hover:text-red-300 ml-1"
          >
            {lang === 'zh' ? '清除全部' : 'Clear all'}
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-900/30 border border-red-800 rounded-lg px-4 py-2 text-sm text-red-300">
          {error}
          <button onClick={load} className="ml-3 underline">{t('retry')}</button>
        </div>
      )}

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredSkills.map(skill => (
          <div
            key={`${skill.source}--${skill.name}`}
            onClick={() => setSelected(skill)}
            onKeyDown={e => e.key === 'Enter' && setSelected(skill)}
            tabIndex={0}
            role="button"
            aria-label={skill.name}
            className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex flex-col gap-3 cursor-pointer hover:border-zinc-600 hover:bg-zinc-800/50 transition-colors"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-mono text-sm text-zinc-200 truncate">{skill.name}</div>
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">
                    {skill.categoryLabel || getCatLabel(skill.category, enums, lang)}
                  </span>
                  {formatStars(skill.repoStars) && (
                    <span className="text-[10px] text-zinc-500">★ {formatStars(skill.repoStars)}</span>
                  )}
                  {timeAgo(skill.pushedAt) && (
                    <span className="text-[10px] text-zinc-600">{timeAgo(skill.pushedAt)}</span>
                  )}
                </div>
              </div>
              {skill.installed && (
                <span className="text-xs px-2 py-0.5 rounded bg-emerald-900/50 text-emerald-300 border border-emerald-700 whitespace-nowrap">
                  {t('discover.installed')}
                </span>
              )}
            </div>

            {/* Description */}
            <p className="text-xs text-zinc-400 line-clamp-2 flex-1">
              {lang === 'zh'
                ? (skill.descriptionZh || skill.description || 'No description')
                : (skill.description || 'No description')}
            </p>

            {/* Use case preview */}
            {(lang === 'zh' ? skill.useCaseZh : skill.useCaseEn) && (
              <p className="text-[11px] text-zinc-500 line-clamp-1 italic">
                {lang === 'zh' ? skill.useCaseZh : skill.useCaseEn}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* 加载更多 */}
      {hasMore && (
        <div className="text-center py-4">
          <button
            onClick={() => loadSkills(true)}
            disabled={loadingMore}
            className="px-6 py-2 text-sm bg-zinc-800 hover:bg-zinc-700 rounded-lg text-zinc-300 transition-colors disabled:opacity-50"
          >
            {loadingMore
              ? (lang === 'zh' ? '加载中...' : 'Loading...')
              : (lang === 'zh' ? `加载更多（还有 ${total - filteredSkills.length} 个）` : `Load more (${total - filteredSkills.length} remaining)`)}
          </button>
        </div>
      )}

      {filteredSkills.length === 0 && !loading && (
        <div className="text-center py-12 text-zinc-500 text-sm">
          {search ? t('discover.noMatch') : t('discover.empty')}
        </div>
      )}

      {loading && skills.length === 0 && categories.length > 0 && (
        <div className="text-center py-12 text-zinc-500 text-sm">{t('loading')}</div>
      )}

      {/* Detail Panel */}
      {selected && (
        <DetailPanel
          skill={selected}
          lang={lang}
          enums={enums}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

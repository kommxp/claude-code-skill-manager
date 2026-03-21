import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { getCatLabel, formatStars, timeAgo } from './discover-utils'
import DetailPanel from './DiscoverDetail'

// ─── Main Discover Page ───────────────────────────────────
export default function Discover() {
  const { t, lang } = useI18n()
  const [skills, setSkills] = useState([])
  const [categories, setCategories] = useState([])
  const [enums, setEnums] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [action, setAction] = useState('all')
  const [complexity, setComplexity] = useState('all')
  const [trust, setTrust] = useState('all')
  const [sortBy, setSortBy] = useState(() => {
    const saved = localStorage.getItem('discover-sort') || ''
    return ['', 'hot', 'recent', 'name'].includes(saved) ? saved : ''
  })
  const [refreshing, setRefreshing] = useState(false)
  const [selected, setSelected] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  const handleSortChange = (v) => { setSortBy(v); localStorage.setItem('discover-sort', v); setCurrentPage(1); }

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
      {/* Title + Sort + Filters */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-zinc-100">{t('discover.title')}</h2>

        <div className="flex flex-wrap gap-2 items-center">
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

      {/* Complexity segmented + count */}
      <div className="flex flex-wrap items-center gap-3">
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

        <span className="ml-auto text-xs text-zinc-600">
          {filteredSkills.length} / {total || categories.reduce((s, c) => s + c.count, 0) || '...'}
        </span>
      </div>

      {/* Active filter tags */}
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

            <p className="text-xs text-zinc-400 line-clamp-2 flex-1">
              {lang === 'zh'
                ? (skill.descriptionZh || skill.description || 'No description')
                : (skill.description || 'No description')}
            </p>

            {(lang === 'zh' ? skill.useCaseZh : skill.useCaseEn) && (
              <p className="text-[11px] text-zinc-500 line-clamp-1 italic">
                {lang === 'zh' ? skill.useCaseZh : skill.useCaseEn}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Load more */}
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

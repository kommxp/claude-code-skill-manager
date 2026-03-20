import { useState } from 'react'
import { api } from '../lib/api'
import { useI18n } from '../lib/i18n'

function useSourceLabel() {
  const { t } = useI18n()
  return (source) => t(`source.${source}`) || source
}

const SOURCE_COLORS = {
  custom: 'bg-emerald-900/50 text-emerald-300 border-emerald-700',
  bundled: 'bg-zinc-700/50 text-zinc-300 border-zinc-600',
  official: 'bg-blue-900/50 text-blue-300 border-blue-700',
  trailofbits: 'bg-orange-900/50 text-orange-300 border-orange-700',
  external: 'bg-purple-900/50 text-purple-300 border-purple-700',
}

function SkillRow({ skill, onSelect, t, sourceLabel }) {
  return (
    <tr
      className="border-b border-zinc-800 hover:bg-zinc-900/50 cursor-pointer transition-colors"
      onClick={() => onSelect(skill)}
    >
      <td className="py-3 px-4">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-zinc-200">{skill.invokeCommand || '/' + skill.name}</span>
          {!skill.enabled && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">{t('skills.disabled')}</span>
          )}
        </div>
      </td>
      <td className="py-3 px-4">
        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${SOURCE_COLORS[skill.source] || 'bg-zinc-800 text-zinc-400'}`}>
          {sourceLabel(skill.source)}
        </span>
      </td>
      <td className="py-3 px-4 text-sm text-zinc-400 max-w-xs truncate">
        {skill.description?.slice(0, 60) || '—'}
      </td>
      <td className="py-3 px-4 text-sm text-zinc-500 max-w-xs truncate">
        {skill.useCases ? skill.useCases.split('\n')[0].replace(/^-\s*/, '') : '—'}
      </td>
      <td className="py-3 px-4 text-sm text-zinc-300 text-right font-mono">
        {skill.stats?.totalCalls || 0}
      </td>
      <td className="py-3 px-4 text-sm text-zinc-500 text-right">
        {skill.stats?.lastUsed ? new Date(skill.stats.lastUsed).toLocaleDateString() : '—'}
      </td>
    </tr>
  )
}

function SkillDetail({ skill, onClose, onRefresh, t, sourceLabel }) {
  const [confirming, setConfirming] = useState(null)

  const handleToggle = async () => {
    await api.toggleSkill(skill.id)
    onRefresh()
    onClose()
  }

  const handleDelete = async () => {
    if (confirming !== 'delete') { setConfirming('delete'); return }
    await api.deleteSkill(skill.id)
    onRefresh()
    onClose()
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(skill.invokeCommand || '/' + skill.name)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex justify-end z-50" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-zinc-900 border-l border-zinc-800 h-full overflow-y-auto p-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-zinc-100">{skill.invokeCommand || '/' + skill.name}</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-xl">&times;</button>
        </div>

        <div className="space-y-4">
          {/* Meta */}
          <div className="flex flex-wrap gap-2">
            <span className={`text-xs px-2 py-1 rounded border ${SOURCE_COLORS[skill.source]}`}>
              {sourceLabel(skill.source)}
            </span>
            {skill.version && <span className="text-xs px-2 py-1 rounded bg-zinc-800 text-zinc-400">v{skill.version}</span>}
            {!skill.enabled && <span className="text-xs px-2 py-1 rounded bg-red-900/50 text-red-300 border border-red-700">{t('skills.disabled')}</span>}
          </div>

          {/* Description */}
          <p className="text-sm text-zinc-300">{skill.description || t('detail.noDesc')}</p>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-zinc-800 rounded p-3">
              <div className="text-xs text-zinc-500">{t('detail.calls')}</div>
              <div className="text-lg font-bold text-zinc-200">{skill.stats?.totalCalls || 0}</div>
            </div>
            <div className="bg-zinc-800 rounded p-3">
              <div className="text-xs text-zinc-500">{t('detail.firstUsed')}</div>
              <div className="text-sm text-zinc-200">{skill.stats?.firstUsed ? new Date(skill.stats.firstUsed).toLocaleDateString() : '—'}</div>
            </div>
            <div className="bg-zinc-800 rounded p-3">
              <div className="text-xs text-zinc-500">{t('detail.lastUsed')}</div>
              <div className="text-sm text-zinc-200">{skill.stats?.lastUsed ? new Date(skill.stats.lastUsed).toLocaleDateString() : '—'}</div>
            </div>
          </div>

          {/* Use Cases */}
          {skill.useCases && (
            <div>
              <h3 className="text-xs text-zinc-500 mb-2">{t('detail.useCases')}</h3>
              <div className="text-sm text-zinc-300 bg-zinc-800 rounded p-3 whitespace-pre-line">
                {skill.useCases}
              </div>
            </div>
          )}

          {/* Allowed Tools */}
          {skill.allowedTools?.length > 0 && (
            <div>
              <h3 className="text-xs text-zinc-500 mb-2">{t('detail.allowedTools')}</h3>
              <div className="flex flex-wrap gap-1">
                {skill.allowedTools.map(tool => (
                  <span key={tool} className="text-xs px-2 py-0.5 bg-zinc-800 rounded text-zinc-400">{tool}</span>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-4 border-t border-zinc-800">
            <button onClick={handleCopy} className="px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-300 transition-colors">
              {t('detail.copyCmd')}
            </button>
            {skill.source === 'custom' && (
              <>
                <button onClick={handleToggle} className="px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-300 transition-colors">
                  {skill.enabled ? t('detail.disable') : t('detail.enable')}
                </button>
                <button
                  onClick={handleDelete}
                  className={`px-3 py-1.5 text-sm rounded transition-colors ${
                    confirming === 'delete'
                      ? 'bg-red-800 text-red-100'
                      : 'bg-zinc-800 hover:bg-red-900/50 text-zinc-300 hover:text-red-300'
                  }`}
                >
                  {confirming === 'delete' ? t('detail.confirmDelete') : t('detail.delete')}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Skills({ skills, onRefresh }) {
  const { t } = useI18n()
  const sourceLabel = useSourceLabel()
  const [search, setSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState(() => localStorage.getItem('skills-source') || '')
  const [sortBy, setSortBy] = useState(() => localStorage.getItem('skills-sort') || '')
  const [selected, setSelected] = useState(null)

  const handleSourceChange = (v) => { setSourceFilter(v); localStorage.setItem('skills-source', v) }
  const handleSortChange = (v) => { setSortBy(v); localStorage.setItem('skills-sort', v) }

  let filtered = [...skills]

  if (search) {
    const q = search.toLowerCase()
    filtered = filtered.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.description?.toLowerCase().includes(q)
    )
  }

  if (sourceFilter) {
    filtered = filtered.filter(s => s.source === sourceFilter)
  }

  if (sortBy === 'calls') {
    filtered.sort((a, b) => (b.stats?.totalCalls || 0) - (a.stats?.totalCalls || 0))
  } else if (sortBy === 'recent') {
    filtered.sort((a, b) => (b.stats?.lastUsed || 0) - (a.stats?.lastUsed || 0))
  } else if (sortBy === 'name') {
    filtered.sort((a, b) => a.name.localeCompare(b.name))
  }

  const sources = [...new Set(skills.map(s => s.source))]

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <input
          type="text"
          placeholder={t('skills.search')}
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-zinc-900 border border-zinc-800 rounded-md px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 w-64"
        />
        <select
          value={sourceFilter}
          onChange={e => handleSourceChange(e.target.value)}
          className="bg-zinc-900 border border-zinc-800 rounded-md px-3 py-1.5 text-sm text-zinc-300 focus:outline-none"
        >
          <option value="">{t('skills.allSources')}</option>
          {sources.map(s => <option key={s} value={s}>{sourceLabel(s)}</option>)}
        </select>
        <select
          value={sortBy}
          onChange={e => handleSortChange(e.target.value)}
          className="bg-zinc-900 border border-zinc-800 rounded-md px-3 py-1.5 text-sm text-zinc-300 focus:outline-none"
        >
          <option value="">{t('skills.defaultSort')}</option>
          <option value="calls">{t('skills.mostUsed')}</option>
          <option value="recent">{t('skills.recentlyUsed')}</option>
          <option value="name">{t('skills.nameAZ')}</option>
        </select>
        <span className="text-sm text-zinc-500">{t('skills.count', { count: filtered.length })}</span>
      </div>

      {/* Table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-zinc-800 text-xs text-zinc-500 uppercase">
              <th className="py-2 px-4 text-left font-medium">{t('skills.name')}</th>
              <th className="py-2 px-4 text-left font-medium">{t('skills.source')}</th>
              <th className="py-2 px-4 text-left font-medium">{t('skills.description')}</th>
              <th className="py-2 px-4 text-left font-medium">{t('skills.useCases')}</th>
              <th className="py-2 px-4 text-right font-medium">{t('skills.calls')}</th>
              <th className="py-2 px-4 text-right font-medium">{t('skills.lastUsed')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(skill => (
              <SkillRow key={skill.id} skill={skill} onSelect={setSelected} t={t} sourceLabel={sourceLabel} />
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="text-center py-8 text-zinc-500 text-sm">
            {search ? t('skills.noMatch') : t('skills.noFound')}
          </div>
        )}
      </div>

      {/* Detail Panel */}
      {selected && (
        <SkillDetail skill={selected} onClose={() => setSelected(null)} onRefresh={onRefresh} t={t} sourceLabel={sourceLabel} />
      )}
    </div>
  )
}

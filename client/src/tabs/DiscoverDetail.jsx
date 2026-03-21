import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { getCatLabel, formatStars, timeAgo } from './discover-utils'

function InfoItem({ label, value }) {
  return (
    <div className="bg-zinc-800/40 rounded-lg px-3 py-2">
      <div className="text-[10px] text-zinc-600 uppercase">{label}</div>
      <div className="text-sm text-zinc-300 mt-0.5 truncate">{value}</div>
    </div>
  )
}

export default function DetailPanel({ skill, onClose, lang, enums }) {
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

          {/* Tags */}
          {(() => {
            const actionTags = (skill.actionLabels || skill.actions || []);
            const targetTags = (skill.targets || []);
            const usedKeys = new Set([...actionTags.map(a => a.toLowerCase()), ...targetTags.map(t => t.toLowerCase())]);
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

import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { useI18n } from '../lib/i18n'

export default function Settings() {
  const { t } = useI18n()
  const [token, setToken] = useState('')
  const [currentToken, setCurrentToken] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api.getConfig().then(cfg => {
      setCurrentToken(cfg.githubToken || '')
    }).catch(() => {})
  }, [])

  const handleSave = async () => {
    await api.saveConfig({ githubToken: token })
    setCurrentToken(token ? '***' + token.slice(-4) : '')
    setToken('')
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="space-y-6 max-w-xl">
      <h2 className="text-lg font-semibold text-zinc-100">{t('settings.title')}</h2>

      {/* GitHub Token */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-5 space-y-4">
        <div>
          <h3 className="text-sm font-medium text-zinc-200">{t('settings.githubToken')}</h3>
          <p className="text-xs text-zinc-500 mt-1 leading-relaxed">{t('settings.githubTokenDesc')}</p>
        </div>

        {/* 当前状态 */}
        <div className="text-xs text-zinc-500">
          {t('settings.current')}:{' '}
          {currentToken
            ? <span className="text-emerald-400">{currentToken} (5000 req/hour)</span>
            : <span className="text-orange-400">{t('settings.notSet')}</span>
          }
        </div>

        {/* 输入框 */}
        <div className="flex gap-2">
          <input
            type="password"
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder={t('settings.githubTokenPlaceholder')}
            className="flex-1 h-9 rounded-lg bg-zinc-950 border border-zinc-700 px-3 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-violet-500"
          />
          <button
            onClick={handleSave}
            disabled={!token}
            className="px-4 h-9 text-sm bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:hover:bg-violet-600 rounded-lg text-white font-medium transition-colors"
          >
            {saved ? t('settings.saved') : t('settings.save')}
          </button>
        </div>
      </div>
    </div>
  )
}

import { useState, useEffect } from 'react'
import { api } from './lib/api'
import { useI18n } from './lib/i18n'
import Dashboard from './tabs/Dashboard'
import Skills from './tabs/Skills'
import Discover from './tabs/Discover'
import Settings from './tabs/Settings'

export default function App() {
  const { t, lang, toggleLang } = useI18n()
  const [tab, setTab] = useState('dashboard')
  const [overview, setOverview] = useState(null)
  const [skills, setSkills] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const TABS = [
    { id: 'dashboard', label: t('tab.dashboard') },
    { id: 'skills', label: t('tab.skills') },
    { id: 'discover', label: t('tab.discover') },
    { id: 'settings', label: t('tab.settings') },
  ]

  const load = async (loadLang) => {
    const targetLang = loadLang || lang
    try {
      setLoading(true)
      const [ov, sk] = await Promise.all([
        api.overview(),
        api.skills({ lang: targetLang }),
      ])
      setOverview(ov)
      setSkills(sk)
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [lang])

  const handleRefresh = async () => {
    await api.refresh()
    await load()
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <div className="text-zinc-400">{t('loading')}</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <h1 className="text-lg font-semibold text-zinc-100">{t('app.title')}</h1>
          <nav className="flex gap-1">
            {TABS.map(tb => (
              <button
                key={tb.id}
                onClick={() => setTab(tb.id)}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                  tab === tb.id
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                }`}
              >
                {tb.label}
              </button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={toggleLang}
            className="text-sm text-zinc-400 hover:text-zinc-200 px-2 py-1 rounded-md hover:bg-zinc-800/50 transition-colors border border-zinc-800"
          >
            {lang === 'en' ? '中文' : 'EN'}
          </button>
          <button
            onClick={handleRefresh}
            className="text-sm text-zinc-400 hover:text-zinc-200 px-3 py-1.5 rounded-md hover:bg-zinc-800/50 transition-colors"
          >
            {t('app.refresh')}
          </button>
        </div>
      </header>

      {/* Error banner */}
      {error && (
        <div className="bg-red-900/30 border-b border-red-800 px-6 py-2 text-sm text-red-300">
          {error}
          <button onClick={load} className="ml-3 underline">{t('retry')}</button>
        </div>
      )}

      {/* Content */}
      <main className="p-6 max-w-6xl mx-auto">
        {tab === 'dashboard' && <Dashboard overview={overview} onRefresh={handleRefresh} />}
        {tab === 'skills' && <Skills skills={skills} onRefresh={load} />}
        {tab === 'discover' && <Discover />}
        {tab === 'settings' && <Settings />}
      </main>
    </div>
  )
}

import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

function StatCard({ label, value, sub }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
      <div className="text-sm text-zinc-400">{label}</div>
      <div className="text-2xl font-bold text-zinc-100 mt-1">{value}</div>
      {sub && <div className="text-xs text-zinc-500 mt-1">{sub}</div>}
    </div>
  )
}

function InsightCard({ insight, t }) {
  const icons = { 'main-skill': '⚡', 'never-used': '💤', 'new-this-week': '✨', 'onboarding': '👋' }

  // 根据 insight 类型生成翻译文本
  let text = insight.text
  if (insight.type === 'main-skill' && insight.name) {
    text = t('insight.main-skill', { name: insight.name, pct: insight.pct })
  } else if (insight.type === 'never-used' && insight.count != null) {
    text = t('insight.never-used', { count: insight.count })
  } else if (insight.type === 'new-this-week' && insight.skills) {
    text = t('insight.new-this-week', { skills: insight.skills })
  } else if (insight.type === 'onboarding') {
    text = t('insight.onboarding')
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex items-start gap-3">
      <span className="text-xl">{icons[insight.type] || '📊'}</span>
      <span className="text-sm text-zinc-300">{text}</span>
    </div>
  )
}

export default function Dashboard({ overview }) {
  const { t } = useI18n()
  const [trend, setTrend] = useState(null)
  const [trendRange, setTrendRange] = useState('30d')

  useEffect(() => {
    api.trend(trendRange).then(setTrend).catch(() => {})
  }, [trendRange])

  if (!overview) {
    return <div className="text-zinc-500">{t('dash.noData')}</div>
  }

  const barData = overview.top5.map(s => ({
    name: '/' + s.name,
    calls: s.calls,
  }))

  return (
    <div className="space-y-6">
      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label={t('stat.totalSkills')} value={overview.totalSkills} sub={t('stat.customBundled', { custom: overview.customSkills, bundled: overview.bundledSkills })} />
        <StatCard label={t('stat.totalCalls')} value={overview.totalCalls} />
        <StatCard label={t('stat.active7d')} value={overview.recentActiveCount} sub={t('stat.skillsUsedRecently')} />
        <StatCard label={t('stat.neverUsed')} value={overview.neverUsedCount} sub={t('stat.considerRemoving')} />
      </div>

      {/* Insights */}
      {overview.insights.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {overview.insights.map((ins, i) => (
            <InsightCard key={i} insight={ins} t={t} />
          ))}
        </div>
      )}

      {/* Top Skills Bar Chart */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
        <h2 className="text-sm font-medium text-zinc-300 mb-4">{t('dash.topSkills')}</h2>
        {barData.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={barData} layout="vertical" margin={{ left: 100 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis type="number" stroke="#71717a" fontSize={12} />
              <YAxis type="category" dataKey="name" stroke="#71717a" fontSize={12} width={100} />
              <Tooltip
                contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8 }}
                labelStyle={{ color: '#e4e4e7' }}
                itemStyle={{ color: '#a1a1aa' }}
              />
              <Bar dataKey="calls" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="text-zinc-500 text-sm py-8 text-center">{t('dash.noCallsYet')}</div>
        )}
      </div>

      {/* Trend Chart */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-zinc-300">{t('dash.callTrend')}</h2>
          <div className="flex gap-1">
            {['7d', '30d', '90d'].map(r => (
              <button
                key={r}
                onClick={() => setTrendRange(r)}
                className={`px-2 py-1 text-xs rounded ${
                  trendRange === r ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        {trend && trend.data ? (
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={trend.data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis
                dataKey="date"
                stroke="#71717a"
                fontSize={10}
                tickFormatter={d => d.slice(5)}
                interval={Math.floor(trend.data.length / 8)}
              />
              <YAxis stroke="#71717a" fontSize={10} allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8 }}
                labelStyle={{ color: '#e4e4e7' }}
                itemStyle={{ color: '#a1a1aa' }}
              />
              <Bar dataKey="count" fill="#6366f1" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="text-zinc-500 text-sm py-8 text-center">{t('dash.loadingTrend')}</div>
        )}
      </div>
    </div>
  )
}

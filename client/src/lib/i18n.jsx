import { createContext, useContext, useState, useEffect } from 'react'

const translations = {
  en: {
    // Header
    'app.title': 'Skill Manager',
    'app.refresh': 'Refresh',
    'tab.dashboard': 'Dashboard',
    'tab.skills': 'My Skills',
    'tab.discover': 'Discover',

    // Dashboard
    'stat.totalSkills': 'Total Skills',
    'stat.totalCalls': 'Total Calls',
    'stat.active7d': 'Active (7d)',
    'stat.neverUsed': 'Never Used',
    'stat.customOfficial': '{custom} custom, {official} official',
    'stat.customBundled': '{custom} custom, {bundled} built-in',
    'stat.skillsUsedRecently': 'skills used recently',
    'stat.considerRemoving': 'consider removing',
    'dash.topSkills': 'Top Skills',
    'dash.noCallsYet': 'No skill calls recorded yet',
    'dash.callTrend': 'Call Trend',
    'dash.loadingTrend': 'Loading trend...',
    'dash.noData': 'No data available',

    // Insights
    'insight.main-skill': 'Your power skill: /{name} ({pct}% of all calls)',
    'insight.never-used': '{count} skills never used — consider removing them',
    'insight.new-this-week': 'New this week: {skills}',
    'insight.onboarding': "You haven't used any skills yet — try these popular ones",

    // Skills
    'skills.search': 'Search skills...',
    'skills.allSources': 'All Sources',
    'skills.defaultSort': 'Default Sort',
    'skills.mostUsed': 'Most Used',
    'skills.recentlyUsed': 'Recently Used',
    'skills.nameAZ': 'Name A-Z',
    'skills.count': '{count} skills',
    'skills.noMatch': 'No skills matching your search',
    'skills.noFound': 'No skills found',
    'skills.disabled': 'disabled',
    'skills.name': 'Name',
    'skills.source': 'Source',
    'skills.description': 'Description',
    'skills.useCases': 'Use Cases',
    'skills.calls': 'Calls',
    'skills.lastUsed': 'Last Used',

    // Detail
    'detail.noDesc': 'No description',
    'detail.calls': 'Calls',
    'detail.firstUsed': 'First Used',
    'detail.lastUsed': 'Last Used',
    'detail.useCases': 'Use Cases',
    'detail.allowedTools': 'Allowed Tools',
    'detail.copyCmd': 'Copy Command',
    'detail.disable': 'Disable',
    'detail.enable': 'Enable',
    'detail.delete': 'Delete',
    'detail.confirmDelete': 'Confirm Delete',

    // Discover
    'discover.title': 'Discover Skills',
    'discover.search': 'Search online skills...',
    'discover.searchBtn': 'Search',
    'discover.refresh': 'Refresh Online Data',
    'discover.refreshing': 'Refreshing...',
    'discover.all': 'All',
    'discover.installed': 'Installed',
    'discover.copyCmd': 'Copy Install',
    'discover.copied': 'Copied!',
    'discover.noMatch': 'No skills matching your search',
    'discover.empty': 'No online skills found. Try refreshing.',
    'discover.sortDefault': 'Default',
    'discover.sortHot': 'Hot',
    'discover.sortRecent': 'Recent',
    'discover.sortName': 'Name A-Z',
    'discover.sortScore': 'Score',
    'discover.detail.loading': 'Loading detail...',
    'discover.detail.desc': 'Description',
    'discover.detail.useCase': 'Use Case',
    'discover.detail.info': 'Information',
    'discover.detail.source': 'Source',
    'discover.detail.stars': 'Stars',
    'discover.detail.lastUpdate': 'Last Update',
    'discover.detail.trust': 'Trust Level',
    'discover.detail.category': 'Category',
    'discover.detail.score': 'Score',
    'discover.detail.tags': 'Tags',
    'discover.detail.close': 'Close',
    'discover.detail.noDesc': 'No description available yet. Click to fetch detail.',
    'discover.detail.fetchDetail': 'Fetch Detail & Translate',
    'discover.detail.fetching': 'Translating...',

    // Sources
    'source.custom': 'Custom',
    'source.bundled': 'Built-in',
    'source.official': 'Official',
    'source.trailofbits': 'Trail of Bits',
    'source.external': 'External',

    // Settings
    'tab.settings': 'Settings',
    'settings.title': 'Settings',
    'settings.githubToken': 'GitHub Token',
    'settings.githubTokenDesc': 'Increases API rate limit from 60 to 5000 requests/hour. Generate at GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic). No permissions needed.',
    'settings.githubTokenPlaceholder': 'ghp_xxxxxxxxxxxxxxxxxxxx',
    'settings.save': 'Save',
    'settings.saved': 'Saved!',
    'settings.current': 'Current',
    'settings.notSet': 'Not set (60 req/hour)',

    // Misc
    'loading': 'Loading...',
    'retry': 'Retry',
  },
  zh: {
    // Header
    'app.title': '技能管理器',
    'app.refresh': '刷新',
    'tab.dashboard': '仪表盘',
    'tab.skills': '我的技能',
    'tab.discover': '发现市场',

    // Dashboard
    'stat.totalSkills': '技能总数',
    'stat.totalCalls': '总调用次数',
    'stat.active7d': '近 7 天活跃',
    'stat.neverUsed': '从未使用',
    'stat.customOfficial': '{custom} 自建, {official} 官方',
    'stat.customBundled': '{custom} 自建, {bundled} 内置',
    'stat.skillsUsedRecently': '个技能近期使用',
    'stat.considerRemoving': '建议清理',
    'dash.topSkills': '热门技能',
    'dash.noCallsYet': '暂无技能调用记录',
    'dash.callTrend': '调用趋势',
    'dash.loadingTrend': '加载趋势中...',
    'dash.noData': '暂无数据',

    // Insights
    'insight.main-skill': '你的主力技能：/{name}（占总调用 {pct}%）',
    'insight.never-used': '{count} 个技能从未使用 — 建议清理',
    'insight.new-this-week': '本周新尝试：{skills}',
    'insight.onboarding': '你还没有使用过技能 — 试试这些热门技能',

    // Skills
    'skills.search': '搜索技能...',
    'skills.allSources': '所有来源',
    'skills.defaultSort': '默认排序',
    'skills.mostUsed': '使用最多',
    'skills.recentlyUsed': '最近使用',
    'skills.nameAZ': '名称 A-Z',
    'skills.count': '{count} 个技能',
    'skills.noMatch': '没有匹配的技能',
    'skills.noFound': '未找到技能',
    'skills.disabled': '已禁用',
    'skills.name': '名称',
    'skills.source': '来源',
    'skills.description': '说明',
    'skills.useCases': '使用场景',
    'skills.calls': '调用',
    'skills.lastUsed': '最近使用',

    // Detail
    'detail.noDesc': '暂无说明',
    'detail.calls': '调用次数',
    'detail.firstUsed': '首次使用',
    'detail.lastUsed': '最近使用',
    'detail.useCases': '使用场景',
    'detail.allowedTools': '可用工具',
    'detail.copyCmd': '复制命令',
    'detail.disable': '禁用',
    'detail.enable': '启用',
    'detail.delete': '删除',
    'detail.confirmDelete': '确认删除',

    // Discover
    'discover.title': '发现技能',
    'discover.search': '搜索在线技能...',
    'discover.searchBtn': '搜索',
    'discover.refresh': '刷新在线数据',
    'discover.refreshing': '刷新中...',
    'discover.all': '全部',
    'discover.installed': '已安装',
    'discover.copyCmd': '复制安装命令',
    'discover.copied': '已复制!',
    'discover.noMatch': '没有匹配的在线技能',
    'discover.empty': '没有在线技能数据，请尝试刷新。',
    'discover.sortDefault': '默认',
    'discover.sortHot': '最热',
    'discover.sortRecent': '最近更新',
    'discover.sortName': '名称 A-Z',
    'discover.sortScore': '评分',
    'discover.detail.loading': '加载详情...',
    'discover.detail.desc': '说明',
    'discover.detail.useCase': '使用场景',
    'discover.detail.info': '基本信息',
    'discover.detail.source': '来源',
    'discover.detail.stars': 'Star 数',
    'discover.detail.lastUpdate': '最近更新',
    'discover.detail.trust': '信任等级',
    'discover.detail.category': '分类',
    'discover.detail.score': '评分',
    'discover.detail.tags': '标签',
    'discover.detail.close': '关闭',
    'discover.detail.noDesc': '暂无详细说明，点击获取。',
    'discover.detail.fetchDetail': '获取详情并翻译',
    'discover.detail.fetching': '翻译中...',

    // Sources
    'source.custom': '自建',
    'source.bundled': '内置',
    'source.official': '官方',
    'source.trailofbits': 'Trail of Bits',
    'source.external': '外部集成',

    // Settings
    'tab.settings': '设置',
    'settings.title': '设置',
    'settings.githubToken': 'GitHub Token',
    'settings.githubTokenDesc': '配置后 API 限额从 60 提升到 5000 次/小时，发现更多技能。前往 GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic) 生成，无需勾选任何权限。',
    'settings.githubTokenPlaceholder': 'ghp_xxxxxxxxxxxxxxxxxxxx',
    'settings.save': '保存',
    'settings.saved': '已保存！',
    'settings.current': '当前',
    'settings.notSet': '未设置（60 次/小时）',

    // Misc
    'loading': '加载中...',
    'retry': '重试',
  },
}

const I18nContext = createContext()

export function I18nProvider({ children }) {
  const [lang, setLang] = useState(() => localStorage.getItem('lang') || 'en')

  useEffect(() => {
    localStorage.setItem('lang', lang)
  }, [lang])

  const t = (key, params) => {
    let text = translations[lang]?.[key] || translations.en[key] || key
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(`{${k}}`, v)
      }
    }
    return text
  }

  const toggleLang = () => setLang(l => l === 'en' ? 'zh' : 'en')

  return (
    <I18nContext.Provider value={{ lang, setLang, toggleLang, t }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  return useContext(I18nContext)
}

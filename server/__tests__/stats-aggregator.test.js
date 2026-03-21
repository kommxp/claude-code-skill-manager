const { aggregateStats, mergeStatsToSkills, generateOverview } = require('../services/stats-aggregator')

describe('aggregateStats', () => {
  test('aggregates calls by skill name', () => {
    const calls = [
      { skillName: 'commit', timestamp: Date.now() - 1000, project: 'proj-a' },
      { skillName: 'commit', timestamp: Date.now() - 2000, project: 'proj-a' },
      { skillName: 'review', timestamp: Date.now() - 3000, project: 'proj-b' },
    ]

    const stats = aggregateStats(calls)
    expect(stats.commit.totalCalls).toBe(2)
    expect(stats.review.totalCalls).toBe(1)
  })

  test('tracks first and last used timestamps', () => {
    const t1 = Date.now() - 5000
    const t2 = Date.now() - 1000
    const calls = [
      { skillName: 'test', timestamp: t1 },
      { skillName: 'test', timestamp: t2 },
    ]

    const stats = aggregateStats(calls)
    expect(stats.test.firstUsed).toBe(t1)
    expect(stats.test.lastUsed).toBe(t2)
  })

  test('aggregates by date', () => {
    const calls = [
      { skillName: 'test', timestamp: new Date('2026-03-20T10:00:00Z').getTime() },
      { skillName: 'test', timestamp: new Date('2026-03-20T15:00:00Z').getTime() },
      { skillName: 'test', timestamp: new Date('2026-03-21T10:00:00Z').getTime() },
    ]

    const stats = aggregateStats(calls)
    expect(stats.test.callsByDate['2026-03-20']).toBe(2)
    expect(stats.test.callsByDate['2026-03-21']).toBe(1)
  })

  test('aggregates by project', () => {
    const calls = [
      { skillName: 'test', timestamp: Date.now(), project: 'alpha' },
      { skillName: 'test', timestamp: Date.now(), project: 'alpha' },
      { skillName: 'test', timestamp: Date.now(), project: 'beta' },
    ]

    const stats = aggregateStats(calls)
    expect(stats.test.callsByProject.alpha).toBe(2)
    expect(stats.test.callsByProject.beta).toBe(1)
  })

  test('aggregates by hour', () => {
    const calls = [
      { skillName: 'test', timestamp: new Date('2026-03-20T14:30:00').getTime() },
      { skillName: 'test', timestamp: new Date('2026-03-21T14:45:00').getTime() },
    ]

    const stats = aggregateStats(calls)
    expect(stats.test.callsByHour[14]).toBe(2)
  })

  test('returns empty object for no calls', () => {
    const stats = aggregateStats([])
    expect(stats).toEqual({})
  })
})

describe('mergeStatsToSkills', () => {
  test('merges stats into skills', () => {
    const skills = [{ name: 'commit' }, { name: 'review' }]
    const statsMap = {
      commit: { totalCalls: 5, lastUsed: Date.now(), firstUsed: Date.now() - 10000, callsByDate: {}, callsByProject: {}, callsByHour: new Array(24).fill(0) },
    }

    mergeStatsToSkills(skills, statsMap)
    expect(skills[0].stats.totalCalls).toBe(5)
    expect(skills[1].stats.totalCalls).toBe(0)
  })
})

describe('generateOverview', () => {
  test('generates overview with correct counts', () => {
    const skills = [
      { name: 'commit', source: 'custom', stats: { totalCalls: 10 } },
      { name: 'help', source: 'bundled', stats: { totalCalls: 3 } },
      { name: 'unused', source: 'custom', stats: { totalCalls: 0 } },
    ]
    const calls = [
      ...Array(10).fill(null).map((_, i) => ({ skillName: 'commit', timestamp: Date.now() - i * 1000 })),
      ...Array(3).fill(null).map((_, i) => ({ skillName: 'help', timestamp: Date.now() - i * 1000 })),
    ]

    const overview = generateOverview(skills, calls)
    expect(overview.totalSkills).toBe(3)
    expect(overview.totalCalls).toBe(13)
    expect(overview.customSkills).toBe(2)
    expect(overview.bundledSkills).toBe(1)
    expect(overview.neverUsedCount).toBe(1)
    expect(overview.top5[0].name).toBe('commit')
  })

  test('handles empty data', () => {
    const overview = generateOverview([], [])
    expect(overview.totalSkills).toBe(0)
    expect(overview.totalCalls).toBe(0)
    expect(overview.top5).toEqual([])
    expect(overview.insights.length).toBe(1)
    expect(overview.insights[0].type).toBe('onboarding')
  })
})

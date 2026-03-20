/**
 * Aggregate stats: merge skill invocation records + skill metadata (聚合统计数据：将 skill 调用记录 + skill 元数据合并)
 */

/**
 * Generate stats from invocation records (从调用记录生成统计)
 * @param {Array} calls - Invocation records output by history-parser (history-parser 输出的调用记录)
 * @returns {Record<string, SkillStats>} skillName -> stats
 */
function aggregateStats(calls) {
  const statsMap = {};

  for (const call of calls) {
    const key = call.skillName;
    if (!statsMap[key]) {
      statsMap[key] = {
        totalCalls: 0,
        lastUsed: null,
        firstUsed: null,
        callsByDate: {},
        callsByProject: {},
        callsByHour: new Array(24).fill(0),
      };
    }

    const s = statsMap[key];
    s.totalCalls++;

    const ts = call.timestamp;
    if (!s.lastUsed || ts > s.lastUsed) s.lastUsed = ts;
    if (!s.firstUsed || ts < s.firstUsed) s.firstUsed = ts;

    // Aggregate by date (按日期聚合)
    const date = new Date(ts).toISOString().slice(0, 10);
    s.callsByDate[date] = (s.callsByDate[date] || 0) + 1;

    // Aggregate by project (按项目聚合)
    if (call.project) {
      s.callsByProject[call.project] = (s.callsByProject[call.project] || 0) + 1;
    }

    // Aggregate by hour (按小时聚合)
    const hour = new Date(ts).getHours();
    s.callsByHour[hour]++;
  }

  return statsMap;
}

/**
 * Merge stats into skill list (将统计数据合并到 skill 列表中)
 */
function mergeStatsToSkills(skills, statsMap) {
  for (const skill of skills) {
    const stats = statsMap[skill.name] || {
      totalCalls: 0,
      lastUsed: null,
      firstUsed: null,
      callsByDate: {},
      callsByProject: {},
      callsByHour: new Array(24).fill(0),
    };
    skill.stats = stats;
  }
  return skills;
}

/**
 * Generate overview data (生成总览数据)
 */
function generateOverview(allSkills, calls) {
  // Only count locally available skills (bundled + custom), exclude uninstalled marketplace ones (只统计本地可用的技能（bundled + custom），排除 marketplace 未安装的)
  const skills = allSkills.filter(s => s.source === 'bundled' || s.source === 'custom');
  const skillNames = new Set(skills.map(s => s.name.toLowerCase()));

  // Only count invocations belonging to local skills (只统计属于本地技能的调用)
  const relevantCalls = calls.filter(c => skillNames.has(c.skillName));

  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

  const recentCalls = relevantCalls.filter(c => c.timestamp > sevenDaysAgo);
  const recentSkills = new Set(recentCalls.map(c => c.skillName));

  // Top skills
  const sorted = [...skills]
    .filter(s => s.stats && s.stats.totalCalls > 0)
    .sort((a, b) => b.stats.totalCalls - a.stats.totalCalls);

  // Never-used skills (exclude built-in, only count custom) (从未使用的 skill（排除内置命令，只统计自建的）)
  const neverUsed = skills.filter(s => s.source !== 'bundled' && (!s.stats || s.stats.totalCalls === 0));

  // Power skill (percentage of total calls) (主力技能（占总调用的百分比）)
  const totalCalls = relevantCalls.length;
  let mainSkill = null;
  if (sorted.length > 0 && totalCalls > 0) {
    const top = sorted[0];
    mainSkill = {
      name: top.name,
      calls: top.stats.totalCalls,
      percentage: Math.round(top.stats.totalCalls / totalCalls * 100),
    };
  }

  // New skills tried this week (本周新尝试的 skill)
  const allTimeSkills = new Set(relevantCalls.filter(c => c.timestamp <= sevenDaysAgo).map(c => c.skillName));
  const newThisWeek = [...recentSkills].filter(s => !allTimeSkills.has(s));

  return {
    totalSkills: skills.length,
    totalCalls,
    customSkills: skills.filter(s => s.source === 'custom').length,
    bundledSkills: skills.filter(s => s.source === 'bundled').length,
    top5: sorted.slice(0, 5).map(s => ({
      id: s.id,
      name: s.name,
      calls: s.stats.totalCalls,
      source: s.source,
    })),
    recentActiveCount: recentSkills.size,
    neverUsedCount: neverUsed.length,
    mainSkill,
    newThisWeek,
    insights: generateInsights(skills, calls, mainSkill, neverUsed, newThisWeek),
  };
}

/**
 * Generate insight cards data (生成洞察卡片数据)
 */
function generateInsights(skills, calls, mainSkill, neverUsed, newThisWeek) {
  const insights = [];

  if (mainSkill) {
    insights.push({
      type: 'main-skill',
      name: mainSkill.name,
      pct: mainSkill.percentage,
      text: `Your power skill: /${mainSkill.name} (${mainSkill.percentage}% of all calls)`,
    });
  }

  if (neverUsed.length > 0) {
    insights.push({
      type: 'never-used',
      count: neverUsed.length,
      text: `${neverUsed.length} skills never used — consider removing them`,
    });
  }

  if (newThisWeek.length > 0) {
    insights.push({
      type: 'new-this-week',
      skills: newThisWeek.map(s => '/' + s).join(', '),
      text: `New this week: ${newThisWeek.map(s => '/' + s).join(', ')}`,
    });
  }

  if (calls.length === 0) {
    insights.push({
      type: 'onboarding',
      text: "You haven't used any skills yet — try these popular ones",
    });
  }

  return insights;
}

module.exports = { aggregateStats, mergeStatsToSkills, generateOverview };

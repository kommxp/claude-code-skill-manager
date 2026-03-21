/**
 * discover/index.js — Auto-discover, auto-grow, auto-maintain Skill index engine (自动发现、自动增长、自动维护的 Skill 索引引擎)
 *
 * Design principles (设计原则):
 *   - Zero-config: works on startup, no token/username needed (零配置：启动即工作)
 *   - Auto-grow: background periodic GitHub search (自增长：后台定时搜索)
 *   - Auto-maintain: auto-clean archived/404 repos (自维护：自动清理归档仓库)
 *   - Low-resource: smart scheduling, use cache when available (低资源：智能调度，优先缓存)
 */

const fs = require('fs');
const { ONLINE_CACHE, OVERRIDES_FILE } = require('../../utils/paths');
const { getRateRemaining } = require('./github-api');
const { migrateCategory } = require('./categories');
const { fetchAllMarketplaces, fetchAllCommunitySkills, fetchAwesomeLists, fetchNpmSkills, fetchAggregatedRepos } = require('./sources');

// Constants (常量)
const REFRESH_INTERVAL = 6 * 60 * 60 * 1000;  // Auto-refresh every 6 hours (6 小时自动刷新)
const MIN_REFRESH_GAP  = 10 * 60 * 1000;       // Min manual refresh interval 10 min (手动刷新最短间隔)
const STALE_DAYS       = 365;                   // Mark community skills as stale if not updated for 365 days (标记 stale 天数)

// Runtime state (运行时状态)
let indexCache = null;
let refreshTimer = null;
let isRefreshing = false;
let lastRefreshAt = 0;

// ============================================================
// Public API (对外接口)
// ============================================================

function startIndexEngine(githubToken) {
  indexCache = loadDiskCache();
  if (indexCache && indexCache.skills.length > 0) {
    console.log(`[discover] Local cache loaded: ${indexCache.skills.length} skills`);
  }

  setTimeout(() => {
    refreshIndex(githubToken).catch(e => {
      console.log(`[discover] Background refresh failed (using cache): ${e.message}`);
    });
  }, 5000);

  refreshTimer = setInterval(() => {
    refreshIndex(githubToken).catch(e => {
      console.log(`[discover] Periodic refresh failed: ${e.message}`);
    });
  }, REFRESH_INTERVAL);

  if (refreshTimer.unref) refreshTimer.unref();
  console.log(`[discover] Index engine started (auto-refresh every ${REFRESH_INTERVAL / 3600000}h)`);
}

async function getOnlineSkills(githubToken, forceRefresh = false) {
  if (forceRefresh) {
    const now = Date.now();
    if (now - lastRefreshAt < MIN_REFRESH_GAP) {
      console.log('[discover] Refresh interval too short, skipping');
    } else {
      await refreshIndex(githubToken);
    }
  }

  if (indexCache && indexCache.skills.length > 0) {
    return indexCache.skills;
  }

  return [];
}

function getCategories(skills) {
  const cats = {};
  for (const s of skills) {
    const c = migrateCategory(s.category || 'other');
    cats[c] = (cats[c] || 0) + 1;
  }
  return Object.entries(cats)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

function markInstalled(onlineSkills, localSkills) {
  const customNames = new Set(
    localSkills
      .filter(s => s.source === 'custom')
      .map(s => s.name.toLowerCase())
  );

  const installedPluginUrls = new Set(
    localSkills
      .filter(s => s.source === 'plugin' && s.repoUrl)
      .map(s => s.repoUrl.toLowerCase().replace(/\/+$/, ''))
  );

  const installedPluginNames = new Set(
    localSkills
      .filter(s => s.source === 'plugin')
      .map(s => s.name.toLowerCase())
  );

  return onlineSkills.map(s => {
    let installed = false;

    if (s.repoUrl && installedPluginUrls.has(s.repoUrl.toLowerCase().replace(/\/+$/, ''))) {
      installed = true;
    } else if (installedPluginNames.has(s.name.toLowerCase())) {
      installed = true;
    } else if (customNames.has(s.name.toLowerCase())) {
      installed = true;
    }

    return { ...s, installed };
  });
}

// ============================================================
// Core: incremental index refresh (核心：增量刷新索引)
// ============================================================

async function refreshIndex(githubToken) {
  if (isRefreshing) {
    console.log('[discover] Refresh already in progress, skipping');
    return;
  }

  isRefreshing = true;
  lastRefreshAt = Date.now();
  const startTime = Date.now();

  try {
    console.log('[discover] Starting index refresh...');
    const overrides = loadOverrides();
    const oldSkills = (indexCache && indexCache.skills) || [];

    console.log(`[discover] API remaining quota: ${getRateRemaining()}`);

    const [marketplaceResult, communityResult, awesomeResult, npmResult, aggregatedResult] = await Promise.allSettled([
      fetchAllMarketplaces(githubToken, overrides, oldSkills),
      fetchAllCommunitySkills(githubToken),
      fetchAwesomeLists(githubToken),
      fetchNpmSkills(),
      fetchAggregatedRepos(githubToken),
    ]);

    const marketplaceSkills = marketplaceResult.status === 'fulfilled' ? marketplaceResult.value : [];
    const communitySkills = communityResult.status === 'fulfilled' ? communityResult.value : [];
    const awesomeSkills = awesomeResult.status === 'fulfilled' ? awesomeResult.value : [];
    const npmSkills = npmResult.status === 'fulfilled' ? npmResult.value : [];
    const aggregatedSkills = aggregatedResult.status === 'fulfilled' ? aggregatedResult.value : [];

    if (marketplaceResult.status === 'rejected') console.log(`[discover] Marketplace error: ${marketplaceResult.reason?.message}`);
    if (communityResult.status === 'rejected') console.log(`[discover] Community search error: ${communityResult.reason?.message}`);
    if (awesomeResult.status === 'rejected') console.log(`[discover] Awesome lists error: ${awesomeResult.reason?.message}`);
    if (npmResult.status === 'rejected') console.log(`[discover] npm error: ${npmResult.reason?.message}`);
    if (aggregatedResult.status === 'rejected') console.log(`[discover] Aggregated repos error: ${aggregatedResult.reason?.message}`);

    const allCommunity = [...communitySkills, ...awesomeSkills, ...npmSkills, ...aggregatedSkills];
    const merged = mergeSkillsIncremental(oldSkills, marketplaceSkills, allCommunity);

    console.log(`[discover] Source stats — marketplace: ${marketplaceSkills.length}, community: ${communitySkills.length}, awesome: ${awesomeSkills.length}, npm: ${npmSkills.length}, aggregated: ${aggregatedSkills.length}`);

    const maintained = autoMaintain(merged);
    scoreAndSort(maintained);

    indexCache = {
      timestamp: Date.now(),
      generatedAt: new Date().toISOString(),
      skills: maintained,
    };

    saveDiskCache(indexCache);

    const elapsed = Date.now() - startTime;
    console.log(`[discover] Refresh complete (${elapsed}ms): ${maintained.length} skills (marketplace: ${marketplaceSkills.length}, community: ${communitySkills.length})`);
  } catch (e) {
    console.error(`[discover] Refresh failed: ${e.message}`);
  } finally {
    isRefreshing = false;
  }
}

// ============================================================
// Incremental merge & dedup (增量合并 & 去重)
// ============================================================

function mergeSkillsIncremental(oldSkills, newMarketplace, newCommunity) {
  const map = new Map();

  for (const s of oldSkills) {
    if (!s.sourceType) {
      s.sourceType = (s.source === 'community') ? 'community' : 'marketplace';
    }
    if (s.category) s.category = migrateCategory(s.category);
    map.set(makeKey(s), s);
  }

  for (const s of newMarketplace) {
    map.set(makeKey(s), s);
  }

  for (const s of newCommunity) {
    const key = makeKey(s);
    if (!map.has(key)) {
      map.set(key, s);
    } else {
      const existing = map.get(key);
      if (s.repoStars > (existing.repoStars || 0)) existing.repoStars = s.repoStars;
      if (s.pushedAt && (!existing.pushedAt || s.pushedAt > existing.pushedAt)) existing.pushedAt = s.pushedAt;
      if (s.description && s.description !== s.name.replace(/-/g, ' ')) existing.description = s.description;
    }
  }

  return Array.from(map.values());
}

function makeKey(skill) {
  if (skill.repoUrl) {
    const match = skill.repoUrl.match(/github\.com\/([^/]+\/[^/]+)/);
    if (match) {
      return `${match[1].toLowerCase()}/${skill.name.toLowerCase()}`;
    }
  }
  return skill.name.toLowerCase();
}

// ============================================================
// Auto-maintain (自动维护)
// ============================================================

function autoMaintain(skills) {
  const now = Date.now();
  const staleThreshold = STALE_DAYS * 24 * 60 * 60 * 1000;

  return skills.filter(s => {
    if (s.sourceType === 'community' && s.pushedAt) {
      const age = now - new Date(s.pushedAt).getTime();
      if (age > staleThreshold) {
        s.stale = true;
      }
    }
    return true;
  });
}

// ============================================================
// Scoring & sorting (评分 & 排序)
// ============================================================

const TRUST_BONUS = { official: 30, trusted: 15, unverified: 0 };
const RECENCY_THRESHOLDS = [
  { days: 30, score: 10 },
  { days: 90, score: 5 },
  { days: 365, score: 2 },
];

function scoreAndSort(skills) {
  const now = Date.now();

  for (const s of skills) {
    const starScore = Math.log2((s.repoStars || 0) + 1) * 5;
    const trust = TRUST_BONUS[s.trustLevel] || 0;

    let recency = 0;
    if (s.pushedAt) {
      const daysAgo = (now - new Date(s.pushedAt).getTime()) / (1000 * 60 * 60 * 24);
      for (const t of RECENCY_THRESHOLDS) {
        if (daysAgo < t.days) { recency = t.score; break; }
      }
    }

    const stalePenalty = s.stale ? -10 : 0;
    s.score = Math.round((starScore + trust + recency + stalePenalty) * 10) / 10;
  }

  skills.sort((a, b) => b.score - a.score);
}

// ============================================================
// Disk cache & overrides (磁盘缓存 & 覆盖)
// ============================================================

function loadDiskCache() {
  if (!fs.existsSync(ONLINE_CACHE)) return null;
  try {
    const cache = JSON.parse(fs.readFileSync(ONLINE_CACHE, 'utf-8'));
    if (cache && cache.skills) {
      for (const s of cache.skills) {
        if (!s.sourceType) {
          s.sourceType = (s.source === 'community') ? 'community' : 'marketplace';
        }
      }
    }
    return cache;
  } catch {
    return null;
  }
}

function saveDiskCache(data) {
  try {
    fs.writeFileSync(ONLINE_CACHE, JSON.stringify(data), 'utf-8');
  } catch (e) {
    console.error(`[discover] Cache write failed: ${e.message}`);
  }
}

function loadOverrides() {
  if (!fs.existsSync(OVERRIDES_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(OVERRIDES_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

module.exports = { startIndexEngine, getOnlineSkills, getCategories, markInstalled };

/**
 * discover.js — Auto-discover, auto-grow, auto-maintain Skill index engine (自动发现、自动增长、自动维护的 Skill 索引引擎)
 *
 * Design principles (设计原则):
 *   - Zero-config: works on startup, no token/username needed (零配置：启动即工作，不需要用户填 token/用户名)
 *   - Auto-grow: background periodic GitHub search, auto-include new skills (自增长：后台定时搜索 GitHub，自动纳入新 skill)
 *   - Auto-maintain: auto-clean archived/404 repos, auto-update metadata (自维护：自动清理归档/404 仓库，自动更新元数据)
 *   - Low-resource: smart scheduling, use cache when available; batch requests to avoid hitting limits (低资源：智能调度，有缓存就不急着调 API；按需分批，不一次打满限额)
 *
 * Data flow (数据流):
 *   Startup -> load local cache (instant availability) (启动 → 读本地缓存（瞬间可用）)
 *          -> background silent incremental fetch (non-blocking) (→ 后台静默拉取增量（不阻塞用户）)
 *          -> timer auto-refresh every 6h (→ 定时器每 6h 自动刷新)
 *          -> incremental merge each time, no old data lost (→ 每次增量合并，不丢失旧数据)
 */

const fs = require('fs');
const https = require('https');
const { ONLINE_CACHE, OVERRIDES_FILE } = require('../utils/paths');

// ============================================================
// Config (配置)
// ============================================================
const REFRESH_INTERVAL = 6 * 60 * 60 * 1000;  // Auto-refresh every 6 hours (6 小时自动刷新)
const MIN_REFRESH_GAP  = 10 * 60 * 1000;       // Min manual refresh interval 10 min (手动刷新最短间隔 10 分钟)
const SEARCH_DELAY     = 3000;                  // Search request interval (ms) to avoid rate limiting (搜索请求间隔（ms），避免限流)
const STALE_DAYS       = 365;                   // Mark community skills as stale if not updated for 365 days (超过 365 天未更新的社区 skill 标记为 stale)

// Known trusted marketplace repos (已知的可信 marketplace 仓库)
const MARKETPLACE_SOURCES = [
  {
    name: 'claude-plugins-official',
    owner: 'anthropics',
    repo: 'claude-plugins-official',
    trustLevel: 'official',
    path: 'plugins',
    externalPath: 'external_plugins',
  },
  {
    name: 'anthropics-skills',
    owner: 'anthropics',
    repo: 'skills',
    trustLevel: 'official',
    path: 'skills',
  },
  {
    name: 'trailofbits-skills',
    owner: 'trailofbits',
    repo: 'skills',
    trustLevel: 'trusted',
    path: 'plugins',
  },
];

// Awesome Lists & aggregation repos — all discovered via search, no hardcoding (Awesome Lists & 聚合仓库 — 全部通过搜索自动发现，不再硬编码)
// Keywords for searching awesome lists (搜索 awesome 列表的关键词)
const AWESOME_SEARCH_QUERIES = [
  'awesome-claude-code in:name',
  'awesome-claude-skills in:name',
  'awesome-claude-plugins in:name',
  'awesome-claude-code-subagents in:name',
];

// Keywords for searching aggregation repos (repos containing many skill directories) (搜索聚合仓库的关键词（包含大量 skill 目录的集合型仓库）)
const AGGREGATED_SEARCH_QUERIES = [
  'claude-code-skills in:name',
  'claude-code-plugins in:name',
  'claude-skills in:name stars:>5',
  'claude-code-toolkit in:name',
  'agent-skills claude in:name,description',
];

// npm search keywords (npm 搜索关键词)
const NPM_QUERIES = [
  'claude-code-skill',
  'claude-code skill',
  'claude-skill',
];

// Community search keywords (auto-discovered sources, more = broader) (社区搜索关键词（自动发现的来源，越多越广）)
const COMMUNITY_QUERIES = [
  // Topic search — most precise (topic 搜索 — 最精准)
  'topic:claude-code-skill',
  'topic:claude-code-plugin',
  'topic:claude-code-skills',
  'topic:claude-skill',
  'topic:claude-code-commands',
  'topic:claude-code-hooks',
  'topic:anthropic-skill',
  // Name/description keywords — covers repos without topics (名称/描述关键词 — 覆盖没打 topic 的)
  'claude-code skill in:name,description',
  'claude-code plugin in:name,description',
  'claude skill in:name',
  'claude-code hook in:name',
  // File signatures — discover via key files in repos (文件特征 — 通过仓库内关键文件发现)
  'filename:SKILL.md path:/',
  'filename:skill.md path:.claude',
  'path:.claude/commands',
  'path:.claude/skills',
];

// Excluded repos (not skills) (排除的仓库（不是 skill）)
const EXCLUDE_REPOS = new Set([
  'anthropics/claude-plugins-official',
  'trailofbits/skills',
  'trailofbits/skills-curated',
  'anthropics/courses',
  'anthropics/claude-code',
]);

// ============================================================
// Runtime state (运行时状态)
// ============================================================
let indexCache = null;     // { timestamp, skills[], generatedAt }
let refreshTimer = null;   // Timer reference (定时器引用)
let isRefreshing = false;  // Prevent concurrent refresh (防止并发刷新)
let lastRefreshAt = 0;     // Last refresh time (上次刷新时间)

// API rate limit tracking (API 限额追踪)
let rateRemaining = 60;    // Remaining available requests (剩余可用次数)
let rateResetAt = 0;       // Rate limit reset time (Unix ms) (限额重置时间（Unix ms）)

// ============================================================
// Public API (对外接口)
// ============================================================

/**
 * Start index engine (called once at server startup) (启动索引引擎（server 启动时调用一次）)
 * - Load local cache (读本地缓存)
 * - Background silent incremental fetch (后台静默拉取增量)
 * - Start timer (启动定时器)
 */
function startIndexEngine(githubToken) {
  // 1. Load local cache -> instant availability (读本地缓存 → 立即可用)
  indexCache = loadDiskCache();
  if (indexCache && indexCache.skills.length > 0) {
    console.log(`[discover] Local cache loaded: ${indexCache.skills.length} skills`);
  }

  // 2. Background silent fetch (non-blocking startup) (后台静默拉取（不阻塞启动）)
  setTimeout(() => {
    refreshIndex(githubToken).catch(e => {
      console.log(`[discover] Background refresh failed (using cache): ${e.message}`);
    });
  }, 5000); // Delay 5s, wait for service to stabilize (延迟 5 秒，等服务稳定)

  // 3. Periodic auto-refresh (定时自动刷新)
  refreshTimer = setInterval(() => {
    refreshIndex(githubToken).catch(e => {
      console.log(`[discover] Periodic refresh failed: ${e.message}`);
    });
  }, REFRESH_INTERVAL);

  // Don't let the timer prevent process exit (不让定时器阻止进程退出)
  if (refreshTimer.unref) refreshTimer.unref();

  console.log(`[discover] Index engine started (auto-refresh every ${REFRESH_INTERVAL / 3600000}h)`);
}

/**
 * Get online skill list (for routes, instant return) (获取在线 skill 列表（给路由用，瞬间返回）)
 */
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

/**
 * Get all categories (获取所有分类)
 */
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

/**
 * Mark installed status (标注已安装状态)
 *
 * Matching strategy (to resolve name conflicts) (匹配策略（解决重名问题）):
 *   - Bundled commands don't participate in matching (built-in commands aren't installed online) (bundled 命令不参与匹配（内置命令不是从在线安装的）)
 *   - Custom skills match by user-created skill name only (custom skill 只按用户自建的 skill name 匹配)
 *   - Plugin-sourced skills match by plugin repo URL (most precise) (plugin 来源的 skill 按 plugin 仓库 URL 匹配（最精确）)
 */
function markInstalled(onlineSkills, localSkills) {
  // Only collect custom skill names from user-created skills (只收集用户自建的 custom skill 名称)
  const customNames = new Set(
    localSkills
      .filter(s => s.source === 'custom')
      .map(s => s.name.toLowerCase())
  );

  // Collect installed plugin repo URLs (exact match) (收集已安装 plugin 的仓库 URL（精确匹配）)
  const installedPluginUrls = new Set(
    localSkills
      .filter(s => s.source === 'plugin' && s.repoUrl)
      .map(s => s.repoUrl.toLowerCase().replace(/\/+$/, ''))
  );

  // Collect installed plugin directory names under plugins/marketplaces (收集 plugins/marketplaces 下已安装的 plugin 目录名)
  const installedPluginNames = new Set(
    localSkills
      .filter(s => s.source === 'plugin')
      .map(s => s.name.toLowerCase())
  );

  return onlineSkills.map(s => {
    let installed = false;

    // 1. Exact match by repoUrl (most reliable) (按 repoUrl 精确匹配（最可靠）)
    if (s.repoUrl && installedPluginUrls.has(s.repoUrl.toLowerCase().replace(/\/+$/, ''))) {
      installed = true;
    }
    // 2. Match by installed plugin name (按已安装 plugin 名匹配)
    else if (installedPluginNames.has(s.name.toLowerCase())) {
      installed = true;
    }
    // 3. Match by custom skill name (excluding bundled) (按自建 skill 名匹配（不包括 bundled）)
    else if (customNames.has(s.name.toLowerCase())) {
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

    console.log(`[discover] API remaining quota: ${rateRemaining}`);

    // Fetch all data sources in parallel (any failure doesn't affect others) (并行拉取所有数据源（任何一方失败都不影响其它）)
    const [marketplaceResult, communityResult, awesomeResult, npmResult, aggregatedResult] = await Promise.allSettled([
      fetchAllMarketplaces(githubToken, overrides),
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

    // Incremental merge: newly discovered + old cache, never lose previous data (增量合并：新发现的 + 旧缓存，不丢失之前发现的)
    const oldSkills = (indexCache && indexCache.skills) || [];
    const allCommunity = [...communitySkills, ...awesomeSkills, ...npmSkills, ...aggregatedSkills];
    const merged = mergeSkillsIncremental(oldSkills, marketplaceSkills, allCommunity);

    console.log(`[discover] Source stats — marketplace: ${marketplaceSkills.length}, community: ${communitySkills.length}, awesome: ${awesomeSkills.length}, npm: ${npmSkills.length}, aggregated: ${aggregatedSkills.length}`);

    // Auto-maintain: mark stale, remove archived (自动维护：标记 stale、移除归档)
    const maintained = autoMaintain(merged);

    // Score and sort (评分排序)
    scoreAndSort(maintained);

    // Update in-memory cache (更新内存缓存)
    indexCache = {
      timestamp: Date.now(),
      generatedAt: new Date().toISOString(),
      skills: maintained,
    };

    // Persist to disk (持久化到磁盘)
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
// Data source 1: Marketplace repos (数据来源 1：Marketplace 仓库)
// ============================================================

async function fetchAllMarketplaces(token, overrides) {
  const allSkills = [];
  const oldSkills = (indexCache && indexCache.skills) || [];

  for (const source of MARKETPLACE_SOURCES) {
    try {
      const skills = await fetchMarketplace(source, token, overrides);
      allSkills.push(...skills);
    } catch (e) {
      console.log(`[discover] ${source.name} fetch failed: ${e.message}, keeping old data`);
      // On failure, keep old cached data for this source (失败时保留旧缓存中该来源的数据)
      allSkills.push(...oldSkills.filter(s => s.source === source.name));
    }
  }

  return allSkills;
}

/**
 * Scan skills from a Marketplace repo (从 Marketplace 仓库扫描 skill)
 *
 * Generic recognition mechanism (no hardcoded directory depth) (通用识别机制（不写死目录深度）):
 * 1. Use Trees API to get complete file tree in one request (recursive=1) (用 Trees API 一次请求获取完整文件树（recursive=1）)
 * 2. Find all SKILL.md / skill.md files (找所有 SKILL.md / skill.md 文件)
 * 3. Infer skill name and repo path from file path (从路径反推 skill 名称和仓库内路径)
 * 4. If no SKILL.md found, fall back to one-level directory scan (如果没找到任何 SKILL.md，回退到一层目录扫描)
 */
async function fetchMarketplace(source, token, overrides = {}) {
  let repoMeta = { stars: 0, pushedAt: null, topics: [] };
  try {
    const repo = await githubGet(`https://api.github.com/repos/${source.owner}/${source.repo}`, token);
    if (repo) {
      repoMeta = { stars: repo.stargazers_count || 0, pushedAt: repo.pushed_at, topics: repo.topics || [] };
    }
  } catch {}

  const skills = [];
  const fullName = `${source.owner}/${source.repo}`;

  // Method 1: Trees API recursive scan for SKILL.md (方式 1：Trees API 递归扫描，找 SKILL.md)
  try {
    const treeData = await githubGet(
      `https://api.github.com/repos/${fullName}/git/trees/main?recursive=1`,
      token
    );

    if (treeData && treeData.tree) {
      const skillFiles = treeData.tree.filter(f =>
        f.type === 'blob' && /^(.+\/)?SKILL\.md$/i.test(f.path)
      );

      if (skillFiles.length > 0) {
        for (const file of skillFiles) {
          // Extract from "r-lib/r-package-development/SKILL.md":
          //   dirPath = "r-lib/r-package-development"
          //   name = "r-package-development"
          const dirPath = file.path.replace(/\/SKILL\.md$/i, '');
          const parts = dirPath.split('/');
          const name = parts[parts.length - 1];

          // Skip root-level SKILL.md (not an independent skill) (跳过根目录的 SKILL.md（不是独立 skill）)
          if (!dirPath.includes('/') && dirPath.toLowerCase() === 'skill.md') continue;

          const override = overrides[name] || {};
          skills.push({
            name,
            description: override.description || name.replace(/-/g, ' '),
            source: source.name,
            sourceType: 'marketplace',
            repoUrl: `https://github.com/${fullName}/tree/main/${dirPath}`,
            repoStars: repoMeta.stars,
            pushedAt: repoMeta.pushedAt,
            category: override.category || inferCategory(name, override.description || ''),
            tags: override.tags || [],
            keywords: override.keywords || [],
            trustLevel: source.trustLevel,
            version: null,
            installed: false,
          });
        }

        console.log(`[discover] Trees API "${fullName}": found ${skills.length} SKILL.md`);
        return skills;
      }
    }
  } catch (e) {
    console.log(`[discover] Trees API "${fullName}" failed: ${e.message}, falling back to directory scan`);
  }

  // Method 2: Fallback — one-level directory scan (legacy compatibility) (方式 2：回退 — 一层目录扫描（旧逻辑兼容）)
  const scanPath = source.path || '';
  const dirs = await fetchDirListFallback(source.owner, source.repo, scanPath, token);
  for (const name of dirs) {
    const override = overrides[name] || {};
    skills.push({
      name,
      description: override.description || name.replace(/-/g, ' '),
      source: source.name,
      sourceType: 'marketplace',
      repoUrl: `https://github.com/${fullName}/tree/main${scanPath ? '/' + scanPath : ''}/${name}`,
      repoStars: repoMeta.stars,
      pushedAt: repoMeta.pushedAt,
      category: override.category || inferCategory(name, override.description || ''),
      tags: override.tags || [],
      keywords: override.keywords || [],
      trustLevel: source.trustLevel,
      version: null,
      installed: false,
    });
  }

  // Method 2b: external directory (claude-plugins-official only) (方式 2b：external 目录（仅 claude-plugins-official）)
  if (source.externalPath) {
    try {
      const extDirs = await fetchDirListFallback(source.owner, source.repo, source.externalPath, token);
      for (const name of extDirs) {
        const override = overrides[name] || {};
        skills.push({
          name,
          description: override.description || name.replace(/-/g, ' '),
          source: source.name,
          sourceType: 'marketplace',
          repoUrl: `https://github.com/${fullName}/tree/main/${source.externalPath}/${name}`,
          repoStars: repoMeta.stars,
          pushedAt: repoMeta.pushedAt,
          category: override.category || inferCategory(name, override.description || ''),
          tags: override.tags || [],
          keywords: override.keywords || [],
          trustLevel: source.trustLevel,
          version: null,
          installed: false,
        });
      }
    } catch {}
  }

  return skills;
}

/** Fallback: one-level directory scan (回退方式：一层目录扫描) */
async function fetchDirListFallback(owner, repo, dirPath, token) {
  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${dirPath}`;
    const items = await githubGet(url, token);
    if (!Array.isArray(items)) return [];
    const exclude = new Set(['.github', '.git', 'docs', 'scripts', '.claude-plugin', 'node_modules', 'spec', 'template', 'templates', 'examples', 'assets', 'src', 'lib', 'test', 'tests', '.vscode', 'dist', 'build']);
    return items.filter(d => d.type === 'dir' && !exclude.has(d.name)).map(d => d.name);
  } catch {
    return [];
  }
}

// ============================================================
// Data source 2: Community auto-discover (three-layer search) (数据来源 2：社区自动发现（三层搜索）)
// ============================================================

async function fetchAllCommunitySkills(token) {
  const seen = new Set();
  const skills = [];

  // -- Layer 1: keyword & topic search (most important, consume quota first) (第一层：关键词 & topic 搜索（最重要，优先消耗限额）) --
  for (const q of COMMUNITY_QUERIES) {
    if (!hasQuota(5)) {
      console.log(`[discover] Insufficient quota (${rateRemaining}), layer 1 ending early, found ${skills.length}`);
      break;
    }
    await searchAndCollect(q, 'repo', token, seen, skills);
    await sleep(SEARCH_DELAY);
  }
  console.log(`[discover] Layer 1 (keywords) complete: ${skills.length}`);

  // -- Layer 2: file signature search (code search API) (第二层：文件特征搜索（代码搜索 API）) --
  if (hasQuota(10)) {
    const fileQueries = [
      { q: 'filename:SKILL.md', label: 'SKILL.md' },
      { q: '"claude_code" filename:skill.json', label: 'skill.json' },
      { q: '"allowed_tools" filename:CLAUDE.md path:.claude', label: '.claude/CLAUDE.md' },
    ];
    for (const { q, label } of fileQueries) {
      if (!hasQuota(5)) break;
      try {
        const url = `https://api.github.com/search/code?q=${encodeURIComponent(q)}&per_page=100`;
        const result = await githubGet(url, token);
        if (!result || !result.items) continue;

        const repoFullNames = new Set();
        for (const item of result.items) {
          if (item.repository) repoFullNames.add(item.repository.full_name);
        }

        for (const fullName of repoFullNames) {
          if (!hasQuota(3)) break;
          if (seen.has(fullName.toLowerCase()) || EXCLUDE_REPOS.has(fullName.toLowerCase())) continue;
          try {
            const repo = await githubGet(`https://api.github.com/repos/${fullName}`, token);
            if (repo && !repo.archived) {
              addRepoToSkills(repo, seen, skills, `file:${label}`);
            }
          } catch {}
        }
        console.log(`[discover] File signature "${label}": found ${repoFullNames.size} repos`);
      } catch (e) {
        console.log(`[discover] File search "${label}" failed: ${e.message}`);
      }
      await sleep(SEARCH_DELAY);
    }
  } else {
    console.log(`[discover] Insufficient quota (${rateRemaining}), skipping layer 2 (file signatures)`);
  }

  // -- Layer 3: network expansion (第三层：网络扩散) --
  if (hasQuota(8)) {
    const topOwners = getTopOwners(skills, 5);
    for (const owner of topOwners) {
      if (!hasQuota(3)) break;
      try {
        const url = `https://api.github.com/search/repositories?q=user:${encodeURIComponent(owner)}+topic:claude-code+topic:claude-skill+topic:skill&sort=stars&per_page=30`;
        const result = await githubGet(url, token);
        if (result && result.items) {
          for (const repo of result.items) {
            if (!repo.archived) addRepoToSkills(repo, seen, skills, `network:${owner}`);
          }
        }
      } catch (e) {
        console.log(`[discover] Network expansion "${owner}" failed: ${e.message}`);
      }
      await sleep(SEARCH_DELAY);
    }
  } else {
    console.log(`[discover] Insufficient quota (${rateRemaining}), skipping layer 3 (network expansion)`);
  }

  // -- Layer 4: fork discovery (第四层：fork 发现) --
  if (hasQuota(5)) {
    for (const source of MARKETPLACE_SOURCES) {
      if (!hasQuota(3)) break;
      try {
        const url = `https://api.github.com/repos/${source.owner}/${source.repo}/forks?sort=stargazers&per_page=20`;
        const forks = await githubGet(url, token);
        if (!Array.isArray(forks)) continue;

        for (const fork of forks) {
          if (fork.stargazers_count >= 3 && !fork.archived) {
            addRepoToSkills(fork, seen, skills, `fork:${source.name}`);
          }
        }
      } catch (e) {
        console.log(`[discover] Fork discovery "${source.name}" failed: ${e.message}`);
      }
      await sleep(SEARCH_DELAY);
    }
  } else {
    console.log(`[discover] Insufficient quota (${rateRemaining}), skipping layer 4 (forks)`);
  }

  console.log(`[discover] Community auto-discover total: ${skills.length}, API remaining: ${rateRemaining}`);
  skills.sort((a, b) => (b.repoStars || 0) - (a.repoStars || 0));
  return skills;
}

/**
 * Generic repo search + collect (通用仓库搜索 + 收集)
 */
async function searchAndCollect(query, type, token, seen, skills) {
  try {
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=100`;
    const result = await githubGet(url, token);
    if (!result || !result.items) return;

    for (const repo of result.items) {
      if (!repo.archived) addRepoToSkills(repo, seen, skills, `search:${query.slice(0, 30)}`);
    }
  } catch (e) {
    console.log(`[discover] Search "${query}" failed: ${e.message}`);
  }
}

/**
 * Add a GitHub repo object to skills list (auto-dedup) (把一个 GitHub repo 对象加入 skills 列表（自动去重）)
 */
function addRepoToSkills(repo, seen, skills, discoveredVia) {
  const fullName = repo.full_name.toLowerCase();
  if (seen.has(fullName) || EXCLUDE_REPOS.has(fullName)) return;
  seen.add(fullName);

  skills.push({
    name: repo.name,
    description: repo.description || repo.name.replace(/-/g, ' '),
    source: 'community',
    sourceType: 'community',
    repoUrl: repo.html_url,
    repoStars: repo.stargazers_count || 0,
    pushedAt: repo.pushed_at || null,
    category: inferCategoryFromTopics(repo.topics || [], repo.name, repo.description || ''),
    tags: (repo.topics || []).slice(0, 5),
    keywords: repo.topics || [],
    trustLevel: 'unverified',
    discoveredVia,
    version: null,
    installed: false,
  });
}

/**
 * Extract most frequent owners from discovered skills (excluding known marketplace owners) (从已发现的 skill 中提取出现频率最高的 owner（排除已知 marketplace owner）)
 */
function getTopOwners(skills, limit) {
  const marketplaceOwners = new Set(MARKETPLACE_SOURCES.map(s => s.owner.toLowerCase()));
  const ownerCount = {};

  for (const s of skills) {
    if (!s.repoUrl) continue;
    const match = s.repoUrl.match(/github\.com\/([^/]+)\//);
    if (!match) continue;
    const owner = match[1].toLowerCase();
    if (marketplaceOwners.has(owner)) continue;
    ownerCount[owner] = (ownerCount[owner] || 0) + 1;
  }

  return Object.entries(ownerCount)
    .filter(([, count]) => count >= 2) // Only expand owners with at least 2 skills (至少有 2 个 skill 的 owner 才扩散)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([owner]) => owner);
}

// ============================================================
// Incremental merge & dedup (增量合并 & 去重)
//   Core logic: old cache + new marketplace + new community = only add, never remove (核心逻辑：旧缓存 + 新 marketplace + 新社区 = 只增不减)
//   - marketplace: use new if updated, otherwise keep old (marketplace 有更新就用新的，否则保留旧的)
//   - community: append new discoveries, keep old ones (社区新发现的追加进去，旧的不丢)
//   - only removal condition: archive detection in autoMaintain (唯一移除条件：autoMaintain 里的归档检测)
// ============================================================

function mergeSkillsIncremental(oldSkills, newMarketplace, newCommunity) {
  const map = new Map();

  // 1. Add old cache first (baseline, ensure no loss), patch missing fields (先放旧缓存（保底，确保不丢），顺便修补旧数据缺失的字段)
  for (const s of oldSkills) {
    if (!s.sourceType) {
      s.sourceType = (s.source === 'community') ? 'community' : 'marketplace';
    }
    // Migrate old categories to new enum (迁移旧分类到新枚举)
    if (s.category) s.category = migrateCategory(s.category);
    map.set(makeKey(s), s);
  }

  // 2. New marketplace overrides old (marketplace data uses latest) (新 marketplace 覆盖旧的（marketplace 数据以最新为准）)
  for (const s of newMarketplace) {
    map.set(makeKey(s), s);
  }

  // 3. New community skills: only append, don't overwrite existing (新社区 skill：只追加，不覆盖已有的)
  for (const s of newCommunity) {
    const key = makeKey(s);
    if (!map.has(key)) {
      map.set(key, s);
    } else {
      // Already exists: update metadata (stars, pushedAt may have changed) (已存在：更新元数据（stars、pushedAt 可能变了）)
      const existing = map.get(key);
      if (s.repoStars > (existing.repoStars || 0)) existing.repoStars = s.repoStars;
      if (s.pushedAt && (!existing.pushedAt || s.pushedAt > existing.pushedAt)) existing.pushedAt = s.pushedAt;
      if (s.description && s.description !== s.name.replace(/-/g, ' ')) existing.description = s.description;
    }
  }

  return Array.from(map.values());
}

/**
 * Generate dedup key: dedup same-name within same repo, keep across repos (生成去重 key：同一仓库内同名去重，不同仓库保留)
 *
 * key = "repo/skillName", so that (key = "仓库名/skill名"，这样):
 * - Same repo: planned-skills/foo and skills/foo -> same key -> dedup (同仓库内 planned-skills/foo 和 skills/foo → 同一个 key → 去重)
 * - Different repos with same name -> different key -> keep (不同仓库的同名 skill → 不同 key → 保留)
 */
function makeKey(skill) {
  // Extract repo name (owner/repo) from repoUrl (从 repoUrl 提取仓库名（owner/repo）)
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
    // Mark long-inactive community skills (don't remove, just downrank) (标记长期未更新的社区 skill（但不移除，降权即可）)
    if (s.sourceType === 'community' && s.pushedAt) {
      const age = now - new Date(s.pushedAt).getTime();
      if (age > staleThreshold) {
        s.stale = true;
      }
    }
    return true; // Keep all, downrank via scoring (保留所有，通过评分降权)
  });
}

// ============================================================
// Scoring & sorting (评分 & 排序)
// ============================================================

function scoreAndSort(skills) {
  const trustBonus = { official: 30, trusted: 15, unverified: 0 };
  const now = Date.now();

  for (const s of skills) {
    const starScore = Math.log2((s.repoStars || 0) + 1) * 5;
    const trust = trustBonus[s.trustLevel] || 0;

    let recency = 0;
    if (s.pushedAt) {
      const daysAgo = (now - new Date(s.pushedAt).getTime()) / (1000 * 60 * 60 * 24);
      if (daysAgo < 30) recency = 10;
      else if (daysAgo < 90) recency = 5;
      else if (daysAgo < 365) recency = 2;
    }

    const stalePenalty = s.stale ? -10 : 0;
    s.score = Math.round((starScore + trust + recency + stalePenalty) * 10) / 10;
  }

  skills.sort((a, b) => b.score - a.score);
}

// ============================================================
// Category inference (分类推断)
// ============================================================

// Old category -> new category mapping (旧分类 → 新分类映射)
const OLD_TO_NEW_CATEGORY = {
  'code-review': 'development',
  'language-support': 'development',
  'git-workflow': 'devops',
  'output-style': 'documentation',
  'setup': 'devops',
  'integration': 'automation',
  'frontend': 'design-creative',
};

function migrateCategory(cat) {
  return OLD_TO_NEW_CATEGORY[cat] || cat;
}

function inferCategory(name, desc) {
  const text = `${name} ${desc}`.toLowerCase();
  if (/security|audit|vuln|exploit|cve|sast|seatbelt|zeroize|insecure|supply.chain|pentest|forensic/.test(text)) return 'security';
  if (/test|spec|coverage|property.based|variant|e2e|unittest/.test(text)) return 'testing';
  if (/devops|ci\/cd|deploy|docker|kubernetes|container|infra|terraform|ansible|helm/.test(text)) return 'devops';
  if (/ai|ml|machine.learning|llm|agent|embedding|nlp|model|prompt/.test(text)) return 'ai-ml';
  if (/data|analytics|csv|sql|database|etl|visualization|pandas|excel|spreadsheet/.test(text)) return 'data-analytics';
  if (/market|seo|ads|campaign|growth|content.market|copywrit/.test(text)) return 'marketing-seo';
  if (/product|prd|roadmap|okr|user.research|requirement/.test(text)) return 'product-management';
  if (/design|ui|ux|figma|css|frontend|chrome|canvas|art|creative|image|video|3d/.test(text)) return 'design-creative';
  if (/doc|readme|markdown|pdf|pptx|xlsx|technical.writ|translate/.test(text)) return 'documentation';
  if (/business|finance|contract|invoice|budget|compliance|legal/.test(text)) return 'business-finance';
  if (/automat|workflow|mcp|integration|slack|github|linear|firebase|stripe|asana|gitlab|supabase|playwright|n8n|webhook/.test(text)) return 'automation';
  if (/chat|email|slack|discord|telegram|notification|commu/.test(text)) return 'communication';
  if (/learn|teach|tutor|course|education|research|paper/.test(text)) return 'education-research';
  if (/tarot|game|fun|lifestyle|entertainment|占卜|divination/.test(text)) return 'lifestyle-fun';
  if (/lsp|language.server|commit|git|pr|merge|branch|cleanup|review|lint|quality|code|dev|setup|config|hook|plugin|skill|sdk/.test(text)) return 'development';
  return 'other';
}

function inferCategoryFromTopics(topics, name, desc) {
  const all = [...topics, name, desc].join(' ').toLowerCase();
  return inferCategory(all, '');
}

// ============================================================
// Disk cache (磁盘缓存)
// ============================================================

function loadDiskCache() {
  if (!fs.existsSync(ONLINE_CACHE)) return null;
  try {
    const cache = JSON.parse(fs.readFileSync(ONLINE_CACHE, 'utf-8'));
    // Patch old data with missing fields (修补旧数据缺失的字段)
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

// ============================================================
// Overrides
// ============================================================

function loadOverrides() {
  if (!fs.existsSync(OVERRIDES_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(OVERRIDES_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

// ============================================================
// HTTP helpers
// ============================================================

/**
 * Check if there is enough quota remaining. Skip if not, don't waste requests. (检查是否还有足够限额。不够就跳过，不浪费请求。)
 */
function hasQuota(reserve = 2) {
  // If quota has reset, restore (如果限额已重置，恢复)
  if (Date.now() > rateResetAt) {
    rateRemaining = 60;
  }
  return rateRemaining > reserve;
}

function githubGet(url, token) {
  return new Promise((resolve, reject) => {
    // Quota pre-check: reject immediately if insufficient, don't waste a request (限额预检：不够就直接报错，不浪费一次请求)
    if (!hasQuota()) {
      const waitMin = Math.ceil((rateResetAt - Date.now()) / 60000);
      reject(new Error(`Quota exhausted, will recover ${waitMin > 0 ? 'in ' + waitMin + ' min' : 'shortly'}`));
      return;
    }

    const headers = {
      'User-Agent': 'skill-manager',
      Accept: 'application/vnd.github.v3+json',
    };
    if (token) headers.Authorization = `token ${token}`;

    const parsedUrl = new URL(url);
    const req = https.get({
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      headers,
      timeout: 15000,
    }, res => {
      // Update rate limit tracking (更新限额追踪)
      const remain = res.headers['x-ratelimit-remaining'];
      const reset = res.headers['x-ratelimit-reset'];
      if (remain != null) rateRemaining = parseInt(remain, 10);
      if (reset != null) rateResetAt = parseInt(reset, 10) * 1000;

      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 403 || res.statusCode === 429) {
          rateRemaining = 0; // Mark quota exhausted (标记限额耗尽)
          reject(new Error(`GitHub API rate limited (${res.statusCode}), remaining: ${rateRemaining}`));
          return;
        }
        if (res.statusCode === 404) { resolve(null); return; }
        if (res.statusCode >= 400) {
          reject(new Error(`GitHub API error: ${res.statusCode}`));
          return;
        }
        try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Generic HTTP GET (not using GitHub API quota, for npm, raw files, etc.) (通用 HTTP GET（不走 GitHub API 限额，用于 npm、raw 文件等）)
 */
function httpGet(urlStr) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === 'https:' ? https : require('http');
    const req = mod.get({
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: { 'User-Agent': 'skill-manager' },
      timeout: 15000,
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpGet(res.headers.location).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode >= 400) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

// ============================================================
// Data source 3: Awesome Lists (auto-search discover -> parse README to extract links) (数据来源 3：Awesome Lists（自动搜索发现 → 解析 README 提取链接）)
// ============================================================

async function fetchAwesomeLists(token) {
  if (!hasQuota(5)) {
    console.log(`[discover] Insufficient quota, skipping awesome lists`);
    return [];
  }

  // Step 1: search to discover awesome list repos (auto-grow, new lists are auto-discovered) (第一步：搜索发现 awesome 列表仓库（自增长，新列表自动被发现）)
  const awesomeRepos = [];
  for (const q of AWESOME_SEARCH_QUERIES) {
    if (!hasQuota(3)) break;
    try {
      const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=20`;
      const result = await githubGet(url, token);
      if (result && result.items) {
        for (const repo of result.items) {
          if (!repo.archived && repo.stargazers_count >= 10) {
            awesomeRepos.push(repo.full_name);
          }
        }
      }
    } catch (e) {
      console.log(`[discover] Awesome search "${q}" failed: ${e.message}`);
    }
    await sleep(SEARCH_DELAY);
  }

  // Dedup (去重)
  const uniqueAwesome = [...new Set(awesomeRepos)];
  console.log(`[discover] Auto-discovered ${uniqueAwesome.length} awesome lists`);

  // Step 2: parse each list's README, extract GitHub links (第二步：解析每个列表的 README，提取 GitHub 链接)
  const seen = new Set();
  const skills = [];

  for (const fullName of uniqueAwesome) {
    if (!hasQuota(3)) break;
    try {
      const readmeData = await githubGet(`https://api.github.com/repos/${fullName}/readme`, token);
      if (!readmeData || !readmeData.content) continue;
      const content = Buffer.from(readmeData.content, 'base64').toString('utf-8');

      // Extract GitHub repo links (提取 GitHub 仓库链接)
      const repoPattern = /https?:\/\/github\.com\/([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)/g;
      const repos = new Set();
      let match;
      while ((match = repoPattern.exec(content)) !== null) {
        let repo = match[1].replace(/\/+$/, '').replace(/\.git$/, '');
        repo = repo.split('/').slice(0, 2).join('/');
        const repoLower = repo.toLowerCase();
        if (!EXCLUDE_REPOS.has(repoLower) && !repoLower.includes('awesome-') && !seen.has(repoLower)) {
          repos.add(repo);
        }
      }

      for (const repoFullName of repos) {
        const key = repoFullName.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);

        const [, repoName] = repoFullName.split('/');
        skills.push({
          name: repoName,
          description: repoName.replace(/-/g, ' '),
          source: 'community',
          sourceType: 'community',
          repoUrl: `https://github.com/${repoFullName}`,
          repoStars: 0,
          pushedAt: null,
          category: inferCategory(repoName, ''),
          tags: [],
          keywords: [],
          trustLevel: 'unverified',
          discoveredVia: `awesome:${fullName}`,
          version: null,
          installed: false,
        });
      }

      console.log(`[discover] Awesome "${fullName}": ${repos.size} links`);
    } catch (e) {
      console.log(`[discover] Awesome "${fullName}" failed: ${e.message}`);
    }
  }

  console.log(`[discover] Awesome lists total: ${skills.length}`);
  return skills;
}

// ============================================================
// Data source 4: npm package search (zero GitHub API consumption) (数据来源 4：npm 包搜索（零 GitHub API 消耗）)
// ============================================================

async function fetchNpmSkills() {
  const seen = new Set();
  const skills = [];

  for (const q of NPM_QUERIES) {
    try {
      const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(q)}&size=50`;
      const data = await httpGet(url);
      const result = JSON.parse(data);
      if (!result.objects) continue;

      for (const obj of result.objects) {
        const pkg = obj.package;
        if (!pkg || seen.has(pkg.name)) continue;
        seen.add(pkg.name);

        // Extract GitHub link (提取 GitHub 链接)
        let repoUrl = '';
        if (pkg.links?.repository) {
          repoUrl = pkg.links.repository;
        } else if (pkg.links?.homepage) {
          repoUrl = pkg.links.homepage;
        }

        skills.push({
          name: pkg.name,
          description: pkg.description || pkg.name,
          source: 'npm',
          sourceType: 'community',
          repoUrl: repoUrl || `https://www.npmjs.com/package/${pkg.name}`,
          repoStars: 0,
          pushedAt: pkg.date || null,
          category: inferCategory(pkg.name, pkg.description || ''),
          tags: pkg.keywords ? pkg.keywords.slice(0, 5) : [],
          keywords: pkg.keywords || [],
          trustLevel: 'unverified',
          discoveredVia: 'npm',
          version: pkg.version,
          installed: false,
        });
      }
    } catch (e) {
      console.log(`[discover] npm search "${q}" failed: ${e.message}`);
    }
  }

  console.log(`[discover] npm total: ${skills.length}`);
  return skills;
}

// ============================================================
// Data source 5: Aggregated repos (auto-search discover -> scan subdirectories) (数据来源 5：聚合仓库（自动搜索发现 → 扫描子目录）)
// ============================================================

async function fetchAggregatedRepos(token) {
  if (!hasQuota(5)) {
    console.log(`[discover] Insufficient quota, skipping aggregated repos`);
    return [];
  }

  // Step 1: search to discover aggregation repos (第一步：搜索发现聚合型仓库)
  const foundRepos = [];
  for (const q of AGGREGATED_SEARCH_QUERIES) {
    if (!hasQuota(3)) break;
    try {
      const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=20`;
      const result = await githubGet(url, token);
      if (result && result.items) {
        for (const repo of result.items) {
          if (!repo.archived && repo.stargazers_count >= 3) {
            foundRepos.push({ owner: repo.owner.login, repo: repo.name, stars: repo.stargazers_count, pushedAt: repo.pushed_at });
          }
        }
      }
    } catch (e) {
      console.log(`[discover] Aggregated search "${q}" failed: ${e.message}`);
    }
    await sleep(SEARCH_DELAY);
  }

  // Dedup (去重)
  const seen = new Set();
  const uniqueRepos = foundRepos.filter(r => {
    const key = `${r.owner}/${r.repo}`.toLowerCase();
    if (seen.has(key) || EXCLUDE_REPOS.has(key)) return false;
    // Exclude repos already in marketplace (排除已在 marketplace 中的)
    if (MARKETPLACE_SOURCES.some(m => m.owner === r.owner && m.repo === r.repo)) return false;
    seen.add(key);
    return true;
  });

  console.log(`[discover] Auto-discovered ${uniqueRepos.length} aggregated repos`);

  // Step 2: use Trees API to recursively scan SKILL.md, fall back to one-level directory if not found (第二步：用 Trees API 递归扫描 SKILL.md，找不到则回退到一层目录)
  const skills = [];
  const exclude = new Set(['.github', '.git', 'docs', 'scripts', 'node_modules', '.claude-plugin', 'src', 'lib', 'test', 'tests', '.vscode', 'examples', 'assets', 'images', 'img']);

  for (const source of uniqueRepos) {
    if (!hasQuota(3)) break;
    const fullName = `${source.owner}/${source.repo}`;
    try {
      // Prefer: Trees API to find SKILL.md (优先：Trees API 找 SKILL.md)
      const treeData = await githubGet(
        `https://api.github.com/repos/${fullName}/git/trees/main?recursive=1`,
        token
      );

      if (treeData && treeData.tree) {
        const skillFiles = treeData.tree.filter(f =>
          f.type === 'blob' && /^(.+\/)?SKILL\.md$/i.test(f.path)
        );

        if (skillFiles.length > 0) {
          // Limit max 200 skills per aggregated repo to avoid bloat (限制单个聚合仓库最多收录 200 个 skill，避免超级聚合仓库膨胀)
          const cappedFiles = skillFiles.slice(0, 200);
          for (const file of cappedFiles) {
            const dirPath = file.path.replace(/\/SKILL\.md$/i, '');
            const parts = dirPath.split('/');
            const name = parts[parts.length - 1];
            if (!dirPath.includes('/') && dirPath.toLowerCase() === 'skill.md') continue;

            skills.push({
              name,
              description: name.replace(/-/g, ' '),
              source: fullName,
              sourceType: 'community',
              repoUrl: `https://github.com/${fullName}/tree/main/${dirPath}`,
              repoStars: source.stars || 0,
              pushedAt: source.pushedAt || null,
              category: inferCategory(name, ''),
              tags: [],
              keywords: [],
              trustLevel: 'unverified',
              discoveredVia: `aggregated:${fullName}`,
              version: null,
              installed: false,
            });
          }
          console.log(`[discover] Aggregated repo "${fullName}": ${skillFiles.length} SKILL.md`);
          continue;
        }
      }

      // Repos without SKILL.md don't need fallback scan (avoid treating Awesome List doc dirs as skills) (没有 SKILL.md 的仓库不用回退扫描（避免把 Awesome List 的文档目录当 skill）)
      console.log(`[discover] Aggregated repo "${fullName}": no SKILL.md, skipping`);
    } catch (e) {
      console.log(`[discover] Aggregated repo "${fullName}" failed: ${e.message}`);
    }
  }

  console.log(`[discover] Aggregated repos total: ${skills.length}`);
  return skills;
}

module.exports = { startIndexEngine, getOnlineSkills, getCategories, markInstalled };

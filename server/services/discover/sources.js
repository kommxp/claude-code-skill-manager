/**
 * sources.js — Data source fetchers (数据来源拉取器)
 *
 * Marketplace, Community, Awesome Lists, npm, Aggregated repos
 */

const { hasQuota, getRateRemaining, githubGet, httpGet, sleep, SEARCH_DELAY } = require('./github-api');
const { inferCategory, inferCategoryFromTopics } = require('./categories');

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

// Excluded repos (not skills) (排除的仓库)
const EXCLUDE_REPOS = new Set([
  'anthropics/claude-plugins-official',
  'trailofbits/skills',
  'trailofbits/skills-curated',
  'anthropics/courses',
  'anthropics/claude-code',
]);

// Keywords indicating a collection/aggregation repo (集合型仓库关键词)
const COLLECTION_KEYWORDS = /^(awesome-|.*-skills$|.*-plugins$|.*-toolkit$|.*-collection$|.*-awesome-|.*-curated$)/i;

// Search queries (搜索关键词)
const AWESOME_SEARCH_QUERIES = [
  'awesome-claude-code in:name',
  'awesome-claude-skills in:name',
  'awesome-claude-plugins in:name',
  'awesome-claude-code-subagents in:name',
];

const AGGREGATED_SEARCH_QUERIES = [
  'claude-code-skills in:name',
  'claude-code-plugins in:name',
  'claude-skills in:name stars:>5',
  'claude-code-toolkit in:name',
  'agent-skills claude in:name,description',
];

const NPM_QUERIES = [
  'claude-code-skill',
  'claude-code skill',
  'claude-skill',
];

const COMMUNITY_QUERIES = [
  'topic:claude-code-skill',
  'topic:claude-code-plugin',
  'topic:claude-code-skills',
  'topic:claude-skill',
  'topic:claude-code-commands',
  'topic:claude-code-hooks',
  'topic:anthropic-skill',
  'claude-code skill in:name,description',
  'claude-code plugin in:name,description',
  'claude skill in:name',
  'claude-code hook in:name',
  'filename:SKILL.md path:/',
  'filename:skill.md path:.claude',
  'path:.claude/commands',
  'path:.claude/skills',
];

// ============================================================
// Marketplace (Marketplace 仓库)
// ============================================================

async function fetchAllMarketplaces(token, overrides, oldSkills) {
  const allSkills = [];

  for (const source of MARKETPLACE_SOURCES) {
    try {
      const skills = await fetchMarketplace(source, token, overrides);
      allSkills.push(...skills);
    } catch (e) {
      console.log(`[discover] ${source.name} fetch failed: ${e.message}, keeping old data`);
      allSkills.push(...oldSkills.filter(s => s.source === source.name));
    }
  }

  return allSkills;
}

async function fetchMarketplace(source, token, overrides = {}) {
  let repoMeta = { stars: 0, pushedAt: null, topics: [] };
  try {
    const repo = await githubGet(`https://api.github.com/repos/${source.owner}/${source.repo}`, token);
    if (repo) {
      repoMeta = { stars: repo.stargazers_count || 0, pushedAt: repo.pushed_at, topics: repo.topics || [] };
    }
  } catch (e) {
    console.log(`[discover] Repo metadata fetch failed for "${source.owner}/${source.repo}": ${e.message}`);
  }

  const skills = [];
  const fullName = `${source.owner}/${source.repo}`;

  // Method 1: Trees API recursive scan for SKILL.md (方式 1：Trees API 递归扫描)
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
          const dirPath = file.path.replace(/\/SKILL\.md$/i, '');
          const parts = dirPath.split('/');
          const name = parts[parts.length - 1];
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

  // Method 2: Fallback — one-level directory scan (方式 2：回退 — 一层目录扫描)
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

  // Method 2b: external directory (方式 2b：external 目录)
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
    } catch (e) {
      console.log(`[discover] External dir fetch failed for "${source.name}": ${e.message}`);
    }
  }

  return skills;
}

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
// Community auto-discover (社区自动发现)
// ============================================================

async function fetchAllCommunitySkills(token) {
  const seen = new Set();
  const skills = [];

  // Layer 1: keyword & topic search (第一层：关键词 & topic 搜索)
  for (const q of COMMUNITY_QUERIES) {
    if (!hasQuota(5)) {
      console.log(`[discover] Insufficient quota (${getRateRemaining()}), layer 1 ending early, found ${skills.length}`);
      break;
    }
    await searchAndCollect(q, token, seen, skills);
    await sleep(SEARCH_DELAY);
  }
  console.log(`[discover] Layer 1 (keywords) complete: ${skills.length}`);

  // Layer 2: file signature search (第二层：文件特征搜索)
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
          } catch (e) {
            console.log(`[discover] Repo fetch failed for "${fullName}": ${e.message}`);
          }
        }
        console.log(`[discover] File signature "${label}": found ${repoFullNames.size} repos`);
      } catch (e) {
        console.log(`[discover] File search "${label}" failed: ${e.message}`);
      }
      await sleep(SEARCH_DELAY);
    }
  } else {
    console.log(`[discover] Insufficient quota (${getRateRemaining()}), skipping layer 2 (file signatures)`);
  }

  // Layer 3: network expansion (第三层：网络扩散)
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
    console.log(`[discover] Insufficient quota (${getRateRemaining()}), skipping layer 3 (network expansion)`);
  }

  // Layer 4: fork discovery (第四层：fork 发现)
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
    console.log(`[discover] Insufficient quota (${getRateRemaining()}), skipping layer 4 (forks)`);
  }

  console.log(`[discover] Community auto-discover total: ${skills.length}, API remaining: ${getRateRemaining()}`);
  skills.sort((a, b) => (b.repoStars || 0) - (a.repoStars || 0));
  return skills;
}

async function searchAndCollect(query, token, seen, skills) {
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

function addRepoToSkills(repo, seen, skills, discoveredVia) {
  const fullName = repo.full_name.toLowerCase();
  if (seen.has(fullName) || EXCLUDE_REPOS.has(fullName)) return;
  seen.add(fullName);

  if (COLLECTION_KEYWORDS.test(repo.name)) return;

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
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([owner]) => owner);
}

// ============================================================
// Awesome Lists (Awesome 列表)
// ============================================================

async function fetchAwesomeLists(token) {
  if (!hasQuota(5)) {
    console.log(`[discover] Insufficient quota, skipping awesome lists`);
    return [];
  }

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

  const uniqueAwesome = [...new Set(awesomeRepos)];
  console.log(`[discover] Auto-discovered ${uniqueAwesome.length} awesome lists`);

  const seen = new Set();
  const skills = [];

  for (const fullName of uniqueAwesome) {
    if (!hasQuota(3)) break;
    try {
      const readmeData = await githubGet(`https://api.github.com/repos/${fullName}/readme`, token);
      if (!readmeData || !readmeData.content) continue;
      const content = Buffer.from(readmeData.content, 'base64').toString('utf-8');

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
        if (COLLECTION_KEYWORDS.test(repoName)) continue;

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
// npm package search (npm 包搜索)
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
// Aggregated repos (聚合仓库)
// ============================================================

const MAX_SKILLS_PER_AGGREGATED = 200; // Limit per repo to avoid bloat (单仓库上限)

async function fetchAggregatedRepos(token) {
  if (!hasQuota(5)) {
    console.log(`[discover] Insufficient quota, skipping aggregated repos`);
    return [];
  }

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

  const seen = new Set();
  const uniqueRepos = foundRepos.filter(r => {
    const key = `${r.owner}/${r.repo}`.toLowerCase();
    if (seen.has(key) || EXCLUDE_REPOS.has(key)) return false;
    if (MARKETPLACE_SOURCES.some(m => m.owner === r.owner && m.repo === r.repo)) return false;
    seen.add(key);
    return true;
  });

  console.log(`[discover] Auto-discovered ${uniqueRepos.length} aggregated repos`);

  const skills = [];

  for (const source of uniqueRepos) {
    if (!hasQuota(3)) break;
    const fullName = `${source.owner}/${source.repo}`;
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
          const cappedFiles = skillFiles.slice(0, MAX_SKILLS_PER_AGGREGATED);
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
              repoStars: 0,
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

      console.log(`[discover] Aggregated repo "${fullName}": no SKILL.md, skipping`);
    } catch (e) {
      console.log(`[discover] Aggregated repo "${fullName}" failed: ${e.message}`);
    }
  }

  console.log(`[discover] Aggregated repos total: ${skills.length}`);
  return skills;
}

module.exports = {
  MARKETPLACE_SOURCES,
  fetchAllMarketplaces,
  fetchAllCommunitySkills,
  fetchAwesomeLists,
  fetchNpmSkills,
  fetchAggregatedRepos,
};

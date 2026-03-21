/**
 * enricher.js — Skill description enrichment engine (Skill 描述富化引擎)
 *
 * Three-layer progressive enrichment (三层渐进式补充):
 *   Layer 1: Trees API batch read marketplace SKILL.md (during refresh) (Trees API 批量读 marketplace SKILL.md（刷新时自动）)
 *   Layer 2: On-demand fetch README + Claude translation (when user clicks) (按需拉 README + Claude 翻译（用户点击时）)
 *   Layer 3: Background slow-fill by score (when idle) (后台按 score 从高到低慢补（空闲时）)
 */

const fs = require('fs');
const https = require('https');
const { DESC_CACHE } = require('../utils/paths');
const { callClaude, parseClaudeJson } = require('../utils/claude-cli');

// Constants (常量)
const BG_ENRICH_INTERVAL = 10 * 60 * 1000; // Background enrichment interval: 10 min (后台慢补间隔)
const BG_BATCH_SIZE = 10;                   // Skills per background round (每轮后台处理数量)
const MAX_DESC_LENGTH = 500;                // Max description length (描述最大长度)
const MAX_DESC_LINES = 3;                   // Max description lines to extract (提取描述最大行数)

// Description cache: { [repoUrl]: { en, zh, useCase, enrichedAt } } (描述缓存)
let descCache = {};
let bgTimer = null;
let pendingSkills = [];  // Skills waiting for background enrichment (等待后台富化的 skill 列表)

// ============================================================
// Public API (对外接口)
// ============================================================

/**
 * Start enrichment engine (启动富化引擎)
 */
function startEnricher(getSkillsFn) {
  loadDescCache();
  console.log(`[enricher] Description cache loaded: ${Object.keys(descCache).length} entries`);

  // Background slow-fill timer: enrich 10 every 10 min (后台慢补定时器：每 10 分钟补 10 个)
  bgTimer = setInterval(() => {
    backgroundEnrich(getSkillsFn).catch(e => {
      console.log(`[enricher] Background enrichment failed: ${e.message}`);
    });
  }, BG_ENRICH_INTERVAL);

  if (bgTimer.unref) bgTimer.unref();
}

/**
 * Layer 1: Batch read marketplace SKILL.md descriptions via Trees API (第一层：用 Trees API 批量读 marketplace 的 SKILL.md 描述)
 * Called during discover refresh (在 discover 刷新时调用)
 */
async function enrichMarketplaceDescriptions(skills, token) {
  // Group by repo (按仓库分组)
  const byRepo = {};
  for (const s of skills) {
    if (s.sourceType !== 'marketplace') continue;
    if (descCache[s.repoUrl]) continue; // Already cached (已有缓存)
    const match = s.repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) continue;
    const repoKey = `${match[1]}/${match[2]}`;
    if (!byRepo[repoKey]) byRepo[repoKey] = [];
    byRepo[repoKey].push(s);
  }

  for (const [repoFullName, repoSkills] of Object.entries(byRepo)) {
    try {
      // Trees API: 1 request to get entire repo file tree (Trees API：1 次请求拿整个仓库文件树)
      const treeData = await githubGet(
        `https://api.github.com/repos/${repoFullName}/git/trees/main?recursive=1`,
        token
      );
      if (!treeData || !treeData.tree) continue;

      // Find each skill's SKILL.md or README.md (找到每个 skill 的 SKILL.md 或 README.md)
      for (const skill of repoSkills) {
        const skillPath = skill.repoUrl.replace(/.*\/tree\/main\//, '');
        const skillMd = treeData.tree.find(f =>
          f.path === `${skillPath}/SKILL.md` ||
          f.path === `${skillPath}/skill.md`
        );
        const readmeMd = treeData.tree.find(f =>
          f.path === `${skillPath}/README.md` ||
          f.path === `${skillPath}/readme.md`
        );

        const targetFile = skillMd || readmeMd;
        if (!targetFile) continue;

        // Read file content (via blob API) (读取文件内容（通过 blob API）)
        try {
          const blob = await githubGet(
            `https://api.github.com/repos/${repoFullName}/git/blobs/${targetFile.sha}`,
            token
          );
          if (!blob || !blob.content) continue;

          const content = Buffer.from(blob.content, 'base64').toString('utf-8');
          const desc = extractDescription(content);
          if (desc) {
            descCache[skill.repoUrl] = {
              en: desc,
              zh: null,
              useCase: null,
              enrichedAt: Date.now(),
              source: 'trees-api',
            };
          }
        } catch (e) {
          console.log(`[enricher] Blob read failed for "${skill.name}": ${e.message}`);
        }
      }

      console.log(`[enricher] Trees API "${repoFullName}": processed ${repoSkills.length}`);
    } catch (e) {
      console.log(`[enricher] Trees API "${repoFullName}" failed: ${e.message}`);
    }
  }

  saveDescCache();
}

/**
 * Layer 2: On-demand fetch single skill detail + translation (第二层：按需获取单个 skill 的详细信息 + 翻译)
 */
async function getSkillDetail(skill, token) {
  const key = skill.repoUrl;
  if (!key) return null;

  // Return immediately if complete cache exists (有完整缓存直接返回)
  const cached = descCache[key];
  if (cached && cached.zh && cached.useCaseZh) {
    return cached;
  }

  // Fetch English description if missing (拉英文描述（如果没有的话）)
  let enDesc = cached?.en || skill.description || '';

  if (!enDesc || enDesc === skill.name.replace(/-/g, ' ')) {
    try {
      const readmeContent = await fetchReadme(skill, token);
      if (readmeContent) {
        enDesc = extractDescription(readmeContent);
      }
    } catch (e) {
      console.log(`[enricher] README fetch failed for "${skill.name}": ${e.message}`);
    }
  }

  if (!enDesc) enDesc = skill.description || skill.name;

  // Use Claude for translation + use case generation (用 Claude 翻译 + 生成使用场景)
  let zh = cached?.zh || null;
  let useCaseZh = cached?.useCaseZh || null;
  let useCaseEn = cached?.useCaseEn || null;

  if (!zh || !useCaseZh) {
    try {
      const result = await callClaudeForEnrich(skill.name, enDesc);
      zh = result.zh;
      useCaseZh = result.useCaseZh;
      useCaseEn = result.useCaseEn;
    } catch (e) {
      console.log(`[enricher] Claude translation failed: ${e.message}`);
      zh = enDesc;
      useCaseZh = '';
      useCaseEn = '';
    }
  }

  // Cache (缓存)
  descCache[key] = {
    en: enDesc,
    zh,
    useCaseZh,
    useCaseEn,
    enrichedAt: Date.now(),
    source: 'on-demand',
  };
  saveDescCache();

  return descCache[key];
}

/**
 * Attach existing description cache to skill list (no new data fetching, pure memory operation) (给 skill 列表附加已有的描述缓存（不拉新数据，纯内存操作）)
 */
function applyDescriptions(skills) {
  for (const s of skills) {
    const cached = descCache[s.repoUrl];
    if (cached) {
      if (cached.zh) s.descriptionZh = cached.zh;
      if (cached.useCaseZh) s.useCaseZh = cached.useCaseZh;
      if (cached.useCaseEn) s.useCaseEn = cached.useCaseEn;
      // Backward compatibility with old cache (兼容旧缓存)
      if (cached.useCase && !cached.useCaseZh) s.useCaseZh = cached.useCase;
      if (cached.en && s.description === s.name.replace(/-/g, ' ')) {
        s.description = cached.en;
      }
    }
  }
  return skills;
}

// ============================================================
// Layer 3: Background slow-fill (第三层：后台慢补)
// ============================================================

async function backgroundEnrich(getSkillsFn) {
  const skills = await getSkillsFn();
  if (!skills || skills.length === 0) return;

  // Find high-score skills missing Chinese descriptions, prioritize enrichment (找缺中文描述的高分 skill，优先补充)
  const needEnrich = skills
    .filter(s => {
      if (!s.repoUrl) return false;
      const cached = descCache[s.repoUrl];
      return !cached || !cached.zh || !cached.useCaseZh;
    })
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, BG_BATCH_SIZE);

  if (needEnrich.length === 0) return;

  console.log(`[enricher] Background slow-fill: ${needEnrich.length} skills`);
  let enriched = 0;

  for (const skill of needEnrich) {
    try {
      const key = skill.repoUrl;
      let enDesc = descCache[key]?.en || skill.description || '';

      // If English description is still the folder name, try reading README (如果英文描述还是文件夹名，尝试读 README)
      if (!enDesc || enDesc === skill.name.replace(/-/g, ' ')) {
        try {
          const readme = await fetchReadme(skill, null);
          if (readme) enDesc = extractDescription(readme);
        } catch (e) {
          console.log(`[enricher] Background README fetch failed for "${skill.name}": ${e.message}`);
        }
      }

      if (!enDesc) enDesc = skill.description || skill.name;

      // Claude translation (Claude 翻译)
      const result = await callClaudeForEnrich(skill.name, enDesc);

      descCache[key] = {
        en: enDesc,
        zh: result.zh,
        useCaseZh: result.useCaseZh,
        useCaseEn: result.useCaseEn,
        enrichedAt: Date.now(),
        source: 'background',
      };
      enriched++;
    } catch (e) {
      console.log(`[enricher] Background enrichment "${skill.name}" failed: ${e.message}`);
    }
  }

  if (enriched > 0) {
    saveDescCache();
    console.log(`[enricher] Background slow-fill complete: ${enriched}`);
  }
}

// ============================================================
// Utility functions (工具函数)
// ============================================================

/**
 * Extract description from markdown content (first few meaningful lines of text) (从 markdown 内容提取描述（取前几行有意义的文本）)
 */
function extractDescription(content) {
  const lines = content.split('\n');
  const descLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip empty lines, headings, frontmatter, code blocks (跳过空行、标题、frontmatter、代码块)
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('---')) continue;
    if (trimmed.startsWith('```')) break;
    if (trimmed.startsWith('![')) continue;
    if (trimmed.startsWith('<!--')) continue;

    descLines.push(trimmed);
    // Take first N effective lines (取前 N 行有效文本)
    if (descLines.length >= MAX_DESC_LINES) break;
  }

  return descLines.join(' ').slice(0, MAX_DESC_LENGTH) || null;
}

/**
 * Fetch skill's README (读取 skill 的 README)
 */
async function fetchReadme(skill, token) {
  // Try to infer README location from repoUrl (尝试从 repoUrl 推断 README 位置)
  const match = skill.repoUrl.match(/github\.com\/([^/]+\/[^/]+)/);
  if (!match) return null;
  const repoFullName = match[1];

  try {
    const data = await githubGet(`https://api.github.com/repos/${repoFullName}/readme`, token);
    if (data && data.content) {
      return Buffer.from(data.content, 'base64').toString('utf-8');
    }
  } catch (e) {
    console.log(`[enricher] GitHub README API failed for "${repoFullName}": ${e.message}`);
  }

  return null;
}

/**
 * Call Claude CLI for translation + use case generation (调用 Claude CLI 翻译 + 生成使用场景)
 */
async function callClaudeForEnrich(skillName, enDesc) {
  const prompt = `You are a technical translator. Given a Claude Code skill:

Name: ${skillName}
Description: ${enDesc}

Output ONLY valid JSON (no markdown, no code fences):
{"zh":"一句中文描述（20-50字）","useCaseZh":"使用场景（中文，30-80字，说明什么时候用、适合谁）","useCaseEn":"Use case (English, 30-80 words, when to use, who benefits)"}`;

  try {
    const text = await callClaude(prompt);
    try {
      const parsed = parseClaudeJson(text);
      return {
        zh: parsed.zh || enDesc,
        useCaseZh: parsed.useCaseZh || parsed.useCase || '',
        useCaseEn: parsed.useCaseEn || '',
      };
    } catch {
      // If JSON parsing fails, use raw text (如果 JSON 解析失败，直接用原文)
      return { zh: text.slice(0, 200), useCaseZh: '', useCaseEn: '' };
    }
  } catch (e) {
    throw e;
  }
}

// ============================================================
// GitHub API (reuse discover's logic) (GitHub API（复用 discover 的逻辑）)
// ============================================================

function githubGet(url, token) {
  return new Promise((resolve, reject) => {
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
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
        try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

// ============================================================
// Cache persistence (缓存持久化)
// ============================================================

function loadDescCache() {
  if (!fs.existsSync(DESC_CACHE)) { descCache = {}; return; }
  try {
    descCache = JSON.parse(fs.readFileSync(DESC_CACHE, 'utf-8'));
  } catch {
    descCache = {};
  }
}

function saveDescCache() {
  try {
    fs.writeFileSync(DESC_CACHE, JSON.stringify(descCache), 'utf-8');
  } catch (e) {
    console.error(`[enricher] Cache write failed: ${e.message}`);
  }
}

module.exports = {
  startEnricher,
  enrichMarketplaceDescriptions,
  getSkillDetail,
  applyDescriptions,
};

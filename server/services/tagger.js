/**
 * tagger.js — AI auto-tagging engine (AI 自动标签引擎)
 *
 * Uses Claude Haiku to tag skills with multi-dimensional labels (用 Claude Haiku 给 skill 打多维标签):
 *   - category (domain category, pick 1 of 15) (领域大类，15 选 1)
 *   - actions (action type, pick 1-3 of 12) (动作类型，12 选 1-3)
 *   - targets (target object, controlled open) (作用对象，受控开放)
 *   - complexity (complexity level, pick 1 of 3) (复杂度，3 选 1)
 *
 * Background slow-fill: 10 per round, prioritized by score descending (后台慢补：每轮补 10 个，按 score 从高到低优先)
 */

const fs = require('fs');
const { TAGS_CACHE } = require('../utils/paths');
const { callClaude, parseClaudeJson } = require('../utils/claude-cli');

// ============================================================
// Enum definitions (Chinese-English mapping) (枚举定义（中英文映射）)
// ============================================================

const CATEGORIES = {
  'development':        { en: 'Development',        zh: '软件开发' },
  'devops':             { en: 'DevOps',              zh: 'DevOps' },
  'data-analytics':     { en: 'Data & Analytics',    zh: '数据分析' },
  'ai-ml':              { en: 'AI / ML',             zh: 'AI / 机器学习' },
  'security':           { en: 'Security',            zh: '安全' },
  'testing':            { en: 'Testing',             zh: '测试' },
  'marketing-seo':      { en: 'Marketing & SEO',     zh: '营销与SEO' },
  'product-management': { en: 'Product Management',  zh: '产品管理' },
  'design-creative':    { en: 'Design & Creative',   zh: '设计与创意' },
  'documentation':      { en: 'Documentation',       zh: '文档' },
  'business-finance':   { en: 'Business & Finance',  zh: '商业与财务' },
  'automation':         { en: 'Automation',           zh: '自动化' },
  'communication':      { en: 'Communication',       zh: '通讯协作' },
  'education-research': { en: 'Education & Research', zh: '教育与研究' },
  'lifestyle-fun':      { en: 'Lifestyle & Fun',     zh: '生活与娱乐' },
};

const ACTIONS = {
  'generate':  { en: 'Generate',  zh: '生成' },
  'analyze':   { en: 'Analyze',   zh: '分析' },
  'review':    { en: 'Review',    zh: '审查' },
  'transform': { en: 'Transform', zh: '转换' },
  'automate':  { en: 'Automate',  zh: '自动化' },
  'search':    { en: 'Search',    zh: '搜索' },
  'manage':    { en: 'Manage',    zh: '管理' },
  'monitor':   { en: 'Monitor',   zh: '监控' },
  'test':      { en: 'Test',      zh: '测试' },
  'explain':   { en: 'Explain',   zh: '解释' },
  'simulate':  { en: 'Simulate',  zh: '模拟' },
  'optimize':  { en: 'Optimize',  zh: '优化' },
};

const COMPLEXITY = {
  'simple':      { en: 'Simple',      zh: '单步操作' },
  'interactive': { en: 'Interactive', zh: '多轮交互' },
  'pipeline':    { en: 'Pipeline',    zh: '完整流水线' },
};

const CATEGORY_IDS = Object.keys(CATEGORIES);
const ACTION_IDS = Object.keys(ACTIONS);

// Constants (常量)
const BG_TAG_INTERVAL = 5 * 60 * 1000;  // Background tagging interval: 5 min (后台打标签间隔)
const BG_BATCH_SIZE = 10;                // Skills per background round (每轮后台处理数量)
const DEFAULT_CONFIDENCE = 0.5;          // Default confidence when not specified (默认置信度)

// ============================================================
// Tags cache (标签缓存)
// ============================================================

// { [repoUrl]: { category, actions, targets, complexity, confidence, taggedAt } }
let tagsCache = {};
let bgTimer = null;

function loadTagsCache() {
  if (!fs.existsSync(TAGS_CACHE)) { tagsCache = {}; return; }
  try {
    tagsCache = JSON.parse(fs.readFileSync(TAGS_CACHE, 'utf-8'));
  } catch {
    tagsCache = {};
  }
}

function saveTagsCache() {
  try {
    fs.writeFileSync(TAGS_CACHE, JSON.stringify(tagsCache), 'utf-8');
  } catch (e) {
    console.error(`[tagger] Cache write failed: ${e.message}`);
  }
}

// ============================================================
// Public API (对外接口)
// ============================================================

/**
 * Start tagging engine (启动标签引擎)
 */
function startTagger(getSkillsFn) {
  loadTagsCache();
  console.log(`[tagger] Tags cache loaded: ${Object.keys(tagsCache).length} entries`);

  // Background slow-fill: 10 every 5 min (后台慢补：每 5 分钟补 10 个)
  bgTimer = setInterval(() => {
    backgroundTag(getSkillsFn).catch(e => {
      console.log(`[tagger] Background tagging failed: ${e.message}`);
    });
  }, BG_TAG_INTERVAL);

  if (bgTimer.unref) bgTimer.unref();
}

/**
 * Attach existing tag cache to skill list (给 skill 列表附加已有的标签缓存)
 */
function applyTags(skills, lang) {
  for (const s of skills) {
    const cached = tagsCache[s.repoUrl];
    if (!cached) continue;

    // Override old coarse category with new tags (用新标签覆盖旧的粗分类)
    if (cached.category) {
      s.category = cached.category;
      const catMeta = CATEGORIES[cached.category];
      s.categoryLabel = catMeta ? (lang === 'zh' ? catMeta.zh : catMeta.en) : cached.category;
    }

    if (cached.actions) {
      s.actions = cached.actions;
      s.actionLabels = cached.actions.map(a => {
        const m = ACTIONS[a];
        return m ? (lang === 'zh' ? m.zh : m.en) : a;
      });
    }

    if (cached.targets) s.targets = cached.targets;

    if (cached.complexity) {
      s.complexity = cached.complexity;
      const cMeta = COMPLEXITY[cached.complexity];
      s.complexityLabel = cMeta ? (lang === 'zh' ? cMeta.zh : cMeta.en) : cached.complexity;
    }

    if (cached.confidence != null) s.confidence = cached.confidence;
  }

  return skills;
}

/**
 * Tag a single skill on-demand (按需给单个 skill 打标签)
 */
async function tagSkill(skill) {
  const key = skill.repoUrl;
  if (!key) return null;

  const cached = tagsCache[key];
  if (cached && cached.category) return cached;

  const result = await callClaudeForTags(skill.name, skill.description || '');
  if (result) {
    tagsCache[key] = { ...result, taggedAt: Date.now() };
    saveTagsCache();
  }
  return result;
}

/**
 * Get enum definitions (for frontend) (获取枚举定义（前端用）)
 */
function getTagEnums() {
  return { categories: CATEGORIES, actions: ACTIONS, complexity: COMPLEXITY };
}

// ============================================================
// Background slow-fill (后台慢补)
// ============================================================

async function backgroundTag(getSkillsFn) {
  const skills = await getSkillsFn();
  if (!skills || skills.length === 0) return;

  // Find high-score skills missing tags (找缺标签的高分 skill)
  const needTag = skills
    .filter(s => {
      if (!s.repoUrl) return false;
      const cached = tagsCache[s.repoUrl];
      return !cached || !cached.category;
    })
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, BG_BATCH_SIZE);

  if (needTag.length === 0) return;

  console.log(`[tagger] Background tagging: ${needTag.length} skills`);
  let tagged = 0;

  for (const skill of needTag) {
    try {
      const result = await callClaudeForTags(skill.name, skill.description || '');
      if (result) {
        tagsCache[skill.repoUrl] = { ...result, taggedAt: Date.now() };
        tagged++;
      }
    } catch (e) {
      console.log(`[tagger] "${skill.name}" tagging failed: ${e.message}`);
    }
  }

  if (tagged > 0) {
    saveTagsCache();
    console.log(`[tagger] Background tagging complete: ${tagged}`);
  }
}

// ============================================================
// Claude CLI invocation (Claude CLI 调用)
// ============================================================

const TAGGING_PROMPT = `You are a skill classification engine. Analyze the given skill and output structured tags in JSON.

## Rules

### category (REQUIRED, pick exactly 1 from this list):
${CATEGORY_IDS.join(', ')}

### actions (REQUIRED, pick 1-3 from this list):
${ACTION_IDS.join(', ')}

### targets (pick 1-3, prefer from seed list, create new only if needed):
Seed list: code, repository, pull-request, database, sql, api, document, markdown, pdf, spreadsheet, webpage, image, video, container, docker, email, workflow, pipeline, config-file, log, report
New targets must be lowercase kebab-case English.

### complexity (REQUIRED, pick exactly 1):
simple, interactive, pipeline

## Examples

Input: {"name": "code-review", "description": "Automated code review for pull requests using multiple specialized agents"}
Output: {"category": "development", "actions": ["review", "analyze"], "targets": ["pull-request", "code"], "complexity": "pipeline", "confidence": 0.95}

Input: {"name": "seo-keyword-research", "description": "Analyzes competitor websites to extract high-value keywords and generates content briefs"}
Output: {"category": "marketing-seo", "actions": ["analyze", "generate"], "targets": ["webpage", "report"], "complexity": "simple", "confidence": 0.92}

Input: {"name": "let-fate-decide", "description": "Draws Tarot cards using cryptographic randomness to add entropy to decisions"}
Output: {"category": "lifestyle-fun", "actions": ["simulate"], "targets": ["report"], "complexity": "interactive", "confidence": 0.88}

Input: {"name": "supply-chain-risk-auditor", "description": "Audit supply-chain threat landscape of project dependencies for exploitation risk"}
Output: {"category": "security", "actions": ["review", "analyze"], "targets": ["repository", "report"], "complexity": "pipeline", "confidence": 0.94}

Input: {"name": "pptx", "description": "Generate PowerPoint presentations from markdown or text input"}
Output: {"category": "documentation", "actions": ["generate", "transform"], "targets": ["document"], "complexity": "simple", "confidence": 0.93}

## Task
Classify the following skill. Output ONLY valid JSON, no explanation.

`;

async function callClaudeForTags(name, description) {
  const input = `Input: {"name": "${name}", "description": "${(description || '').replace(/"/g, '\\"').slice(0, 300)}"}
Output:`;

  const text = await callClaude(TAGGING_PROMPT + input);

  try {
    const parsed = parseClaudeJson(text);

    // Validate category (校验 category)
    const category = CATEGORY_IDS.includes(parsed.category) ? parsed.category : null;
    // Validate actions (校验 actions)
    const actions = (parsed.actions || []).filter(a => ACTION_IDS.includes(a)).slice(0, 3);
    // Keep targets as-is (controlled open) (targets 保持原样（受控开放）)
    const targets = (parsed.targets || []).slice(0, 3).map(t => String(t).toLowerCase().replace(/\s+/g, '-'));
    // Validate complexity (校验 complexity)
    const complexity = ['simple', 'interactive', 'pipeline'].includes(parsed.complexity) ? parsed.complexity : 'simple';
    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : DEFAULT_CONFIDENCE;

    if (!category) {
      throw new Error(`Invalid category: ${parsed.category}`);
    }

    return { category, actions, targets, complexity, confidence };
  } catch (e) {
    throw new Error(`JSON parse failed: ${text.slice(0, 100)}`);
  }
}

module.exports = {
  startTagger,
  applyTags,
  tagSkill,
  getTagEnums,
  CATEGORIES,
  ACTIONS,
  COMPLEXITY,
};

/**
 * tagger.js — AI 自动标签引擎
 *
 * 用 Claude Haiku 给 skill 打多维标签：
 *   - category（领域大类，15 选 1）
 *   - actions（动作类型，12 选 1-3）
 *   - targets（作用对象，受控开放）
 *   - complexity（复杂度，3 选 1）
 *
 * 后台慢补：每轮补 10 个，按 score 从高到低优先
 */

const fs = require('fs');
const { spawn } = require('child_process');
const { TAGS_CACHE } = require('../utils/paths');

// ============================================================
// 枚举定义（中英文映射）
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

// ============================================================
// 标签缓存
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
    console.error(`[tagger] 缓存写入失败: ${e.message}`);
  }
}

// ============================================================
// 对外接口
// ============================================================

/**
 * 启动标签引擎
 */
function startTagger(getSkillsFn) {
  loadTagsCache();
  console.log(`[tagger] 标签缓存加载: ${Object.keys(tagsCache).length} 条`);

  // 后台慢补：每 5 分钟补 10 个
  bgTimer = setInterval(() => {
    backgroundTag(getSkillsFn).catch(e => {
      console.log(`[tagger] 后台打标失败: ${e.message}`);
    });
  }, 5 * 60 * 1000);

  if (bgTimer.unref) bgTimer.unref();
}

/**
 * 给 skill 列表附加已有的标签缓存
 */
function applyTags(skills, lang) {
  for (const s of skills) {
    const cached = tagsCache[s.repoUrl];
    if (!cached) continue;

    // 用新标签覆盖旧的粗分类
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
 * 按需给单个 skill 打标签
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
 * 获取枚举定义（前端用）
 */
function getTagEnums() {
  return { categories: CATEGORIES, actions: ACTIONS, complexity: COMPLEXITY };
}

// ============================================================
// 后台慢补
// ============================================================

async function backgroundTag(getSkillsFn) {
  const skills = await getSkillsFn();
  if (!skills || skills.length === 0) return;

  // 找缺标签的高分 skill
  const needTag = skills
    .filter(s => {
      if (!s.repoUrl) return false;
      const cached = tagsCache[s.repoUrl];
      return !cached || !cached.category;
    })
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 10);

  if (needTag.length === 0) return;

  console.log(`[tagger] 后台打标: ${needTag.length} 个 skill`);
  let tagged = 0;

  for (const skill of needTag) {
    try {
      const result = await callClaudeForTags(skill.name, skill.description || '');
      if (result) {
        tagsCache[skill.repoUrl] = { ...result, taggedAt: Date.now() };
        tagged++;
      }
    } catch (e) {
      console.log(`[tagger] "${skill.name}" 打标失败: ${e.message}`);
    }
  }

  if (tagged > 0) {
    saveTagsCache();
    console.log(`[tagger] 后台打标完成: ${tagged} 个`);
  }
}

// ============================================================
// Claude CLI 调用
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

function callClaudeForTags(name, description) {
  return new Promise((resolve, reject) => {
    const input = `Input: {"name": "${name}", "description": "${(description || '').replace(/"/g, '\\"').slice(0, 300)}"}
Output:`;

    const env = Object.assign({}, process.env);
    const gitBashCandidates = [
      process.env.CLAUDE_CODE_GIT_BASH_PATH,
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'D:\\Git\\bin\\bash.exe',
      'C:\\Git\\bin\\bash.exe',
    ];
    const gitBash = gitBashCandidates.find(p => p && fs.existsSync(p));
    if (gitBash) env.CLAUDE_CODE_GIT_BASH_PATH = gitBash;
    delete env.CLAUDECODE;
    delete env.ANTHROPIC_BASE_URL;
    delete env.ANTHROPIC_API_KEY;

    const child = spawn('claude', ['-p', '--max-turns', '1', '--no-session-persistence', '--model', 'haiku'], {
      env, shell: true, stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', err => reject(err));
    child.on('close', () => {
      const text = stdout.trim();
      if (!text) { reject(new Error('Claude 无输出')); return; }

      try {
        const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        const parsed = JSON.parse(clean);

        // 校验 category
        const category = CATEGORY_IDS.includes(parsed.category) ? parsed.category : null;
        // 校验 actions
        const actions = (parsed.actions || []).filter(a => ACTION_IDS.includes(a)).slice(0, 3);
        // targets 保持原样（受控开放）
        const targets = (parsed.targets || []).slice(0, 3).map(t => String(t).toLowerCase().replace(/\s+/g, '-'));
        // 校验 complexity
        const complexity = ['simple', 'interactive', 'pipeline'].includes(parsed.complexity) ? parsed.complexity : 'simple';
        const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.5;

        if (!category) {
          reject(new Error(`无效 category: ${parsed.category}`));
          return;
        }

        resolve({ category, actions, targets, complexity, confidence });
      } catch (e) {
        reject(new Error(`JSON 解析失败: ${text.slice(0, 100)}`));
      }
    });

    child.stdin.write(TAGGING_PROMPT + input);
    child.stdin.end();
  });
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

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { CLAUDE_DIR } = require('../utils/paths');

const CACHE_FILE = path.join(CLAUDE_DIR, 'skill-manager-translations.json');

// In-memory cache (内存缓存)
let cache = null;

function loadCache() {
  if (cache) return cache;
  if (fs.existsSync(CACHE_FILE)) {
    try {
      cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    } catch {
      cache = {};
    }
  } else {
    cache = {};
  }
  return cache;
}

function saveCache() {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8');
}

/**
 * Get translated description (获取翻译后的 description)
 * @param {string} skillId - Skill unique identifier (skill 唯一标识)
 * @param {string} originalText - Original description (原始 description)
 * @param {string} targetLang - Target language 'zh' | 'en' (目标语言)
 * @returns {Promise<string>} Translated text (翻译后的文本)
 */
async function getTranslation(skillId, originalText, targetLang) {
  if (!originalText || !originalText.trim()) return originalText;

  const c = loadCache();
  const key = `${skillId}::${targetLang}`;

  // 1. Hit cache, return directly (命中缓存直接返回)
  if (c[key]) return c[key];

  // 2. Detect source language, cache directly if already target language (检测原文语言，如果已经是目标语言则直接缓存)
  const isChinese = /[\u4e00-\u9fff]/.test(originalText);
  if ((targetLang === 'zh' && isChinese) || (targetLang === 'en' && !isChinese)) {
    c[key] = originalText;
    saveCache();
    return originalText;
  }

  // 3. Call Claude CLI for translation (调用 Claude CLI 翻译)
  try {
    const translated = await callClaudeTranslate(originalText, targetLang);
    c[key] = translated;
    saveCache();
    return translated;
  } catch (e) {
    console.log(`[translator] Translation failed (${skillId} -> ${targetLang}): ${e.message}`);
    return originalText; // Fallback to original text (降级返回原文)
  }
}

/**
 * Batch translate (批量翻译)
 * @param {Array<{id: string, description: string}>} items
 * @param {string} targetLang
 * @returns {Promise<Record<string, string>>} id -> translated description
 */
async function batchTranslate(items, targetLang) {
  const c = loadCache();
  const results = {};
  const needTranslate = [];

  for (const item of items) {
    const key = `${item.id}::${targetLang}`;
    if (c[key]) {
      results[item.id] = c[key];
    } else if (!item.description?.trim()) {
      results[item.id] = item.description || '';
    } else {
      // Check if already in target language (检测是否已经是目标语言)
      const isChinese = /[\u4e00-\u9fff]/.test(item.description);
      if ((targetLang === 'zh' && isChinese) || (targetLang === 'en' && !isChinese)) {
        c[key] = item.description;
        results[item.id] = item.description;
      } else {
        needTranslate.push(item);
      }
    }
  }

  // Batch translate uncached items (send to Claude at once, reduce call count) (批量翻译未缓存的（一次性发给 Claude，减少调用次数）)
  if (needTranslate.length > 0) {
    try {
      const batchResult = await callClaudeBatchTranslate(needTranslate, targetLang);
      for (const item of needTranslate) {
        const translated = batchResult[item.id] || item.description;
        const key = `${item.id}::${targetLang}`;
        c[key] = translated;
        results[item.id] = translated;
      }
      saveCache();
    } catch (e) {
      console.log(`[translator] Batch translation failed: ${e.message}`);
      // Fallback to original text (降级返回原文)
      for (const item of needTranslate) {
        results[item.id] = item.description;
      }
    }
  } else if (Object.keys(results).length > 0) {
    saveCache(); // Save detected "already target language" cache (保存检测到的"已是目标语言"的缓存)
  }

  return results;
}

/**
 * Call Claude CLI to translate single text (调用 Claude CLI 翻译单条文本)
 */
function callClaudeTranslate(text, targetLang) {
  const langName = targetLang === 'zh' ? '简体中文' : 'English';
  const prompt = `Translate the following text to ${langName}. Return ONLY the translated text, no explanation, no quotes, no markdown:\n\n${text}`;
  return callClaude(prompt);
}

/**
 * Call Claude CLI for batch translation (调用 Claude CLI 批量翻译)
 */
async function callClaudeBatchTranslate(items, targetLang) {
  const langName = targetLang === 'zh' ? '简体中文' : 'English';

  // Build batch translation prompt (构造批量翻译 prompt)
  const entries = items.map((item, i) => `[${i}] ${item.description}`).join('\n');
  const prompt = `Translate each line below to ${langName}. Return ONLY a JSON object mapping index to translated text, like {"0":"...","1":"..."}. No markdown, no explanation.\n\n${entries}`;

  const result = await callClaude(prompt);

  // Parse result (解析结果)
  try {
    // Remove possible markdown code fences (去除可能的 markdown 代码围栏)
    const cleaned = result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);

    const output = {};
    items.forEach((item, i) => {
      output[item.id] = parsed[String(i)] || item.description;
    });
    return output;
  } catch {
    // If JSON parse fails, try translating one by one (如果 JSON 解析失败，尝试逐行匹配)
    console.log('[translator] Batch translation JSON parse failed, falling back to individual translation');
    const output = {};
    for (const item of items) {
      try {
        output[item.id] = await callClaudeTranslate(item.description, targetLang);
      } catch {
        output[item.id] = item.description;
      }
    }
    return output;
  }
}

/**
 * Call Claude CLI (reusing CLAUDE.md pattern) (调用 Claude CLI（复用 CLAUDE.md 方案）)
 */
function callClaude(prompt) {
  return new Promise((resolve, reject) => {
    const env = Object.assign({}, process.env);
    delete env.CLAUDECODE;
    delete env.ANTHROPIC_BASE_URL;
    delete env.ANTHROPIC_API_KEY;

    // Auto-detect Git Bash path on Windows
    if (process.platform === 'win32') {
      const gitBashCandidates = [
        process.env.CLAUDE_CODE_GIT_BASH_PATH,
        'C:\\Program Files\\Git\\bin\\bash.exe',
        'D:\\Git\\bin\\bash.exe',
        'C:\\Git\\bin\\bash.exe',
      ];
      const fs = require('fs');
      const gitBash = gitBashCandidates.find(p => p && fs.existsSync(p));
      if (gitBash) env.CLAUDE_CODE_GIT_BASH_PATH = gitBash;
    }

    const child = spawn('claude', ['-p', '--max-turns', '1', '--no-session-persistence', '--model', 'sonnet'], {
      env,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', err => reject(err));
    child.on('close', code => {
      if (stdout.trim()) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error(`Claude CLI exit ${code}: ${stderr}`));
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/**
 * Get translation cache stats (获取翻译缓存统计)
 */
function getCacheStats() {
  const c = loadCache();
  const keys = Object.keys(c);
  const zhCount = keys.filter(k => k.endsWith('::zh')).length;
  const enCount = keys.filter(k => k.endsWith('::en')).length;
  return { total: keys.length, zh: zhCount, en: enCount };
}

/**
 * Batch generate use cases (generate + translate + cache) (批量获取使用场景（生成 + 翻译 + 缓存）)
 * @param {Array<{id: string, name: string, description: string}>} items
 * @param {string} lang - 'zh' | 'en'
 * @returns {Promise<Record<string, string>>} id -> use cases text
 */
async function batchUseCases(items, lang) {
  const c = loadCache();
  const results = {};
  const needGenerate = [];

  for (const item of items) {
    const key = `${item.id}::usecases::${lang}`;
    if (c[key]) {
      results[item.id] = c[key];
    } else {
      needGenerate.push(item);
    }
  }

  if (needGenerate.length === 0) return results;

  // Process in batches (max 10 per batch to avoid prompt overflow) (分批处理（每批最多 10 个，避免 prompt 过长）)
  const BATCH_SIZE = 10;
  for (let i = 0; i < needGenerate.length; i += BATCH_SIZE) {
    const batch = needGenerate.slice(i, i + BATCH_SIZE);
    try {
      const generated = await callClaudeUseCases(batch, lang);
      for (const item of batch) {
        const text = generated[item.id] || '';
        const key = `${item.id}::usecases::${lang}`;
        c[key] = text;
        results[item.id] = text;
      }
    } catch (e) {
      console.log(`[translator] Use case generation failed: ${e.message}`);
      for (const item of batch) {
        results[item.id] = '';
      }
    }
  }

  saveCache();
  return results;
}

/**
 * Call Claude CLI to batch generate use cases (调用 Claude CLI 批量生成使用场景)
 */
async function callClaudeUseCases(items, lang) {
  const langInstruction = lang === 'zh'
    ? '用简体中文回答。每个技能给出 2-3 个简短的使用场景，每个场景一句话。'
    : 'Answer in English. Give 2-3 brief use cases for each skill, one sentence each.';

  const entries = items.map((item, i) =>
    `[${i}] name: ${item.name} | description: ${item.description || 'N/A'}`
  ).join('\n');

  const prompt = `For each skill below, generate practical use cases. ${langInstruction}

Return ONLY a JSON object like {"0":"- Use case 1\\n- Use case 2","1":"- Use case 1\\n- Use case 2"}. No markdown fences, no explanation.

${entries}`;

  const result = await callClaude(prompt);

  try {
    const cleaned = result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);
    const output = {};
    items.forEach((item, i) => {
      output[item.id] = parsed[String(i)] || '';
    });
    return output;
  } catch {
    console.log('[translator] Use case JSON parse failed');
    return {};
  }
}

/**
 * Read translations from cache only (no Claude call, instant return) (仅从缓存读取翻译（不调 Claude，立即返回）)
 */
function getCachedTranslations(ids, lang) {
  const c = loadCache();
  const result = {};
  for (const id of ids) {
    const key = `${id}::${lang}`;
    if (c[key]) result[id] = c[key];
  }
  return result;
}

/**
 * Read use cases from cache only (no Claude call, instant return) (仅从缓存读取使用场景（不调 Claude，立即返回）)
 */
function getCachedUseCases(ids, lang) {
  const c = loadCache();
  const result = {};
  for (const id of ids) {
    const key = `${id}::usecases::${lang}`;
    if (c[key]) result[id] = c[key];
  }
  return result;
}

/**
 * Trigger background async translation (non-blocking API response) (后台异步触发翻译（不阻塞 API 响应）)
 */
let bgRunning = false;
function triggerBackgroundTranslate(items, lang) {
  if (bgRunning) return; // Avoid concurrency (避免并发)
  bgRunning = true;
  console.log(`[translator] Background translating ${items.length} skills (${lang})...`);

  (async () => {
    try {
      await batchTranslate(items, lang);
      await batchUseCases(items, lang);
      console.log(`[translator] Background translation complete (${lang})`);
    } catch (e) {
      console.log(`[translator] Background translation failed: ${e.message}`);
    } finally {
      bgRunning = false;
    }
  })();
}

module.exports = {
  getTranslation, batchTranslate, batchUseCases,
  getCachedTranslations, getCachedUseCases, triggerBackgroundTranslate,
  getCacheStats,
};

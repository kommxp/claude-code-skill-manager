const fs = require('fs');
const crypto = require('crypto');
const readline = require('readline');
const { HISTORY_FILE, STATS_CACHE, sanitizePath } = require('../utils/paths');

// 内置命令黑名单（动态生成：从 skill-scanner 提取的内置命令名）
let _builtinCache = null;
function getBuiltinCommands() {
  if (_builtinCache) return _builtinCache;
  try {
    const { scanAllSkills } = require('./skill-scanner');
    // 避免循环依赖：直接从 cli.js 提取
    const fs2 = require('fs');
    const path2 = require('path');
    const { execSync } = require('child_process');
    let cliPath = null;
    try {
      const npmRoot = execSync('npm root -g', { encoding: 'utf-8' }).trim();
      cliPath = path2.join(npmRoot, '@anthropic-ai', 'claude-code', 'cli.js');
      if (!fs2.existsSync(cliPath)) cliPath = null;
    } catch {}
    if (cliPath) {
      const source = fs2.readFileSync(cliPath, 'utf-8');
      // 匹配 type:"local-jsx",name:"xxx" — 这是内置命令的准确标记
      const regex = /type:"local-jsx",name:"([a-z][a-z0-9-]*)"/g;
      const names = new Set();
      let m;
      while ((m = regex.exec(source)) !== null) names.add(m[1]);
      _builtinCache = names;
      return names;
    }
  } catch {}
  // fallback：基础黑名单
  _builtinCache = new Set([
    'help', 'clear', 'compact', 'config', 'cost', 'doctor', 'init',
    'login', 'logout', 'mcp', 'memory', 'model', 'permissions',
    'review', 'status', 'vim', 'fast', 'add-dir', 'agents', 'branch',
    'btw', 'chrome', 'color', 'debug', 'export', 'hooks', 'ide',
    'plan', 'plugin', 'reload-plugins', 'rename', 'resume', 'stats',
    'stickers', 'theme', 'upgrade', 'usage', 'voice', 'diff',
    'copy', 'context', 'effort', 'feedback', 'heapdump', 'keybindings',
    'pr-comments', 'privacy-settings', 'security-review', 'skills',
    'think-back', 'thinkback-play', 'bridge-kick', 'brief',
    'extra-usage', 'init-verifiers', 'install-github-app', 'install-slack-app',
  ]);
  return _builtinCache;
}

// 保持向后兼容的导出名
const BUILTIN_COMMANDS = { has: (name) => getBuiltinCommands().has(name) };

/**
 * 从 history.jsonl 增量解析 skill 调用记录
 *
 * 返回: { calls: SkillCall[], lastOffset: number, lastLineHash: string }
 */
async function parseHistory(existingCalls = [], lastOffset = 0, lastLineHash = '') {
  if (!fs.existsSync(HISTORY_FILE)) {
    return { calls: [], lastOffset: 0, lastLineHash: '' };
  }

  const stat = fs.statSync(HISTORY_FILE);

  // 如果文件比上次小，说明被截断/重写，需要全量重解析
  if (stat.size < lastOffset) {
    console.log('[history-parser] 文件被截断，全量重解析');
    lastOffset = 0;
    lastLineHash = '';
    existingCalls = [];
  }

  // 如果没有增长，直接返回
  if (stat.size === lastOffset && lastOffset > 0) {
    return { calls: existingCalls, lastOffset, lastLineHash };
  }

  // 校验 lastLineHash（如果有 offset）
  if (lastOffset > 0 && lastLineHash) {
    const verified = await verifyLastLineHash(lastOffset, lastLineHash);
    if (!verified) {
      console.log('[history-parser] lastLineHash 不匹配，全量重解析');
      lastOffset = 0;
      existingCalls = [];
    }
  }

  const calls = lastOffset === 0 ? [] : [...existingCalls];
  const stream = fs.createReadStream(HISTORY_FILE, {
    encoding: 'utf-8',
    start: lastOffset,
  });

  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let newOffset = lastOffset;
  let currentLineHash = lastLineHash;
  let parseErrors = 0;

  for await (const line of rl) {
    newOffset += Buffer.byteLength(line, 'utf-8') + 1; // +1 for newline
    if (!line.trim()) continue;

    let record;
    try {
      record = JSON.parse(line);
    } catch {
      parseErrors++;
      continue;
    }

    currentLineHash = crypto.createHash('md5').update(line).digest('hex').slice(0, 16);

    const display = record.display;
    if (!display || typeof display !== 'string' || !display.startsWith('/')) continue;

    const parts = display.slice(1).split(/\s+/);
    const skillName = parts[0].toLowerCase();

    calls.push({
      skillName,
      args: parts.slice(1).join(' '),
      timestamp: record.timestamp,
      project: record.project ? sanitizePath(record.project) : null,
      sessionId: record.sessionId,
    });
  }

  if (parseErrors > 0) {
    console.log(`[history-parser] ${parseErrors} 条记录解析失败（已跳过）`);
  }

  return { calls, lastOffset: newOffset, lastLineHash: currentLineHash };
}

/**
 * 校验文件在 lastOffset 位置附近的内容是否与之前一致
 */
async function verifyLastLineHash(offset, expectedHash) {
  return new Promise((resolve) => {
    // 读取 offset 前的最后一行来校验
    const start = Math.max(0, offset - 500);
    const stream = fs.createReadStream(HISTORY_FILE, {
      encoding: 'utf-8',
      start,
      end: offset - 1,
    });

    let data = '';
    stream.on('data', (chunk) => { data += chunk; });
    stream.on('end', () => {
      const lines = data.split('\n').filter(l => l.trim());
      if (lines.length === 0) { resolve(false); return; }
      const lastLine = lines[lines.length - 1];
      const hash = crypto.createHash('md5').update(lastLine).digest('hex').slice(0, 16);
      resolve(hash === expectedHash);
    });
    stream.on('error', () => resolve(false));
  });
}

/**
 * 加载缓存的统计数据
 */
function loadStatsCache() {
  if (!fs.existsSync(STATS_CACHE)) {
    return { schemaVersion: 1, lastOffset: 0, lastLineHash: '', calls: [] };
  }
  try {
    const data = JSON.parse(fs.readFileSync(STATS_CACHE, 'utf-8'));
    if (data.schemaVersion !== 1) {
      console.log('[history-parser] schema 版本变更，全量重解析');
      return { schemaVersion: 1, lastOffset: 0, lastLineHash: '', calls: [] };
    }
    return data;
  } catch {
    return { schemaVersion: 1, lastOffset: 0, lastLineHash: '', calls: [] };
  }
}

/**
 * 保存统计缓存
 */
function saveStatsCache(data) {
  fs.writeFileSync(STATS_CACHE, JSON.stringify({
    schemaVersion: 1,
    lastOffset: data.lastOffset,
    lastLineHash: data.lastLineHash,
    calls: data.calls,
  }, null, 2), 'utf-8');
}

module.exports = { parseHistory, loadStatsCache, saveStatsCache, BUILTIN_COMMANDS };

const express = require('express');
const path = require('path');
const { parseHistory, loadStatsCache, saveStatsCache } = require('./services/history-parser');
const { scanAllSkills } = require('./services/skill-scanner');
const { aggregateStats, mergeStatsToSkills, generateOverview } = require('./services/stats-aggregator');
const { startIndexEngine, getOnlineSkills } = require('./services/discover');
const { startEnricher } = require('./services/enricher');
const { startTagger } = require('./services/tagger');
const statsRoutes = require('./routes/stats');
const skillsRoutes = require('./routes/skills');
const discoverRoutes = require('./routes/discover');

const BASE_PORT = parseInt(process.env.PORT) || 3200;
const IDLE_TIMEOUT = 30 * 60 * 1000; // 30 分钟无请求自动关闭
const app = express();
app.use(express.json());

// ============================================================
// 全局数据缓存（运行时内存）
// ============================================================
const cache = {
  skills: [],
  calls: [],
  statsMap: {},
  overview: null,
  lastOffset: 0,
  lastLineHash: '',
  initialized: false,
};

/**
 * 初始化：加载缓存 → 增量解析 history → 扫描 skill → 合并
 */
async function initialize() {
  console.log('[init] 开始加载数据...');
  const startTime = Date.now();

  // 1. 加载 stats 缓存
  const statsCache = loadStatsCache();

  // 2. 增量解析 history
  const historyResult = await parseHistory(
    statsCache.calls || [],
    statsCache.lastOffset || 0,
    statsCache.lastLineHash || ''
  );

  cache.calls = historyResult.calls;
  cache.lastOffset = historyResult.lastOffset;
  cache.lastLineHash = historyResult.lastLineHash;

  // 3. 保存更新后的缓存
  saveStatsCache({
    lastOffset: cache.lastOffset,
    lastLineHash: cache.lastLineHash,
    calls: cache.calls,
  });

  // 4. 扫描本地 skill
  cache.skills = scanAllSkills();

  // 5. 聚合统计
  cache.statsMap = aggregateStats(cache.calls);
  mergeStatsToSkills(cache.skills, cache.statsMap);

  // 6. 生成总览
  cache.overview = generateOverview(cache.skills, cache.calls);

  cache.initialized = true;
  const elapsed = Date.now() - startTime;
  console.log(`[init] 加载完成 (${elapsed}ms) — ${cache.skills.length} skills, ${cache.calls.length} calls`);
}

/**
 * 刷新数据（增量）
 */
async function refresh() {
  const historyResult = await parseHistory(cache.calls, cache.lastOffset, cache.lastLineHash);
  cache.calls = historyResult.calls;
  cache.lastOffset = historyResult.lastOffset;
  cache.lastLineHash = historyResult.lastLineHash;

  saveStatsCache({
    lastOffset: cache.lastOffset,
    lastLineHash: cache.lastLineHash,
    calls: cache.calls,
  });

  cache.skills = scanAllSkills();
  cache.statsMap = aggregateStats(cache.calls);
  mergeStatsToSkills(cache.skills, cache.statsMap);
  cache.overview = generateOverview(cache.skills, cache.calls);
}

// 空闲自动关闭
let lastActivityAt = Date.now();
let idleTimer = null;

function resetIdleTimer() {
  lastActivityAt = Date.now();
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    const idle = Date.now() - lastActivityAt;
    if (idle >= IDLE_TIMEOUT) {
      console.log(`\n[idle] ${IDLE_TIMEOUT / 60000} 分钟无请求，自动关闭`);
      process.exit(0);
    }
  }, IDLE_TIMEOUT + 1000);
  if (idleTimer.unref) idleTimer.unref();
}

// 把 cache 和 refresh 注入到请求上下文，同时追踪活跃
app.use((req, res, next) => {
  req.cache = cache;
  req.refresh = refresh;
  // 只有前端页面和 API 请求才算活跃（排除 favicon 等静态资源）
  if (req.path.startsWith('/api') || req.path === '/') {
    resetIdleTimer();
  }
  next();
});

// ============================================================
// 路由
// ============================================================
app.use('/api/stats', statsRoutes);
app.use('/api/skills', skillsRoutes);
app.use('/api/discover', discoverRoutes);

// 刷新接口
app.post('/api/refresh', async (req, res) => {
  try {
    await refresh();
    res.json({ ok: true, skills: cache.skills.length, calls: cache.calls.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    initialized: cache.initialized,
    skills: cache.skills.length,
    calls: cache.calls.length,
  });
});

// 配置读写
app.get('/api/config', (req, res) => {
  const cfg = loadStartupConfig();
  res.json({
    githubToken: cfg.githubToken ? '***' + cfg.githubToken.slice(-4) : '',
  });
});

app.post('/api/config', (req, res) => {
  const fs = require('fs');
  const { CONFIG_FILE } = require('./utils/paths');
  let cfg = {};
  if (fs.existsSync(CONFIG_FILE)) {
    try { cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')); } catch {}
  }
  if (req.body.githubToken !== undefined) {
    cfg.githubToken = req.body.githubToken;
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
  res.json({ ok: true });
});

// 静态文件托管（Vite 构建产物，M2 时实现）
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));
app.get('*', (req, res) => {
  const indexPath = path.join(distPath, 'index.html');
  if (require('fs').existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.json({ message: 'Skill Manager API is running. Frontend not built yet.' });
  }
});

// ============================================================
// 启动
// ============================================================
/**
 * 找一个可用端口（从 basePort 开始，最多试 10 个）
 */
function findAvailablePort(basePort) {
  const net = require('net');
  return new Promise((resolve) => {
    let port = basePort;
    function tryPort() {
      if (port > basePort + 10) {
        resolve(basePort); // 都试完了，用默认的
        return;
      }
      const server = net.createServer();
      server.once('error', () => { port++; tryPort(); });
      server.once('listening', () => { server.close(() => resolve(port)); });
      server.listen(port, '127.0.0.1');
    }
    tryPort();
  });
}

/**
 * 打开浏览器
 */
function openBrowser(url) {
  const { exec } = require('child_process');
  const cmd = process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

async function start() {
  await initialize();

  // 启动在线 skill 索引引擎（后台自动发现 & 维护）
  const config = loadStartupConfig();
  startIndexEngine(config.githubToken);

  // 启动描述富化引擎（后台慢补翻译 + 使用场景）
  startEnricher(() => getOnlineSkills(config.githubToken));

  // 启动标签引擎（后台慢补 AI 自动打标签）
  startTagger(() => getOnlineSkills(config.githubToken));

  // 自动找可用端口
  const port = await findAvailablePort(BASE_PORT);

  app.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}`;
    console.log(`\n🚀 Skill Manager running at ${url}`);
    console.log(`   Skills: ${cache.skills.length} | Calls: ${cache.calls.length}`);
    if (port !== BASE_PORT) {
      console.log(`   (端口 ${BASE_PORT} 被占用，使用 ${port})`);
    }
    console.log(`   空闲 ${IDLE_TIMEOUT / 60000} 分钟后自动关闭\n`);

    // 自动打开浏览器（除非设置了 NO_BROWSER 环境变量）
    if (!process.env.NO_BROWSER) {
      openBrowser(url);
    }

    // 启动空闲计时
    resetIdleTimer();
  });
}

function loadStartupConfig() {
  const fs = require('fs');
  const { CONFIG_FILE } = require('./utils/paths');
  if (!fs.existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

start().catch(err => {
  console.error('启动失败:', err);
  process.exit(1);
});

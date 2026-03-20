const express = require('express');
const { getCacheStats } = require('../services/translator');
const router = express.Router();

// GET /api/stats/overview
router.get('/overview', (req, res) => {
  res.json(req.cache.overview);
});

// GET /api/stats/skill/:name
router.get('/skill/:name', (req, res) => {
  const name = req.params.name.toLowerCase();
  const stats = req.cache.statsMap[name];
  if (!stats) {
    return res.status(404).json({ error: `Skill "${name}" not found in history` });
  }
  res.json({ name, ...stats });
});

// GET /api/stats/trend?range=7d&skill=xxx
router.get('/trend', (req, res) => {
  const range = req.query.range || '30d';
  const skillFilter = req.query.skill?.toLowerCase();
  const days = range === '7d' ? 7 : range === '30d' ? 30 : range === '90d' ? 90 : 30;

  const now = Date.now();
  const cutoff = now - days * 24 * 60 * 60 * 1000;

  let filteredCalls = req.cache.calls.filter(c => c.timestamp > cutoff);
  if (skillFilter) {
    filteredCalls = filteredCalls.filter(c => c.skillName === skillFilter);
  }

  // 按日期聚合
  const byDate = {};
  for (const call of filteredCalls) {
    const date = new Date(call.timestamp).toISOString().slice(0, 10);
    byDate[date] = (byDate[date] || 0) + 1;
  }

  // 填充缺失日期
  const result = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now - i * 24 * 60 * 60 * 1000);
    const date = d.toISOString().slice(0, 10);
    result.push({ date, count: byDate[date] || 0 });
  }

  res.json({ range, skill: skillFilter || 'all', data: result });
});

// GET /api/stats/heatmap
router.get('/heatmap', (req, res) => {
  // GitHub 风格热力图：按天统计过去 365 天
  const now = Date.now();
  const yearAgo = now - 365 * 24 * 60 * 60 * 1000;

  const byDate = {};
  for (const call of req.cache.calls) {
    if (call.timestamp < yearAgo) continue;
    const date = new Date(call.timestamp).toISOString().slice(0, 10);
    byDate[date] = (byDate[date] || 0) + 1;
  }

  const data = [];
  for (let i = 364; i >= 0; i--) {
    const d = new Date(now - i * 24 * 60 * 60 * 1000);
    const date = d.toISOString().slice(0, 10);
    data.push({ date, count: byDate[date] || 0 });
  }

  res.json({ data });
});

// GET /api/stats/translations — 翻译缓存统计
router.get('/translations', (req, res) => {
  res.json(getCacheStats());
});

module.exports = router;

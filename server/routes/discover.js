const express = require('express');
const { getOnlineSkills, getCategories, markInstalled } = require('../services/discover');
const { applyDescriptions, getSkillDetail } = require('../services/enricher');
const { applyTags, tagSkill, getTagEnums } = require('../services/tagger');
const router = express.Router();

// GET /api/discover — 在线 skill 目录
router.get('/', async (req, res) => {
  const { category, action, complexity, search, sort, source: sourceFilter, lang, page: pageStr, pageSize: pageSizeStr } = req.query;
  const page = Math.max(1, parseInt(pageStr) || 1);
  const pageSize = Math.min(200, Math.max(10, parseInt(pageSizeStr) || 60));
  const currentLang = lang || 'en';

  try {
    const config = loadConfig();
    let skills = await getOnlineSkills(config.githubToken);

    // 标注已安装
    skills = markInstalled(skills, req.cache.skills);

    // 附加已有的中文描述和使用场景
    applyDescriptions(skills);

    // 附加已有的标签
    applyTags(skills, currentLang);

    // 按来源筛选
    if (sourceFilter) {
      skills = skills.filter(s => s.sourceType === sourceFilter || s.source === sourceFilter);
    }

    // 按分类筛选
    if (category && category !== 'all') {
      skills = skills.filter(s => s.category === category);
    }

    // 按动作筛选
    if (action && action !== 'all') {
      skills = skills.filter(s => s.actions && s.actions.includes(action));
    }

    // 按复杂度筛选
    if (complexity && complexity !== 'all') {
      skills = skills.filter(s => s.complexity === complexity);
    }

    // 搜索（同时搜中英文描述 + 标签）
    if (search) {
      const q = search.toLowerCase();
      skills = skills.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        (s.descriptionZh && s.descriptionZh.toLowerCase().includes(q)) ||
        (s.useCaseZh && s.useCaseZh.toLowerCase().includes(q)) ||
        (s.useCaseEn && s.useCaseEn.toLowerCase().includes(q)) ||
        (s.categoryLabel && s.categoryLabel.toLowerCase().includes(q)) ||
        (s.targets && s.targets.some(t => t.toLowerCase().includes(q))) ||
        (s.keywords && s.keywords.some(k => k.toLowerCase().includes(q)))
      );
    }

    // 排序（每种排序都加 name 兜底，保证稳定）
    if (sort === 'hot') {
      skills.sort((a, b) => {
        const diff = (b.repoStars || 0) - (a.repoStars || 0);
        return diff !== 0 ? diff : a.name.localeCompare(b.name);
      });
    } else if (sort === 'score') {
      skills.sort((a, b) => {
        const diff = (b.score || 0) - (a.score || 0);
        return diff !== 0 ? diff : a.name.localeCompare(b.name);
      });
    } else if (sort === 'recent') {
      skills.sort((a, b) => {
        const ta = a.pushedAt ? new Date(a.pushedAt).getTime() : 0;
        const tb = b.pushedAt ? new Date(b.pushedAt).getTime() : 0;
        const diff = tb - ta;
        return diff !== 0 ? diff : a.name.localeCompare(b.name);
      });
    } else if (sort === 'name') {
      skills.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      // 默认：已安装排后面 → score → name
      skills.sort((a, b) => {
        if (a.installed !== b.installed) return a.installed ? 1 : -1;
        const diff = (b.score || 0) - (a.score || 0);
        return diff !== 0 ? diff : a.name.localeCompare(b.name);
      });
    }

    // 分页
    const total = skills.length;
    const start = (page - 1) * pageSize;
    const paged = skills.slice(start, start + pageSize);

    res.json({
      skills: paged,
      total,
      page,
      pageSize,
      hasMore: start + pageSize < total,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/discover/detail?url=xxx — 按需获取单个 skill 详细信息（含翻译）
router.get('/detail', async (req, res) => {
  const { url, name } = req.query;
  if (!url && !name) {
    return res.status(400).json({ error: 'url or name required' });
  }

  try {
    const config = loadConfig();
    const skills = await getOnlineSkills(config.githubToken);

    // 找到目标 skill
    const skill = skills.find(s =>
      (url && s.repoUrl === url) ||
      (name && s.name.toLowerCase() === name.toLowerCase())
    );

    if (!skill) {
      return res.status(404).json({ error: 'Skill not found' });
    }

    // 按需拉详情 + 翻译
    const detail = await getSkillDetail(skill, config.githubToken);

    // 按需打标签
    const tags = await tagSkill(skill);

    res.json({
      ...skill,
      descriptionEn: detail?.en || skill.description,
      descriptionZh: detail?.zh || null,
      useCaseZh: detail?.useCaseZh || null,
      useCaseEn: detail?.useCaseEn || null,
      category: tags?.category || skill.category,
      actions: tags?.actions || skill.actions || [],
      targets: tags?.targets || skill.targets || [],
      complexity: tags?.complexity || skill.complexity,
      confidence: tags?.confidence,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/discover/enums — 标签枚举定义（前端筛选器用）
router.get('/enums', (req, res) => {
  res.json(getTagEnums());
});

// GET /api/discover/categories — 分类列表（基于 applyTags 后的实际 category 统计）
router.get('/categories', async (req, res) => {
  try {
    const config = loadConfig();
    let skills = await getOnlineSkills(config.githubToken);
    // 先 applyTags 再统计，保证和列表页筛选一致
    applyTags(skills, req.query.lang || 'en');
    res.json(getCategories(skills));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/discover/refresh — 手动强制刷新
router.post('/refresh', async (req, res) => {
  try {
    const config = loadConfig();
    const skills = await getOnlineSkills(config.githubToken, true);
    res.json({ ok: true, count: skills.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function loadConfig() {
  const fs = require('fs');
  const { CONFIG_FILE } = require('../utils/paths');
  if (!fs.existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

module.exports = router;

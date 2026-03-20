const express = require('express');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { loadDisabledList, saveDisabledList } = require('../services/skill-scanner');
const { batchTranslate, batchUseCases, getCacheStats } = require('../services/translator');
const router = express.Router();

// GET /api/skills — Full skill list (全部 skill 列表)
router.get('/', async (req, res) => {
  const { source, search, sort, lang, type } = req.query;
  let skills = [...req.cache.skills];

  // Type filter (type 过滤):
  //   default — locally available skills (custom + built-in bundled) (本地可用的技能（自建 + 内置 bundled）)
  //   all     — everything (including uninstalled marketplace + implicit skills) (全部（含 marketplace 未安装的 + 隐式 skill）)
  //   marketplace — marketplace commands + skills (not necessarily installed) (marketplace 中的 command + skill（未必已安装）)
  if (type === 'all') {
    // No filter (不过滤)
  } else if (type === 'marketplace') {
    skills = skills.filter(s => s.source !== 'custom' && s.source !== 'bundled');
  } else {
    // Default: custom + built-in (locally available) (默认：自建 + 内置（本地实际可用的）)
    skills = skills.filter(s => s.source === 'custom' || s.source === 'bundled');
  }

  // Filter by source (按来源筛选)
  if (source) {
    skills = skills.filter(s => s.source === source);
  }

  // Search (搜索)
  if (search) {
    const q = search.toLowerCase();
    skills = skills.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      (s.keywords && s.keywords.some(k => k.toLowerCase().includes(q)))
    );
  }

  // Sort (排序)
  if (sort === 'calls') {
    skills.sort((a, b) => (b.stats?.totalCalls || 0) - (a.stats?.totalCalls || 0));
  } else if (sort === 'recent') {
    skills.sort((a, b) => (b.stats?.lastUsed || 0) - (a.stats?.lastUsed || 0));
  } else if (sort === 'name') {
    skills.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    // Default: group by source, custom first (默认：按来源分组，custom 在前)
    const sourceOrder = { custom: 0, official: 1, trailofbits: 2, external: 3 };
    skills.sort((a, b) => (sourceOrder[a.source] || 9) - (sourceOrder[b.source] || 9));
  }

  // Don't return content field (list mode slim), add invokeCommand (correct / invocation format) (不返回 content 字段（列表模式精简），添加 invokeCommand（正确的 / 调用格式）)
  let list = skills.map(({ content, ...rest }) => {
    // Custom skill: /name, plugin command: /pluginName:commandName (自建 skill: /name，插件 command: /pluginName:commandName)
    const invokeCommand = rest.pluginName
      ? `/${rest.pluginName}:${rest.name}`
      : `/${rest.name}`;
    return { ...rest, invokeCommand };
  });

  // Translation: read from cache only, don't wait for Claude calls (翻译：仅从缓存读取，不等 Claude 调用)
  // Uncached entries return original text, background async translation (未缓存的条目返回原文，后台异步翻译)
  if (lang && (lang === 'zh' || lang === 'en')) {
    const { getCachedTranslations, getCachedUseCases, triggerBackgroundTranslate } = require('../services/translator');
    const cachedDesc = getCachedTranslations(list.map(s => s.id), lang);
    const cachedUC = getCachedUseCases(list.map(s => s.id), lang);

    list = list.map(s => ({
      ...s,
      description: cachedDesc[s.id] || s.description,
      descriptionOriginal: cachedDesc[s.id] ? s.description : undefined,
      useCases: cachedUC[s.id] || '',
    }));

    // Trigger background translation for uncached items (non-blocking response) (后台触发未缓存项的翻译（不阻塞响应）)
    const uncachedItems = req.cache.skills
      .filter(s => !cachedDesc[s.id] || !cachedUC[s.id])
      .map(s => ({ id: s.id, name: s.name, description: s.description }));
    if (uncachedItems.length > 0) {
      triggerBackgroundTranslate(uncachedItems, lang);
    }
  }

  res.json(list);
});

// GET /api/skills/:id — Single skill detail (单个 skill 详情)
router.get('/:id', async (req, res) => {
  const skill = req.cache.skills.find(s => s.id === req.params.id);
  if (!skill) {
    return res.status(404).json({ error: `Skill "${req.params.id}" not found` });
  }

  const { lang } = req.query;
  if (lang && (lang === 'zh' || lang === 'en')) {
    const { getCachedTranslations, getCachedUseCases, triggerBackgroundTranslate } = require('../services/translator');
    const cachedDesc = getCachedTranslations([skill.id], lang);
    const cachedUC = getCachedUseCases([skill.id], lang);

    const result = {
      ...skill,
      description: cachedDesc[skill.id] || skill.description,
      descriptionOriginal: cachedDesc[skill.id] ? skill.description : undefined,
      useCases: cachedUC[skill.id] || '',
    };

    // If not cached, trigger background translation (如果没缓存，后台触发翻译)
    if (!cachedDesc[skill.id] || !cachedUC[skill.id]) {
      triggerBackgroundTranslate(
        [{ id: skill.id, name: skill.name, description: skill.description }],
        lang
      );
    }

    return res.json(result);
  }

  res.json(skill);
});

// GET /api/skills/:id/raw — skill.md raw content (skill.md 原始内容)
router.get('/:id/raw', (req, res) => {
  const skill = req.cache.skills.find(s => s.id === req.params.id);
  if (!skill) {
    return res.status(404).json({ error: `Skill "${req.params.id}" not found` });
  }
  res.type('text/plain').send(skill.content);
});

// POST /api/skills/:id/open — Open in editor (用编辑器打开)
router.post('/:id/open', (req, res) => {
  const skill = req.cache.skills.find(s => s.id === req.params.id);
  if (!skill) {
    return res.status(404).json({ error: `Skill "${req.params.id}" not found` });
  }

  const filePath = skill.filePath.replace(/\//g, path.sep);
  const cmd = process.platform === 'win32' ? `code "${filePath}"` : `open "${filePath}"`;

  exec(cmd, (err) => {
    if (err) {
      return res.status(500).json({ error: `Failed to open: ${err.message}` });
    }
    res.json({ ok: true });
  });
});

// POST /api/skills/:id/toggle — Enable/disable (custom only) (启用/禁用（仅用户自建）)
router.post('/:id/toggle', async (req, res) => {
  const skill = req.cache.skills.find(s => s.id === req.params.id);
  if (!skill) {
    return res.status(404).json({ error: `Skill "${req.params.id}" not found` });
  }
  if (skill.source !== 'custom') {
    return res.status(403).json({ error: 'Only custom skills can be toggled' });
  }

  const disabled = loadDisabledList();
  const isCurrentlyDisabled = disabled.includes(skill.id);

  if (isCurrentlyDisabled) {
    // Enable: remove from list + rename file (启用：从列表移除 + 重命名文件)
    const newList = disabled.filter(id => id !== skill.id);
    saveDisabledList(newList);

    const disabledPath = skill.filePath.replace(/\//g, path.sep) + '.disabled';
    const enabledPath = skill.filePath.replace(/\//g, path.sep);
    if (fs.existsSync(disabledPath) && !fs.existsSync(enabledPath)) {
      fs.renameSync(disabledPath, enabledPath);
    }
  } else {
    // Disable: add to list + rename file (禁用：加入列表 + 重命名文件)
    disabled.push(skill.id);
    saveDisabledList(disabled);

    const enabledPath = skill.filePath.replace(/\//g, path.sep);
    const disabledPath = enabledPath + '.disabled';
    if (fs.existsSync(enabledPath)) {
      fs.renameSync(enabledPath, disabledPath);
    }
  }

  await req.refresh();
  res.json({ ok: true, enabled: isCurrentlyDisabled });
});

// DELETE /api/skills/:id — Uninstall (custom only) (卸载（仅用户自建）)
router.delete('/:id', async (req, res) => {
  const skill = req.cache.skills.find(s => s.id === req.params.id);
  if (!skill) {
    return res.status(404).json({ error: `Skill "${req.params.id}" not found` });
  }
  if (skill.source !== 'custom') {
    return res.status(403).json({ error: 'Only custom skills can be deleted' });
  }

  // Delete entire skill directory (删除整个 skill 目录)
  const skillDir = path.dirname(skill.filePath.replace(/\//g, path.sep));
  try {
    fs.rmSync(skillDir, { recursive: true, force: true });
  } catch (e) {
    return res.status(500).json({ error: `Failed to delete: ${e.message}` });
  }

  // Remove from disabled list (从禁用列表移除)
  const disabled = loadDisabledList();
  saveDisabledList(disabled.filter(id => id !== skill.id));

  await req.refresh();
  res.json({ ok: true });
});

module.exports = router;

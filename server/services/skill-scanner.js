const fs = require('fs');
const path = require('path');
const { SKILLS_DIR, PLUGINS_DIR, toPosix } = require('../utils/paths');
const { parseFrontmatter } = require('../utils/frontmatter');
const { loadConfig, saveConfig } = require('../utils/config');

/**
 * Scan all local skills/commands/plugins, return unified array (扫描所有本地 skill/command/plugin，返回统一数组)
 *
 * type descriptions (type 说明):
 *   - 'command'  -> commands/*.md, appears in / menu, user can invoke directly (出现在 / 菜单中，用户可直接调用)
 *   - 'skill'    -> skills/SKILL.md, implicit skill, Claude auto-triggers based on conversation intent (隐式技能，Claude 根据对话意图自动触发)
 *   - 'custom'   -> ~/.claude/skills/ user-created, invocable via / by default (用户自建，默认可 / 调用)
 *   - 'external' -> external_plugins/, MCP integrations etc. (MCP 集成等)
 */
function scanAllSkills() {
  const skills = [];
  const errors = [];
  const disabledSkills = loadDisabledList();

  // 0a. Claude Code built-in commands (dynamically extracted from cli.js source) (Claude Code 内置命令（从 cli.js 源码动态提取）)
  const bundledSkills = extractBuiltinCommands();
  for (const b of bundledSkills) {
    skills.push({
      id: `bundled--${b.name}`,
      name: b.name,
      description: b.description,
      version: null,
      author: { name: 'Anthropic' },
      source: 'bundled',
      type: 'command',
      category: null,
      keywords: [],
      userInvocable: true,
      disableModelInvocation: false,
      allowedTools: [],
      enabled: true,
      filePath: null,
      content: '',
      stats: null,
    });
  }

  // 0b. Claude Code built-in skills (registered via Qw() in cli.js) (Claude Code 内置 skill（通过 Qw() 在 cli.js 中注册）)
  const builtinSkills = extractBuiltinSkills();
  for (const b of builtinSkills) {
    // Skip if already added as bundled command (跳过已作为 bundled command 添加的)
    if (skills.some(s => s.name === b.name)) continue;
    skills.push({
      id: `bundled--${b.name}`,
      name: b.name,
      description: b.description,
      version: null,
      author: { name: 'Anthropic' },
      source: 'bundled',
      type: 'skill',
      category: null,
      keywords: [],
      userInvocable: b.userInvocable,
      disableModelInvocation: false,
      allowedTools: [],
      enabled: true,
      filePath: null,
      content: '',
      stats: null,
    });
  }

  // 1. User-created skills (用户自建 skill)
  if (fs.existsSync(SKILLS_DIR)) {
    const dirs = safeReaddir(SKILLS_DIR);
    for (const dir of dirs) {
      try {
        const skill = scanCustomSkill(dir, disabledSkills);
        if (skill) skills.push(skill);
      } catch (e) {
        errors.push({ source: 'custom', name: dir, error: e.message });
      }
    }
  }

  // 2. Marketplace plugins (Marketplace 插件)
  if (fs.existsSync(PLUGINS_DIR)) {
    const marketplaces = safeReaddir(PLUGINS_DIR);
    for (const mp of marketplaces) {
      try {
        const mpSkills = scanMarketplace(mp, disabledSkills);
        skills.push(...mpSkills);
      } catch (e) {
        errors.push({ source: 'marketplace', name: mp, error: e.message });
      }
    }
  }

  if (errors.length > 0) {
    console.log(`[skill-scanner] ${errors.length} scan errors (skipped):`);
    for (const err of errors) {
      console.log(`  - ${err.source}/${err.name}: ${err.error}`);
    }
  }

  return skills;
}

/**
 * Scan a single user-created skill (扫描单个用户自建 skill)
 */
function scanCustomSkill(dirName, disabledSkills) {
  const dirPath = path.join(SKILLS_DIR, dirName);
  if (!fs.statSync(dirPath).isDirectory()) return null;

  const skillMd = findSkillMd(dirPath);
  if (!skillMd) return null;

  const content = fs.readFileSync(skillMd, 'utf-8');
  const { attributes: fm } = parseFrontmatter(content);

  const name = fm.name || dirName;
  const id = `custom--${name}`;
  const isFileDisabled = fs.existsSync(skillMd + '.disabled') && !fs.existsSync(skillMd);

  return {
    id,
    name,
    description: fm.description || '',
    version: fm.version || null,
    author: null,
    source: 'custom',
    type: 'command', // Custom skills are invocable via / by default (自建 skill 默认可 / 调用)
    category: null,
    keywords: fm.keywords ? fm.keywords.split(',').map(k => k.trim()) : [],
    userInvocable: fm['user-invocable'] !== false,
    disableModelInvocation: fm['disable-model-invocation'] === true,
    allowedTools: fm['allowed-tools'] ? fm['allowed-tools'].split(',').map(t => t.trim()) : [],
    enabled: !disabledSkills.includes(id) && !isFileDisabled,
    filePath: toPosix(skillMd),
    content,
    stats: null,
  };
}

/**
 * Scan all plugins under a marketplace (扫描 marketplace 下的所有插件)
 */
function scanMarketplace(mpName, disabledSkills) {
  const mpPath = path.join(PLUGINS_DIR, mpName);
  if (!fs.statSync(mpPath).isDirectory()) return [];

  const source = mpName.includes('official') ? 'official'
    : mpName.includes('trailofbits') ? 'trailofbits'
    : 'external';

  const results = [];

  // Scan plugins/ subdirectory (扫描 plugins/ 子目录)
  const pluginsPath = path.join(mpPath, 'plugins');
  if (fs.existsSync(pluginsPath)) {
    const plugins = safeReaddir(pluginsPath);
    for (const pluginName of plugins) {
      try {
        const pluginDir = path.join(pluginsPath, pluginName);
        if (!fs.statSync(pluginDir).isDirectory()) continue;

        // Read .claude-plugin/plugin.json — if not present, plugin is not installed, skip (读取 .claude-plugin/plugin.json — 没有此文件说明 plugin 未安装，跳过)
        const cpPluginJson = path.join(pluginDir, '.claude-plugin', 'plugin.json');
        if (!fs.existsSync(cpPluginJson)) continue;

        let pluginMeta = {};
        try { pluginMeta = JSON.parse(fs.readFileSync(cpPluginJson, 'utf-8')); } catch {}

        // ===== Scan commands/ directory (/ invocable commands) (扫描 commands/ 目录（/ 可调用的命令）) =====
        const commandsDir = path.join(pluginDir, 'commands');
        if (fs.existsSync(commandsDir)) {
          const cmdFiles = safeReaddirFiles(commandsDir, '.md');
          for (const cmdFile of cmdFiles) {
            try {
              const cmdPath = path.join(commandsDir, cmdFile);
              const content = fs.readFileSync(cmdPath, 'utf-8');
              const { attributes: fm } = parseFrontmatter(content);
              const name = cmdFile.replace(/\.md$/, '');
              const id = `${source}--${name}`;

              results.push({
                id,
                name,
                description: fm.description || pluginMeta.description || '',
                version: pluginMeta.version || null,
                author: pluginMeta.author || null,
                source,
                type: 'command',
                category: pluginMeta.category || null,
                keywords: pluginMeta.keywords || [],
                userInvocable: true,
                disableModelInvocation: fm['disable-model-invocation'] === true,
                allowedTools: fm['allowed-tools'] ? fm['allowed-tools'].split(',').map(t => t.trim()) : [],
                enabled: !disabledSkills.includes(id),
                filePath: toPosix(cmdPath),
                content,
                pluginName,
                stats: null,
              });
            } catch {}
          }
        }

        // ===== Scan skills/ directory (implicit skills, Claude auto-triggers) (扫描 skills/ 目录（隐式技能，Claude 自动触发）) =====
        const skillsSubDir = path.join(pluginDir, 'skills');
        if (fs.existsSync(skillsSubDir)) {
          const skillDirs = safeReaddir(skillsSubDir);
          for (const skillDir of skillDirs) {
            const skillDirPath = path.join(skillsSubDir, skillDir);
            if (!fs.statSync(skillDirPath).isDirectory()) continue;

            const skillMd = findSkillMd(skillDirPath);
            if (!skillMd) continue;

            try {
              const content = fs.readFileSync(skillMd, 'utf-8');
              const { attributes: fm } = parseFrontmatter(content);
              const name = fm.name || skillDir;
              const id = `${source}--${name}`;

              results.push({
                id,
                name,
                description: fm.description || pluginMeta.description || '',
                version: fm.version || pluginMeta.version || null,
                author: pluginMeta.author || null,
                source,
                type: 'skill',
                category: pluginMeta.category || null,
                keywords: pluginMeta.keywords || [],
                userInvocable: false, // Implicit skills cannot be / invoked (隐式技能不可 / 调用)
                disableModelInvocation: fm['disable-model-invocation'] === true,
                allowedTools: fm['allowed-tools'] ? fm['allowed-tools'].split(',').map(t => t.trim()) : [],
                enabled: !disabledSkills.includes(id),
                filePath: toPosix(skillMd),
                content,
                pluginName,
                stats: null,
              });
            } catch {}
          }
        }

        // If plugin has neither commands nor skills directory, check root SKILL.md (如果 plugin 既没有 commands 也没有 skills 目录，检查根 SKILL.md)
        const hasCommands = fs.existsSync(commandsDir) && safeReaddirFiles(commandsDir, '.md').length > 0;
        const hasSkills = fs.existsSync(skillsSubDir) && safeReaddir(skillsSubDir).length > 0;
        if (!hasCommands && !hasSkills) {
          const rootSkillMd = findSkillMd(pluginDir);
          if (rootSkillMd) {
            try {
              const content = fs.readFileSync(rootSkillMd, 'utf-8');
              const { attributes: fm } = parseFrontmatter(content);
              const name = fm.name || pluginName;
              const id = `${source}--${name}`;

              results.push({
                id,
                name,
                description: fm.description || pluginMeta.description || '',
                version: fm.version || pluginMeta.version || null,
                author: pluginMeta.author || null,
                source,
                type: 'skill',
                category: pluginMeta.category || null,
                keywords: pluginMeta.keywords || [],
                userInvocable: false,
                disableModelInvocation: fm['disable-model-invocation'] === true,
                allowedTools: fm['allowed-tools'] ? fm['allowed-tools'].split(',').map(t => t.trim()) : [],
                enabled: !disabledSkills.includes(id),
                filePath: toPosix(rootSkillMd),
                content,
                pluginName,
                stats: null,
              });
            } catch {}
          }
        }
      } catch {}
    }
  }

  // Scan external_plugins/ (扫描 external_plugins/)
  const extPath = path.join(mpPath, 'external_plugins');
  if (fs.existsSync(extPath)) {
    const exts = safeReaddir(extPath);
    for (const extName of exts) {
      try {
        const extDir = path.join(extPath, extName);
        if (!fs.statSync(extDir).isDirectory()) continue;

        // Read .claude-plugin/plugin.json (读取 .claude-plugin/plugin.json)
        let pluginMeta = {};
        const cpPluginJson = path.join(extDir, '.claude-plugin', 'plugin.json');
        if (fs.existsSync(cpPluginJson)) {
          try { pluginMeta = JSON.parse(fs.readFileSync(cpPluginJson, 'utf-8')); } catch {}
        }

        // Scan commands (扫描 commands)
        const commandsDir = path.join(extDir, 'commands');
        if (fs.existsSync(commandsDir)) {
          const cmdFiles = safeReaddirFiles(commandsDir, '.md');
          for (const cmdFile of cmdFiles) {
            try {
              const cmdPath = path.join(commandsDir, cmdFile);
              const content = fs.readFileSync(cmdPath, 'utf-8');
              const { attributes: fm } = parseFrontmatter(content);
              const name = cmdFile.replace(/\.md$/, '');
              const id = `external--${name}`;

              results.push({
                id,
                name,
                description: fm.description || pluginMeta.description || '',
                version: pluginMeta.version || null,
                author: pluginMeta.author || null,
                source: 'external',
                type: 'command',
                category: pluginMeta.category || null,
                keywords: pluginMeta.keywords || [],
                userInvocable: true,
                disableModelInvocation: false,
                allowedTools: fm['allowed-tools'] ? fm['allowed-tools'].split(',').map(t => t.trim()) : [],
                enabled: !disabledSkills.includes(id),
                filePath: toPosix(cmdPath),
                content,
                pluginName: extName,
                stats: null,
              });
            } catch {}
          }
        }

        // Scan skills (扫描 skills)
        const skillsDir = path.join(extDir, 'skills');
        if (fs.existsSync(skillsDir)) {
          const skillDirs = safeReaddir(skillsDir);
          for (const skillDir of skillDirs) {
            const skillDirPath = path.join(skillsDir, skillDir);
            if (!fs.statSync(skillDirPath).isDirectory()) continue;
            const skillMd = findSkillMd(skillDirPath);
            if (!skillMd) continue;
            try {
              const content = fs.readFileSync(skillMd, 'utf-8');
              const { attributes: fm } = parseFrontmatter(content);
              const name = fm.name || skillDir;
              const id = `external--${name}`;
              results.push({
                id, name,
                description: fm.description || pluginMeta.description || '',
                version: pluginMeta.version || null,
                author: pluginMeta.author || null,
                source: 'external', type: 'skill',
                category: pluginMeta.category || null,
                keywords: pluginMeta.keywords || [],
                userInvocable: false,
                disableModelInvocation: fm['disable-model-invocation'] === true,
                allowedTools: fm['allowed-tools'] ? fm['allowed-tools'].split(',').map(t => t.trim()) : [],
                enabled: !disabledSkills.includes(id),
                filePath: toPosix(skillMd),
                content, pluginName: extName, stats: null,
              });
            } catch {}
          }
        }

        // If no commands or skills, add as external entry (如果没有 commands 也没有 skills，作为 external 整体条目)
        const hasCmd = fs.existsSync(commandsDir) && safeReaddirFiles(commandsDir, '.md').length > 0;
        const hasSkl = fs.existsSync(skillsDir) && safeReaddir(skillsDir).length > 0;
        if (!hasCmd && !hasSkl) {
          const id = `external--${extName}`;
          results.push({
            id,
            name: pluginMeta.name || extName,
            description: pluginMeta.description || '',
            version: pluginMeta.version || null,
            author: pluginMeta.author || null,
            source: 'external',
            type: 'command', // MCP integrations are invocable by default (MCP 集成默认可调用)
            category: pluginMeta.category || null,
            keywords: pluginMeta.keywords || [],
            userInvocable: true,
            disableModelInvocation: false,
            allowedTools: [],
            enabled: !disabledSkills.includes(id),
            filePath: toPosix(extDir),
            content: '',
            pluginName: extName,
            stats: null,
          });
        }
      } catch {}
    }
  }

  return results;
}

// ============================================================
// Helper functions (辅助函数)
// ============================================================

function findSkillMd(dirPath) {
  for (const name of ['SKILL.md', 'skill.md', 'Skill.md']) {
    const p = path.join(dirPath, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function safeReaddir(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch {
    return [];
  }
}

function safeReaddirFiles(dirPath, ext) {
  try {
    return fs.readdirSync(dirPath)
      .filter(f => f.endsWith(ext));
  } catch {
    return [];
  }
}

function loadDisabledList() {
  const config = loadConfig();
  return config.disabledSkills || [];
}

function saveDisabledList(disabledSkills) {
  const config = loadConfig();
  config.disabledSkills = disabledSkills;
  saveConfig(config);
}

/**
 * Dynamically extract built-in commands from Claude Code cli.js source (从 Claude Code cli.js 源码中动态提取内置命令)
 * Match pattern: name:"xxx",description:"xxx" (匹配模式)
 * Filter out non-slash-command entries (npm packages, pyright params, etc.) (过滤掉非 slash command 的条目（npm 包、pyright 参数等）)
 */
function extractBuiltinCommands() {
  const { execSync } = require('child_process');

  // Find claude's cli.js path (找到 claude 的 cli.js 路径)
  let cliPath = null;
  try {
    const npmRoot = execSync('npm root -g', { encoding: 'utf-8', timeout: 5000 }).trim();
    const candidate = path.join(npmRoot, '@anthropic-ai', 'claude-code', 'cli.js');
    if (fs.existsSync(candidate)) cliPath = candidate;
  } catch {
    // npm not available or timed out (npm 不可用或超时)
  }

  // Alternative: infer from which claude (备选：通过 which claude 推断)
  if (!cliPath) {
    try {
      const claudePath = execSync('which claude', { encoding: 'utf-8', timeout: 5000 }).trim();
      // claude is usually npm/claude -> ../node_modules/@anthropic-ai/claude-code/cli.js
      const dir = path.dirname(path.dirname(claudePath));
      const candidate = path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
      if (fs.existsSync(candidate)) cliPath = candidate;
    } catch {
      // which command not available or timed out (which 命令不可用或超时)
    }
  }

  if (!cliPath) {
    console.log('[skill-scanner] Claude Code cli.js not found, skipping built-in command extraction');
    return [];
  }

  try {
    const source = fs.readFileSync(cliPath, 'utf-8');

    // Step 1: Match all built-in command types (local-jsx, local, prompt) (第1步：匹配所有内置命令类型)
    const typeRegex = /type:"(?:local-jsx|local|prompt)",name:"([a-z][a-z0-9-]*)"/g;
    const builtinNames = new Set();
    let m;
    while ((m = typeRegex.exec(source)) !== null) {
      builtinNames.add(m[1]);
    }

    // Step 2: Get descriptions (name+description pattern) (第2步：获取描述（name+description 模式）)
    const descMap = {};
    const descRegex = /name:"([^"]+)",description:"([^"]+)"/g;
    while ((m = descRegex.exec(source)) !== null) {
      if (builtinNames.has(m[1]) && !descMap[m[1]]) {
        descMap[m[1]] = m[2];
      }
    }

    // Merge (合并)
    const commands = [...builtinNames].map(name => ({
      name,
      description: descMap[name] || name.replace(/-/g, ' '),
    }));

    console.log(`[skill-scanner] Extracted ${commands.length} built-in commands from cli.js`);
    return commands;
  } catch (e) {
    console.log(`[skill-scanner] Built-in command extraction failed: ${e.message}`);
    return [];
  }
}

/**
 * Extract built-in skills registered via Qw() in cli.js (从 cli.js 中提取通过 Qw() 注册的内置 skill)
 * These are skills like simplify, batch, loop, schedule etc. that are compiled into Claude Code
 * (这些是编译进 Claude Code 的 skill，如 simplify、batch、loop、schedule 等)
 */
function extractBuiltinSkills() {
  const { execSync } = require('child_process');

  let cliPath = null;
  try {
    const npmRoot = execSync('npm root -g', { encoding: 'utf-8', timeout: 5000 }).trim();
    const candidate = path.join(npmRoot, '@anthropic-ai', 'claude-code', 'cli.js');
    if (fs.existsSync(candidate)) cliPath = candidate;
  } catch {}

  if (!cliPath) {
    try {
      const claudePath = execSync('which claude', { encoding: 'utf-8', timeout: 5000 }).trim();
      const dir = path.dirname(path.dirname(claudePath));
      const candidate = path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
      if (fs.existsSync(candidate)) cliPath = candidate;
    } catch {}
  }

  if (!cliPath) return [];

  try {
    const source = fs.readFileSync(cliPath, 'utf-8');

    // Match Qw({name:"xxx",description:"xxx",...}) registrations (匹配 Qw() 注册的 skill)
    const re = /Qw\(\{name:"([^"]+)",description:"([^"]*)"(?:,userInvocable:(!0|!1|true|false))?/g;
    const skills = [];
    let m;
    while ((m = re.exec(source)) !== null) {
      skills.push({
        name: m[1],
        description: m[2].replace(/\\n/g, ' '),
        userInvocable: m[3] !== '!1' && m[3] !== 'false', // Default true (默认可调用)
      });
    }

    console.log(`[skill-scanner] Extracted ${skills.length} built-in skills (Qw) from cli.js`);
    return skills;
  } catch (e) {
    console.log(`[skill-scanner] Built-in skill extraction failed: ${e.message}`);
    return [];
  }
}

module.exports = { scanAllSkills, loadDisabledList, saveDisabledList };

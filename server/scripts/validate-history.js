/**
 * M0 验证脚本：确认 history.jsonl 数据结构 + skill 扫描可行性
 *
 * 运行方式: node server/scripts/validate-history.js
 *
 * 输出:
 *   1. history.jsonl 数据结构分析
 *   2. skill 调用识别统计
 *   3. 本地 skill/plugin 扫描结果
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

// ============================================================
// 配置
// ============================================================
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const HISTORY_FILE = path.join(CLAUDE_DIR, 'history.jsonl');
const SKILLS_DIR = path.join(CLAUDE_DIR, 'skills');
const PLUGINS_DIR = path.join(CLAUDE_DIR, 'plugins', 'marketplaces');

// 内置命令黑名单（不算 skill 调用）
const BUILTIN_COMMANDS = new Set([
  'help', 'clear', 'compact', 'config', 'cost', 'doctor', 'init',
  'login', 'logout', 'mcp', 'memory', 'model', 'permissions',
  'review', 'status', 'vim', 'fast',
]);

// ============================================================
// 1. 验证 history.jsonl
// ============================================================
async function validateHistory() {
  console.log('='.repeat(60));
  console.log('1. History.jsonl 数据结构验证');
  console.log('='.repeat(60));

  if (!fs.existsSync(HISTORY_FILE)) {
    console.log(`❌ 文件不存在: ${HISTORY_FILE}`);
    return null;
  }

  const stats = fs.statSync(HISTORY_FILE);
  console.log(`📄 文件大小: ${(stats.size / 1024).toFixed(1)} KB`);

  const rl = readline.createInterface({
    input: fs.createReadStream(HISTORY_FILE, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  let totalLines = 0;
  let parseErrors = 0;
  let slashCommands = 0;
  let nonSlashLines = 0;
  let emptyDisplay = 0;

  const fieldStats = {};        // 统计每条记录有哪些字段
  const skillCounts = {};       // skill 名 → 调用次数
  const builtinCounts = {};     // 内置命令调用次数
  const sampleRecords = [];     // 前 5 条样本
  const sampleSlash = [];       // 前 5 条 / 开头的样本
  const sampleNonSlash = [];    // 前 5 条非 / 的样本
  const projects = new Set();

  for await (const line of rl) {
    if (!line.trim()) continue;
    totalLines++;

    let record;
    try {
      record = JSON.parse(line);
    } catch {
      parseErrors++;
      continue;
    }

    // 统计字段出现频率
    for (const key of Object.keys(record)) {
      fieldStats[key] = (fieldStats[key] || 0) + 1;
    }

    if (totalLines <= 5) {
      sampleRecords.push(record);
    }

    const display = record.display;
    if (!display) {
      emptyDisplay++;
      continue;
    }

    if (record.project) {
      projects.add(record.project);
    }

    if (typeof display === 'string' && display.startsWith('/')) {
      slashCommands++;
      const parts = display.slice(1).split(/\s+/);
      const cmdName = parts[0].toLowerCase();

      if (BUILTIN_COMMANDS.has(cmdName)) {
        builtinCounts[cmdName] = (builtinCounts[cmdName] || 0) + 1;
      } else {
        skillCounts[cmdName] = (skillCounts[cmdName] || 0) + 1;
      }

      if (sampleSlash.length < 5) {
        sampleSlash.push({ display, timestamp: record.timestamp, project: record.project });
      }
    } else {
      nonSlashLines++;
      if (sampleNonSlash.length < 5) {
        sampleNonSlash.push({
          display: typeof display === 'string' ? display.slice(0, 80) + (display.length > 80 ? '...' : '') : String(display).slice(0, 80),
          timestamp: record.timestamp,
        });
      }
    }
  }

  // 输出结果
  console.log(`\n📊 总记录数: ${totalLines}`);
  console.log(`   解析失败: ${parseErrors}`);
  console.log(`   display 为空: ${emptyDisplay}`);
  console.log(`   / 开头的记录: ${slashCommands} (${(slashCommands / totalLines * 100).toFixed(1)}%)`);
  console.log(`   非 / 开头的记录: ${nonSlashLines} (${(nonSlashLines / totalLines * 100).toFixed(1)}%)`);
  console.log(`   涉及的项目数: ${projects.size}`);

  console.log('\n📋 字段出现频率:');
  for (const [key, count] of Object.entries(fieldStats).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${key}: ${count} (${(count / totalLines * 100).toFixed(1)}%)`);
  }

  const skillEntries = Object.entries(skillCounts).sort((a, b) => b[1] - a[1]);
  console.log(`\n🎯 识别到的 Skill 调用 (${skillEntries.length} 种):`);
  for (const [name, count] of skillEntries.slice(0, 20)) {
    console.log(`   /${name}: ${count} 次`);
  }

  const builtinEntries = Object.entries(builtinCounts).sort((a, b) => b[1] - a[1]);
  if (builtinEntries.length > 0) {
    console.log(`\n🔧 内置命令调用 (已过滤，不计入 skill):`);
    for (const [name, count] of builtinEntries) {
      console.log(`   /${name}: ${count} 次`);
    }
  }

  console.log('\n📝 样本记录 (前 5 条):');
  for (const r of sampleRecords) {
    console.log(`   ${JSON.stringify(r).slice(0, 120)}...`);
  }

  if (sampleSlash.length > 0) {
    console.log('\n📝 / 开头样本 (前 5 条):');
    for (const r of sampleSlash) {
      console.log(`   ${r.display}  [project: ${r.project || 'N/A'}]`);
    }
  }

  if (sampleNonSlash.length > 0) {
    console.log('\n📝 非 / 开头样本 (前 5 条):');
    for (const r of sampleNonSlash) {
      console.log(`   "${r.display}"`);
    }
  }

  return {
    totalLines,
    slashCommands,
    nonSlashLines,
    skillCount: skillEntries.length,
    totalSkillCalls: skillEntries.reduce((sum, [, c]) => sum + c, 0),
    topSkills: skillEntries.slice(0, 10),
  };
}

// ============================================================
// 2. 验证本地 skill/plugin 扫描
// ============================================================
function validateSkillScan() {
  console.log('\n' + '='.repeat(60));
  console.log('2. 本地 Skill/Plugin 扫描验证');
  console.log('='.repeat(60));

  const results = { custom: [], official: [], trailofbits: [], external: [] };

  // 2a. 用户自建 skill
  if (fs.existsSync(SKILLS_DIR)) {
    const dirs = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory());
    for (const dir of dirs) {
      const skillMd = path.join(SKILLS_DIR, dir.name, 'skill.md');
      const skillMdAlt = path.join(SKILLS_DIR, dir.name, 'SKILL.md');
      const filePath = fs.existsSync(skillMd) ? skillMd : fs.existsSync(skillMdAlt) ? skillMdAlt : null;

      const info = { name: dir.name, hasSkillMd: !!filePath, frontmatter: null };
      if (filePath) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const fm = extractFrontmatter(content);
          info.frontmatter = fm;
        } catch (e) {
          info.error = e.message;
        }
      }
      results.custom.push(info);
    }
  } else {
    console.log(`⚠️ 用户 skills 目录不存在: ${SKILLS_DIR}`);
  }

  // 2b. Marketplace 插件
  if (fs.existsSync(PLUGINS_DIR)) {
    const marketplaces = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory());

    for (const mp of marketplaces) {
      const mpPath = path.join(PLUGINS_DIR, mp.name);
      const category = mp.name.includes('official') ? 'official'
        : mp.name.includes('trailofbits') ? 'trailofbits'
        : 'external';

      // 扫描 plugins/ 子目录
      const pluginsPath = path.join(mpPath, 'plugins');
      if (fs.existsSync(pluginsPath)) {
        const plugins = fs.readdirSync(pluginsPath, { withFileTypes: true })
          .filter(d => d.isDirectory());
        for (const plugin of plugins) {
          const pluginDir = path.join(pluginsPath, plugin.name);
          const pluginJson = path.join(pluginDir, 'plugin.json');
          const hasPluginJson = fs.existsSync(pluginJson);

          // 查找 skills 子目录
          const skillsSubDir = path.join(pluginDir, 'skills');
          const skillFiles = [];
          if (fs.existsSync(skillsSubDir)) {
            const subs = fs.readdirSync(skillsSubDir, { withFileTypes: true })
              .filter(d => d.isDirectory());
            for (const sub of subs) {
              const sm = path.join(skillsSubDir, sub.name, 'SKILL.md');
              const smAlt = path.join(skillsSubDir, sub.name, 'skill.md');
              if (fs.existsSync(sm) || fs.existsSync(smAlt)) {
                skillFiles.push(sub.name);
              }
            }
          }

          results[category].push({
            marketplace: mp.name,
            plugin: plugin.name,
            hasPluginJson,
            skillCount: skillFiles.length,
            skills: skillFiles.slice(0, 5),
          });
        }
      }

      // 扫描 external_plugins/ 子目录
      const extPath = path.join(mpPath, 'external_plugins');
      if (fs.existsSync(extPath)) {
        const exts = fs.readdirSync(extPath, { withFileTypes: true })
          .filter(d => d.isDirectory());
        for (const ext of exts) {
          results.external.push({
            marketplace: mp.name,
            plugin: ext.name,
            type: 'external',
          });
        }
      }
    }
  } else {
    console.log(`⚠️ Plugins 目录不存在: ${PLUGINS_DIR}`);
  }

  // 输出结果
  console.log(`\n📦 用户自建 Skill: ${results.custom.length}`);
  for (const s of results.custom) {
    const fm = s.frontmatter;
    const name = fm?.name || s.name;
    const desc = fm?.description ? fm.description.slice(0, 50) + '...' : 'N/A';
    console.log(`   ${s.hasSkillMd ? '✅' : '❌'} ${name} — ${desc}`);
  }

  console.log(`\n📦 官方插件: ${results.official.length}`);
  for (const p of results.official.slice(0, 10)) {
    console.log(`   📂 ${p.plugin} (skills: ${p.skillCount}, plugin.json: ${p.hasPluginJson ? '✅' : '❌'})`);
  }
  if (results.official.length > 10) {
    console.log(`   ... 还有 ${results.official.length - 10} 个`);
  }

  console.log(`\n📦 Trail of Bits 插件: ${results.trailofbits.length}`);
  for (const p of results.trailofbits.slice(0, 10)) {
    console.log(`   📂 ${p.plugin} (skills: ${p.skillCount})`);
  }
  if (results.trailofbits.length > 10) {
    console.log(`   ... 还有 ${results.trailofbits.length - 10} 个`);
  }

  console.log(`\n📦 外部集成: ${results.external.length}`);
  for (const p of results.external.slice(0, 10)) {
    console.log(`   🔗 ${p.plugin}`);
  }
  if (results.external.length > 10) {
    console.log(`   ... 还有 ${results.external.length - 10} 个`);
  }

  const total = results.custom.length + results.official.length + results.trailofbits.length + results.external.length;
  console.log(`\n📊 总计: ${total} 个 skill/plugin`);

  return results;
}

// ============================================================
// 辅助函数：提取 YAML frontmatter
// ============================================================
function extractFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const fm = {};
  const lines = match[1].split('\n');
  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      let value = line.slice(colonIdx + 1).trim();
      // 去除引号
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      fm[key] = value;
    }
  }
  return fm;
}

// ============================================================
// 3. 汇总报告
// ============================================================
async function main() {
  console.log('🔍 Skill Manager — M0 数据验证\n');
  console.log(`📁 Claude 目录: ${CLAUDE_DIR}`);
  console.log(`📅 验证时间: ${new Date().toISOString()}\n`);

  const historyResult = await validateHistory();
  const scanResult = validateSkillScan();

  console.log('\n' + '='.repeat(60));
  console.log('3. 验证结论');
  console.log('='.repeat(60));

  if (historyResult) {
    console.log(`\n✅ history.jsonl 可解析`);
    console.log(`   - 总记录: ${historyResult.totalLines}`);
    console.log(`   - 可识别的 skill 调用: ${historyResult.totalSkillCalls} 次 (${historyResult.skillCount} 种)`);
    console.log(`   - 非 skill 记录: ${historyResult.nonSlashLines} (${(historyResult.nonSlashLines / historyResult.totalLines * 100).toFixed(1)}%)`);

    if (historyResult.nonSlashLines / historyResult.totalLines > 0.5) {
      console.log(`   ⚠️ 非 / 开头的记录占比超过 50%，这些可能是用户普通对话或模型自动触发的记录`);
      console.log(`      需要决定：是否仅统计 / 开头的记录（当前方案），还是尝试识别更多调用模式`);
    }
  } else {
    console.log(`\n❌ history.jsonl 不可用，统计功能将无数据`);
  }

  const total = scanResult.custom.length + scanResult.official.length + scanResult.trailofbits.length + scanResult.external.length;
  console.log(`\n✅ 本地扫描可用`);
  console.log(`   - 用户自建: ${scanResult.custom.length}`);
  console.log(`   - 官方插件: ${scanResult.official.length}`);
  console.log(`   - Trail of Bits: ${scanResult.trailofbits.length}`);
  console.log(`   - 外部集成: ${scanResult.external.length}`);
  console.log(`   - 总计: ${total}`);

  console.log('\n🚀 结论: 可以进入 M1 开发阶段');
}

main().catch(console.error);

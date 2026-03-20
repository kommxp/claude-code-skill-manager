const path = require('path');
const os = require('os');

const CLAUDE_DIR = path.join(os.homedir(), '.claude');

module.exports = {
  CLAUDE_DIR,
  HISTORY_FILE: path.join(CLAUDE_DIR, 'history.jsonl'),
  SKILLS_DIR: path.join(CLAUDE_DIR, 'skills'),
  PLUGINS_DIR: path.join(CLAUDE_DIR, 'plugins', 'marketplaces'),
  STATS_CACHE: path.join(CLAUDE_DIR, 'skill-manager-stats.json'),
  CONFIG_FILE: path.join(CLAUDE_DIR, 'skill-manager-config.json'),
  ONLINE_CACHE: path.join(CLAUDE_DIR, 'skill-manager-online.json'),
  DESC_CACHE: path.join(CLAUDE_DIR, 'skill-manager-desc.json'),
  TAGS_CACHE: path.join(CLAUDE_DIR, 'skill-manager-tags.json'),
  OVERRIDES_FILE: path.join(__dirname, '..', 'data', 'overrides.json'),

  /** Convert absolute path to POSIX style for storage (将绝对路径转为 POSIX 风格存储) */
  toPosix(p) {
    return p.replace(/\\/g, '/');
  },

  /** Sanitize path: hide username portion (脱敏路径：隐藏用户名部分) */
  sanitizePath(p) {
    const home = os.homedir();
    if (p.startsWith(home)) {
      return '~' + p.slice(home.length).replace(/\\/g, '/');
    }
    return path.basename(p);
  },
};

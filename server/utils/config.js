const fs = require('fs');
const { CONFIG_FILE } = require('./paths');

/**
 * Load config from disk (从磁盘加载配置)
 * @returns {object} Config object or empty object if not found/invalid (配置对象，未找到或无效时返回空对象)
 */
function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

/**
 * Save config to disk (保存配置到磁盘)
 * @param {object} cfg - Config object to save (要保存的配置对象)
 */
function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
}

module.exports = { loadConfig, saveConfig };

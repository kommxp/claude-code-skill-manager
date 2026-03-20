/**
 * Parse YAML frontmatter (fault-tolerant: log on failure, don't crash) (解析 YAML frontmatter（容错：解析失败记日志不崩溃）)
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { attributes: {}, body: content };

  const fm = {};
  const lines = match[1].split(/\r?\n/);
  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      let value = line.slice(colonIdx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      // Handle boolean values (处理布尔值)
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      fm[key] = value;
    }
  }

  const body = content.slice(match[0].length).trim();
  return { attributes: fm, body };
}

module.exports = { parseFrontmatter };

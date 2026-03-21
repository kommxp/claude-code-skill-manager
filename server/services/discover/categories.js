/**
 * categories.js — Category inference and migration (分类推断和迁移)
 */

// Old category -> new category mapping (旧分类 → 新分类映射)
const OLD_TO_NEW_CATEGORY = {
  'code-review': 'development',
  'language-support': 'development',
  'git-workflow': 'devops',
  'output-style': 'documentation',
  'setup': 'devops',
  'integration': 'automation',
  'frontend': 'design-creative',
};

function migrateCategory(cat) {
  return OLD_TO_NEW_CATEGORY[cat] || cat;
}

function inferCategory(name, desc) {
  const text = `${name} ${desc}`.toLowerCase();
  if (/security|audit|vuln|exploit|cve|sast|seatbelt|zeroize|insecure|supply.chain|pentest|forensic/.test(text)) return 'security';
  if (/test|spec|coverage|property.based|variant|e2e|unittest/.test(text)) return 'testing';
  if (/devops|ci\/cd|deploy|docker|kubernetes|container|infra|terraform|ansible|helm/.test(text)) return 'devops';
  if (/ai|ml|machine.learning|llm|agent|embedding|nlp|model|prompt/.test(text)) return 'ai-ml';
  if (/data|analytics|csv|sql|database|etl|visualization|pandas|excel|spreadsheet/.test(text)) return 'data-analytics';
  if (/market|seo|ads|campaign|growth|content.market|copywrit/.test(text)) return 'marketing-seo';
  if (/product|prd|roadmap|okr|user.research|requirement/.test(text)) return 'product-management';
  if (/design|ui|ux|figma|css|frontend|chrome|canvas|art|creative|image|video|3d/.test(text)) return 'design-creative';
  if (/doc|readme|markdown|pdf|pptx|xlsx|technical.writ|translate/.test(text)) return 'documentation';
  if (/business|finance|contract|invoice|budget|compliance|legal/.test(text)) return 'business-finance';
  if (/automat|workflow|mcp|integration|slack|github|linear|firebase|stripe|asana|gitlab|supabase|playwright|n8n|webhook/.test(text)) return 'automation';
  if (/chat|email|slack|discord|telegram|notification|commu/.test(text)) return 'communication';
  if (/learn|teach|tutor|course|education|research|paper/.test(text)) return 'education-research';
  if (/tarot|game|fun|lifestyle|entertainment|占卜|divination/.test(text)) return 'lifestyle-fun';
  if (/lsp|language.server|commit|git|pr|merge|branch|cleanup|review|lint|quality|code|dev|setup|config|hook|plugin|skill|sdk/.test(text)) return 'development';
  return 'other';
}

function inferCategoryFromTopics(topics, name, desc) {
  const all = [...topics, name, desc].join(' ').toLowerCase();
  return inferCategory(all, '');
}

module.exports = { migrateCategory, inferCategory, inferCategoryFromTopics };

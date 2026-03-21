/**
 * claude-cli.js — Shared Claude CLI invocation utility (共享 Claude CLI 调用工具)
 *
 * Centralizes subprocess spawning with proper env cleanup (统一子进程启动和环境变量清理)
 */

const fs = require('fs');
const { spawn } = require('child_process');

/**
 * Call Claude CLI with a prompt (调用 Claude CLI)
 * @param {string} prompt - The prompt to send (要发送的 prompt)
 * @param {object} [options] - Options (选项)
 * @param {string} [options.model='haiku'] - Model to use (使用的模型)
 * @returns {Promise<string>} CLI stdout output (CLI 标准输出)
 */
function callClaude(prompt, options = {}) {
  const { model = 'haiku' } = options;

  return new Promise((resolve, reject) => {
    const env = Object.assign({}, process.env);

    // Auto-detect Git Bash path on Windows (Windows 下自动检测 Git Bash 路径)
    const gitBashCandidates = [
      process.env.CLAUDE_CODE_GIT_BASH_PATH,
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'D:\\Git\\bin\\bash.exe',
      'C:\\Git\\bin\\bash.exe',
    ];
    const gitBash = gitBashCandidates.find(p => p && fs.existsSync(p));
    if (gitBash) env.CLAUDE_CODE_GIT_BASH_PATH = gitBash;

    // Clean env to avoid nested session errors and proxy issues (清理环境变量，避免嵌套会话报错和代理问题)
    delete env.CLAUDECODE;
    delete env.ANTHROPIC_BASE_URL;
    delete env.ANTHROPIC_API_KEY;

    const child = spawn('claude', ['-p', '--max-turns', '1', '--no-session-persistence', '--model', model], {
      env, shell: true, stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', err => reject(err));
    child.on('close', code => {
      if (stdout.trim()) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error(`Claude CLI exit ${code}: ${stderr}`));
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/**
 * Parse Claude CLI JSON response, handling markdown fences (解析 Claude CLI JSON 响应，处理 markdown 围栏)
 * @param {string} text - Raw CLI output (原始 CLI 输出)
 * @returns {object} Parsed JSON object (解析后的 JSON 对象)
 */
function parseClaudeJson(text) {
  const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  return JSON.parse(clean);
}

module.exports = { callClaude, parseClaudeJson };

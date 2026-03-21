/**
 * github-api.js — GitHub API and HTTP helpers (GitHub API 和 HTTP 工具函数)
 */

const https = require('https');

// API rate limit tracking (API 限额追踪)
let rateRemaining = 60;
let rateResetAt = 0;

const SEARCH_DELAY = 3000; // Search request interval (ms) to avoid rate limiting (搜索请求间隔)

/**
 * Check if there is enough quota remaining (检查是否还有足够限额)
 */
function hasQuota(reserve = 2) {
  if (Date.now() > rateResetAt) {
    rateRemaining = 60;
  }
  return rateRemaining > reserve;
}

function getRateRemaining() { return rateRemaining; }

function githubGet(url, token) {
  return new Promise((resolve, reject) => {
    if (!hasQuota()) {
      const waitMin = Math.ceil((rateResetAt - Date.now()) / 60000);
      reject(new Error(`Quota exhausted, will recover ${waitMin > 0 ? 'in ' + waitMin + ' min' : 'shortly'}`));
      return;
    }

    const headers = {
      'User-Agent': 'skill-manager',
      Accept: 'application/vnd.github.v3+json',
    };
    if (token) headers.Authorization = `token ${token}`;

    const parsedUrl = new URL(url);
    const req = https.get({
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      headers,
      timeout: 15000,
    }, res => {
      const remain = res.headers['x-ratelimit-remaining'];
      const reset = res.headers['x-ratelimit-reset'];
      if (remain != null) rateRemaining = parseInt(remain, 10);
      if (reset != null) rateResetAt = parseInt(reset, 10) * 1000;

      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 403 || res.statusCode === 429) {
          rateRemaining = 0;
          reject(new Error(`GitHub API rate limited (${res.statusCode}), remaining: ${rateRemaining}`));
          return;
        }
        if (res.statusCode === 404) { resolve(null); return; }
        if (res.statusCode >= 400) {
          reject(new Error(`GitHub API error: ${res.statusCode}`));
          return;
        }
        try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

/**
 * Generic HTTP GET (not using GitHub API quota, for npm, raw files, etc.) (通用 HTTP GET)
 */
function httpGet(urlStr) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === 'https:' ? https : require('http');
    const req = mod.get({
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: { 'User-Agent': 'skill-manager' },
      timeout: 15000,
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpGet(res.headers.location).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode >= 400) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { hasQuota, getRateRemaining, githubGet, httpGet, sleep, SEARCH_DELAY };

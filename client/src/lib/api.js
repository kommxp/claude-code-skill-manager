const BASE = '/api';

async function fetchJSON(url) {
  const res = await fetch(BASE + url);
  if (!res.ok) {
    // Try to parse server error message for better UX (尝试解析服务端错误信息以改善用户体验)
    try {
      const body = await res.json();
      throw new Error(body.error || `API error: ${res.status}`);
    } catch (e) {
      if (e.message && e.message !== `API error: ${res.status}`) throw e;
      throw new Error(`API error: ${res.status}`);
    }
  }
  return res.json();
}

export const api = {
  health: () => fetchJSON('/health'),
  overview: () => fetchJSON('/stats/overview'),
  trend: (range = '30d', skill) => fetchJSON(`/stats/trend?range=${range}${skill ? '&skill=' + skill : ''}`),
  heatmap: () => fetchJSON('/stats/heatmap'),
  skills: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return fetchJSON('/skills' + (qs ? '?' + qs : ''));
  },
  skill: (id, lang) => fetchJSON(`/skills/${encodeURIComponent(id)}${lang ? '?lang=' + lang : ''}`),
  skillRaw: (id) => fetch(`${BASE}/skills/${encodeURIComponent(id)}/raw`).then(r => r.text()),
  refresh: () => fetch(`${BASE}/refresh`, { method: 'POST' }).then(r => r.json()),
  toggleSkill: (id) => fetch(`${BASE}/skills/${encodeURIComponent(id)}/toggle`, { method: 'POST' }).then(r => r.json()),
  deleteSkill: (id) => fetch(`${BASE}/skills/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(r => r.json()),
  translationStats: () => fetchJSON('/stats/translations'),
  discover: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return fetchJSON('/discover' + (qs ? '?' + qs : ''));
  },
  discoverCategories: () => fetchJSON('/discover/categories'),
  discoverEnums: () => fetchJSON('/discover/enums'),
  discoverDetail: (name) => fetchJSON(`/discover/detail?name=${encodeURIComponent(name)}`),
  discoverAiSearch: (query, lang) => fetch(`${BASE}/discover/ai-search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, lang }),
  }).then(r => r.ok ? r.json() : r.json().then(b => { throw new Error(b.error) })),
  discoverRefresh: () => fetch(`${BASE}/discover/refresh`, { method: 'POST' }).then(r => r.json()),
  getConfig: () => fetchJSON('/config'),
  saveConfig: (data) => fetch(`${BASE}/config`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json()),
};

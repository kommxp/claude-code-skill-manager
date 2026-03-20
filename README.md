# Claude Code Skill Manager

A local dashboard for managing, discovering, and analyzing [Claude Code](https://claude.ai/code) skills and plugins.

## Features

- **Dashboard** — Usage statistics, call trends, heatmap, and insights for your installed skills
- **My Skills** — Browse all 67+ built-in commands and your custom skills with search, filter, and detail view
- **Discover** — Auto-discover 1800+ skills from GitHub with multi-dimensional filtering (category, action, complexity), AI-generated descriptions, and one-click install
- **Settings** — Configure GitHub token for higher API limits
- **Bilingual** — Full Chinese/English UI switching

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [Claude Code](https://claude.ai/code) installed

### Install & Run

```bash
# Clone
git clone https://github.com/YOUR_USERNAME/claude-code-skill-manager.git
cd claude-code-skill-manager

# Install dependencies & start
npm install
npm start
```

Or on Windows, just double-click `start.bat`.

The browser will open automatically. If port 3200 is busy, it auto-finds the next available port.

### Optional: GitHub Token (Recommended)

Without a token, GitHub API is limited to 60 requests/hour. With a token, you get 5000/hour and discover far more skills.

1. Go to [GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)](https://github.com/settings/tokens)
2. Generate new token — **no permissions needed** (leave all unchecked)
3. Paste it in the **Settings** tab of the dashboard

## How It Works

### Auto-Discovery Engine

The discover engine runs in the background with zero configuration:

- **8 data sources**: GitHub keyword search, topic search, Awesome lists, npm packages, aggregated repos, file signatures, network expansion, fork discovery
- **Smart rate limiting**: Tracks API quota, skips low-priority sources when limited
- **Incremental merge**: New discoveries merge with cache, never loses data
- **SKILL.md detection**: Uses GitHub Trees API to recursively find skills at any directory depth

### AI Enrichment

- **Descriptions**: Auto-fetches README and translates to Chinese/English via Claude CLI
- **Tags**: AI-powered multi-dimensional tagging (category, action, target, complexity) using Claude Haiku
- **Background processing**: Gradually enriches skills by score priority, 10 per cycle

### Service Stability

- Auto-finds available port if 3200 is busy
- Auto-opens browser on start
- Auto-shuts down after 30 minutes idle
- Auto-restarts on crash (up to 5 times via start.bat)

## Tech Stack

- **Frontend**: React + Vite + Tailwind CSS (dark theme)
- **Backend**: Express.js (single process, serves both API and static files)
- **Data**: File-based caching in `~/.claude/`, no database needed
- **AI**: Claude CLI for translations and tagging (optional, works without it)

## Project Structure

```
├── server/
│   ├── index.js              # Express entry point
│   ├── routes/               # API routes (stats, skills, discover)
│   ├── services/
│   │   ├── discover.js       # Auto-discovery engine (8 data sources)
│   │   ├── enricher.js       # Description enrichment (3-layer)
│   │   ├── tagger.js         # AI tagging engine
│   │   ├── skill-scanner.js  # Local skill scanner
│   │   ├── history-parser.js # Usage history parser
│   │   └── stats-aggregator.js
│   └── utils/
├── client/src/
│   ├── tabs/                 # Dashboard, Skills, Discover, Settings
│   ├── lib/                  # API client, i18n
│   └── App.jsx
├── dist/                     # Pre-built frontend (ready to use)
├── start.bat                 # Windows launcher (auto-restart)
├── start.sh                  # Unix launcher
└── package.json
```

## License

MIT

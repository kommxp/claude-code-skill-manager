# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2026-03-21

### Added
- Dashboard with usage statistics, call trends, heatmap, and insights
- My Skills tab to browse built-in commands and custom skills
- Discover tab with auto-discovery from 8 GitHub data sources
- AI-powered description enrichment and auto-tagging via Claude CLI
- Full Chinese/English bilingual UI
- Settings tab for GitHub token configuration
- Three-platform startup scripts (start.bat, start.sh, start.ps1)
- Auto-port detection, auto-browser opening, idle auto-close
- Incremental history parsing with file-based caching

### Fixed
- Aggregated sub-skills inheriting parent repo stars
- OOM crash with `--max-old-space-size=512` memory limit
- Collection repos incorrectly added as single skills
- Security: replaced `exec()` with `execFile()`, added try-catch for `execSync`
- All comments and logs converted to bilingual (English + Chinese)

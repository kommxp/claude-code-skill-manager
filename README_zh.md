[English](README.md) | [中文](#)

# Claude Code Skill Manager

一个本地仪表盘，用于管理、发现和分析 [Claude Code](https://claude.ai/code) 的技能（Skills）和插件。

## 功能特性

- **仪表盘** — 已安装技能的使用统计、调用趋势、热力图和数据洞察
- **我的技能** — 浏览所有内置命令和自定义技能，支持搜索、筛选和详情查看
- **发现市场** — 从 GitHub 自动发现技能，支持多维筛选（分类、动作、复杂度），AI 生成描述，一键安装
- **设置** — 配置 GitHub Token 以获得更高的 API 请求额度
- **双语支持** — 中文/英文界面自由切换

## 截图

<!-- 在此添加仪表盘截图 -->
<!-- ![仪表盘截图](docs/screenshot.png) -->

> 截图即将更新。运行 `npm start` 即可查看仪表盘效果。

## 快速开始

### 前置条件

- [Node.js](https://nodejs.org/) v18+
- 已安装 [Claude Code](https://claude.ai/code)

### 安装与运行

```bash
# 克隆仓库
git clone https://github.com/kommxp/claude-code-skill-manager.git
cd claude-code-skill-manager

# 安装依赖并启动
npm install
npm start
```

Windows 用户也可以直接双击 `start.bat` 启动。

浏览器会自动打开。如果 3200 端口被占用，会自动寻找下一个可用端口。

### 可选：配置 GitHub Token（推荐）

不配置 Token 时，GitHub API 限制为 60 次请求/小时。配置后可达 5000 次/小时，能发现更多技能。

1. 前往 [GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)](https://github.com/settings/tokens)
2. 生成新 Token — **无需勾选任何权限**（全部留空即可）
3. 在仪表盘的 **设置** 页面粘贴 Token

## 工作原理

### 自动发现引擎

发现引擎在后台自动运行，无需任何配置：

- **8 大数据源**：GitHub 关键词搜索、Topic 搜索、Awesome 列表、npm 包、聚合仓库、文件特征、网络扩展、Fork 发现
- **智能限流**：追踪 API 配额，配额不足时自动跳过低优先级数据源
- **增量合并**：新发现的技能与缓存合并，永不丢失数据
- **SKILL.md 检测**：使用 GitHub Trees API 递归查找任意目录深度的技能文件

### AI 增强

- **描述生成**：自动获取 README 并通过 Claude CLI 翻译为中英文
- **智能标签**：使用 Claude Haiku 进行多维度自动打标（分类、动作、目标、复杂度）
- **后台处理**：按评分优先级逐步增强技能描述，每轮处理 10 个

### 服务稳定性

- 3200 端口被占用时自动查找可用端口
- 启动后自动打开浏览器
- 30 分钟无活动自动关闭
- 崩溃后自动重启（通过 start.bat，最多 5 次）

## 技术栈

- **前端**：React + Vite + Tailwind CSS（暗色主题）
- **后端**：Express.js（单进程，同时提供 API 和静态文件服务）
- **数据**：基于文件的缓存，存储在 `~/.claude/`，无需数据库
- **AI**：Claude CLI 用于翻译和标签（可选，不配置也能正常工作）

## 项目结构

```
├── server/
│   ├── index.js              # Express 入口
│   ├── routes/               # API 路由（stats、skills、discover）
│   ├── services/
│   │   ├── discover.js       # 自动发现引擎（8 大数据源）
│   │   ├── enricher.js       # 描述增强（3 层渐进式）
│   │   ├── tagger.js         # AI 标签引擎
│   │   ├── skill-scanner.js  # 本地技能扫描
│   │   ├── history-parser.js # 使用历史解析
│   │   └── stats-aggregator.js
│   └── utils/
├── client/src/
│   ├── tabs/                 # Dashboard、Skills、Discover、Settings
│   ├── lib/                  # API 客户端、i18n 国际化
│   └── App.jsx
├── dist/                     # 预构建前端（开箱即用）
├── start.bat                 # Windows 启动器（自动重启）
├── start.sh                  # Unix 启动器
└── package.json
```

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/stats/overview` | 仪表盘总览（技能总数、调用数、Top 5、洞察） |
| GET | `/api/stats/trend?range=30d` | 调用趋势数据（7d/30d/90d） |
| GET | `/api/skills?lang=zh` | 所有本地技能列表（含统计） |
| POST | `/api/skills/:id/toggle` | 启用/禁用自定义技能 |
| DELETE | `/api/skills/:id` | 删除自定义技能 |
| GET | `/api/discover?category=&sort=hot&page=1` | 浏览在线技能目录 |
| GET | `/api/discover/detail/:name` | 获取技能详情（增强描述、使用场景） |
| GET | `/api/discover/categories` | 获取分类列表及数量 |
| POST | `/api/discover/refresh` | 触发在线技能重新索引 |
| POST | `/api/refresh` | 刷新所有本地数据（历史 + 技能） |
| GET | `/api/health` | 健康检查 |
| GET/POST | `/api/config` | 读写设置（GitHub Token） |

## 贡献

欢迎贡献代码！步骤：

1. Fork 本仓库
2. 创建功能分支（`git checkout -b feature/my-feature`）
3. 提交更改并编写清晰的 commit 信息
4. 推送分支并创建 Pull Request

## 许可证

MIT

# LoveStory 💕

一个私密的情侣互动网站，支持加密日记、时间线、照片墙、AI 聊天等功能。

## 功能

| 功能            | 说明                                                |
| --------------- | --------------------------------------------------- |
| 📖 **加密日记** | 双方各自独立的日记，AES-256-GCM 加密，支持图文+录音 |
| 📅 **时间线**   | 纪念日管理，自动倒计时，首页10天内提醒              |
| 📷 **照片墙**   | 上传照片到服务端，预览和删除                        |
| 🤖 **AI 聊天**  | 公开聊天 + 两个独立私密空间，可自定义 AI 人设       |
| ⚙️ **设置**     | 自定义昵称、头像、相恋日、AI 指令                   |

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置 API

复制 `.env.example` 为 `.env`，填入你的 DeepSeek API 信息：

```bash
cp .env.example .env
```

编辑 `.env`：

```
API_KEY=sk-your-api-key
API_ENDPOINT=https://api.deepseek.com/chat/completions
API_MODEL=deepseek-chat
PORT=3000
```

> 默认使用 DeepSeek API，兼容 OpenAI 格式的接口都可以用。

### 3. 启动服务

```bash
node server.js
```

或双击 `start.bat`（Windows 静默启动）。

访问 `http://localhost:3000` 即可。

### 局域网/公网访问

- **局域网**：在同一网络下访问提示中的局域网 IP
- **公网**：使用 `get-ngrok-url.js` 或自行配置 ngrok

## 使用说明

### 首次使用

1. 打开页面后进入 **日记** 区域
2. 双方各自设置日记密码（一经设置不可修改）
3. 密码同时也是 AI 私密空间的验证密码

### 设置

点击导航栏 **⚙️** 打开设置：

- **昵称**：自定义双方显示名称
- **头像**：上传图片作为头像
- **相恋日**：修改"在一起多少天"的计算起点
- **AI 指令**：自定义 AI 的角色和行为规则，留空则使用默认

### 日记

- 内容自动 AES-256-GCM 加密存储
- 支持文本 + 图片 + 录音/上传音频
- 支持编辑、删除、日期筛选
- 音频可拖动进度条、重命名

### AI 聊天

- **公开空间**：所有人都能聊
- **私密空间**：需要日记密码验证，各自独立对话历史

自定义 AI 指令示例：

```
你是这对情侣的知心姐姐，温柔体贴，说话带暖暖的emoji。
多给他们分享增进感情的小技巧。
回复简短亲切，每句都用"亲爱的"开头。
```

## 技术栈

| 层   | 技术                             |
| ---- | -------------------------------- |
| 后端 | Node.js + Express                |
| 前端 | 原生 HTML + CSS + JavaScript     |
| 加密 | AES-256-GCM + PBKDF2 + bcrypt    |
| 存储 | JSON 文件（`data/` 目录）        |
| AI   | DeepSeek API（兼容 OpenAI 格式） |

## 目录结构

```
LoveNest/
├── server.js              # 后端服务
├── index.html             # 前端页面
├── index.js               # 前端逻辑
├── index.css              # 前端样式
├── package.json
├── .env                   # API 配置（不提交）
├── .env.example           # 配置示例
├── start.bat              # Windows 一键启动
├── love.bat               # Windows 快捷启动
├── get-ngrok-url.js       # 获取公网地址
├── data/                  # 数据存储（不提交）
│   ├── passwords.json     # 密码哈希和加密密钥
│   ├── diary-his.json     # 他的日记（AES加密）
│   ├── diary-her.json     # 她的日记（AES加密）
│   ├── timeline.json      # 时间线
│   ├── photos.json        # 照片元数据
│   ├── chat-conversations.json  # AI聊天历史
│   ├── sessions.json      # 登录会话
│   └── settings.json      # 全局设置
└── uploads/               # 照片文件（不提交）
    └── avatars/           # 自定义头像
```

## 注意事项

1. **不要删除 `data/` 目录** — 密码和数据都在里面，删除后无法恢复
2. **密码不可修改** — 日记加密密钥由密码派生，没有万能密码
3. **数据只存在服务端** — 手机通过局域网/ngrok 访问需保持服务端运行
4. **修改 AI 指令** — 可在设置页面直接修改，无需编辑代码

## License

MIT

# 情侣网站 (Love Project)

一个私密的情侣互动网站，支持加密日记、时间线、照片墙、AI 聊天等功能。

## 技术栈

- **后端**: Node.js + Express
- **前端**: 原生 HTML + CSS + JavaScript (无框架)
- **加密**: AES-256-GCM (日记内容) + bcrypt (密码哈希)
- **存储**: JSON 文件 (`data/` 目录)
- **依赖**: express, dotenv, bcryptjs (密码), multer (已装但未用)

## 目录结构

```
love/
├── server.js          # 后端服务 (API + 静态文件)
├── index.html         # 前端页面 (单页应用)
├── index.js           # 前端逻辑
├── index.css          # 前端样式
├── start.bat          # Windows 一键启动 (静默模式)
├── love.bat           # Windows 快速启动器
├── get-ngrok-url.js   # 获取 ngrok 公网地址
├── .env               # API 配置 (不提交)
├── package.json
├── .gitignore
├── data/              # 数据存储 (不提交)
│   ├── passwords.json       # 密码哈希和加密密钥
│   ├── diary-his.json       # 他的日记 (AES加密)
│   ├── diary-her.json       # 她的日记 (AES加密)
│   ├── timeline.json        # 时间线
│   ├── photos.json          # 照片元数据
│   ├── chat-conversations.json # AI聊天历史
│   └── sessions.json        # 登录会话
└── uploads/           # 照片文件 (不提交)
```

## 核心功能

### 密码系统
- 双方各自设置日记密码 (bcrypt 哈希)
- 密码一旦设置不可修改
- 密码派生 AES 密钥用于日记加密
- **私密空间密码复用日记密码**

### 日记 (AES 加密)
- 内容包含文本 + 图片 + 音频 (录音/上传)
- 所有内容作为一个 JSON 整体 AES-256-GCM 加密
- 加密密钥由密码 + 随机盐通过 PBKDF2 派生
- 支持编辑、删除、日期筛选
- 音频支持懒加载播放 + 进度条拖动
- 媒体可单独删除和重命名

### 时间线
- 添加/删除纪念日
- 自动倒计时到下一次
- 10天内提醒显示在首页 (可点击跳转)

### 照片墙
- 上传照片到服务端 `uploads/` 目录
- 预览、删除

### AI 聊天 (DeepSeek API)
- 公开聊天 + 两个私密空间 (男生/女生)
- 私密空间需日记密码验证
- 历史对话管理 (切换/重命名/删除)
- 每次打开自动加载上次对话
- AI 指令位于 `server.js` 中的 `baseContent` 和 `systemPrompt`
- AI 知道当前时间、纪念日、用户性别 (私密空间)

### 首页
- 实时时钟
- 相恋天数 (从 2026-04-06 计算)
- 纪念日倒计时提醒
- 点击提醒跳转到时间线

## API 端点

### 密码
- `GET  /api/diary/:person/status` — 检查密码状态
- `POST /api/diary/:person/set-password` — 设置密码
- `POST /api/diary/:person/verify` — 验证密码 (返回 token)

### 日记
- `GET  /api/diary/:person/entries?token=` — 获取日记
- `POST /api/diary/:person/entries` — 添加日记
- `PUT  /api/diary/:person/entries/:id` — 编辑日记
- `DELETE /api/diary/:person/entries/:id?token=` — 删除日记

### 时间线
- `GET  /api/timeline` — 获取所有
- `POST /api/timeline` — 添加
- `DELETE /api/timeline/:id` — 删除

### 照片墙
- `GET  /api/photos` — 获取列表
- `POST /api/photos/upload` — 上传 (base64)
- `DELETE /api/photos/:id` — 删除

### AI 聊天
- `GET  /api/chat/conversations?space=&token=` — 获取对话列表
- `POST /api/chat/conversations` — 创建对话 (支持 space)
- `GET  /api/chat/conversations/:id?token=` — 获取对话内容
- `POST /api/chat/conversations/:id/messages` — 发送消息 (自动调用 AI)
- `PUT  /api/chat/conversations/:id` — 重命名
- `DELETE /api/chat/conversations/:id` — 删除

## 关键配置

### AI 指令位置
`server.js` 中有两处 AI 系统指令:
1. `POST /api/chat/conversations/:id/messages` 中 (主入口)
2. `POST /api/chat` 中 (旧版兼容)

每次调用 AI 时动态拼接：
- 纪念日列表 `${tlStr}`
- 性别提示 `${genderNote}` (私密空间)
- 当前时间 `${suffix}` (含凌晨提醒)

修改 AI 行为请编辑 `baseContent` 变量。

### 用户信息
- 男方: "男生" (代码中 person = 'his')
- 女方: "女生" (代码中 person = 'her')
- 相恋日: 2026-04-06

## 注意事项 ⚠️

1. **不要删除 `data/` 目录** — 密码和用户数据都在这里，删除后无法恢复
2. **密码不可修改** — 因为日记加密密钥由密码派生，没有万能密码
3. **修改 AI 指令时** — 需要同时更新两处 systemPrompt (主入口和旧版兼容)
4. **多端同步** — 数据只存在启动服务器的电脑上，手机通过局域网/ngrok 访问
5. **启动方式** — 双击 `start.bat` 或 `love.bat`
6. **`.env` 配置** — DeepSeek API 的 key、endpoint、model

# LoveStory 💕

一个私密的情侣互动网站，支持加密日记、时间线、照片墙、AI 聊天等功能。

## 功能

| 功能            | 说明                                                |
| --------------- | --------------------------------------------------- |
| 📖 **加密日记** | 双方各自独立的日记，AES-256-GCM 加密，支持图文+录音 |
| 📅 **时间线**   | 纪念日管理，自动倒计时，首页10天内提醒              |
| 📷 **照片墙**   | 上传照片到服务端，预览和删除                        |
| 🤖 **AI 聊天**  | 共享聊天 + 两个独立私密空间，可自定义 AI 人设       |
| ⚙️ **设置**     | 自定义昵称、头像、相恋日、AI 指令                   |

## Docker 部署（推荐）

服务器需要安装 Docker Engine 和 Docker Compose 插件。将项目上传到服务器后，先创建生产环境配置：

```bash
cp .env.example .env
```

编辑 `.env`。`SITE_PASSWORD` 可选，留空时不启用全站门禁；填写时至少 4 位。AI 聊天可选；若使用任意 OpenAI Chat Completions 兼容服务，再填写其 `API_KEY`、完整 `API_ENDPOINT` 和 `API_MODEL`。如需修改服务器对外端口，设置 `HOST_PORT`，例如 `HOST_PORT=8080`。

| 配置 | 是否必填 | 说明 |
| --- | --- | --- |
| `SITE_PASSWORD` | 否 | 全站访问密码；留空则不启用，填写时至少 4 位 |
| `API_KEY` | 否 | AI 服务商密钥；留空会禁用 AI 聊天 |
| `API_ENDPOINT` | 否 | 完整的 OpenAI Chat Completions 接口地址 |
| `API_MODEL` | 否 | 服务商支持的模型名 |
| `AI_TIMEOUT_MS` | 否 | 单次模型请求超时，默认 `30000` 毫秒 |
| `HOST_PORT` | 否 | 服务器对外端口，默认 `1314` |

首次构建并在后台启动：

```bash
docker compose up -d --build
```

查看服务状态和日志：

```bash
docker compose ps
docker compose logs -f app
```

浏览器访问 `http://服务器IP:HOST_PORT`。若未设置 `HOST_PORT`，默认端口为 `1314`。

更新代码、依赖或 Dockerfile 后重新构建：

```bash
docker compose up -d --build
```

只修改 `.env` 时无需构建镜像，重新创建容器即可：

```bash
docker compose up -d --force-recreate
```

应用数据保存在 Docker 命名卷 `love-data` 和 `love-uploads` 中，重建容器不会丢失。执行 `docker compose down -v` 会删除这些数据卷，除非确认要清空数据，请不要使用该命令。

备份数据卷：

```bash
docker compose exec -T app tar -czf - /app/data /app/uploads > love-backup-$(date +%F).tar.gz
```

当前 Docker 配置通过 HTTP 提供服务。生产 HTTPS 需要域名和反向代理（Caddy 或 Nginx）；不要在浏览器中把 IP 地址直接改为 `https://`。

## Android APK

项目可通过 Capacitor 生成 Android 安装包。APK 打开的网站地址从未提交的 `.env` 文件读取，因此服务器需要保持可用，所有数据仍保存在服务器的 Docker 数据卷中。

### 首次准备

构建电脑需要安装 Node.js、JDK 17 和 Android Studio（含 Android SDK）。在项目目录执行：

```bash
# 先在 .env 设置 APP_URL=https://你的域名
npm install @capacitor/core @capacitor/android
npm install -D @capacitor/cli
npx cap add android
npm run mobile:sync
```

上述命令会生成 `android/` 原生工程。请将此目录提交到 Git，但不要提交 `android/local.properties`、`*.jks` 或 `*.keystore`。

### 本地调试 APK

使用 Android Studio 打开 `android/` 目录，连接 Android 手机后点击运行；或在 Windows PowerShell 中执行：

```powershell
cd android
.\gradlew.bat assembleDebug
```

生成文件为 `android/app/build/outputs/apk/debug/app-debug.apk`，发送到 Android 手机安装即可。安装前需在手机设置中允许对应来源安装未知应用。

### 发布签名 APK

在 Android Studio 中打开 `android/`，选择 **Build > Generate Signed Bundle / APK > APK**，首次创建并妥善备份签名密钥，选择 `release` 构建类型。生成的 `app-release.apk` 可分发安装。

签名密钥一旦丢失，今后无法用同一应用身份更新已安装的 APK；请不要上传到 Git 或服务器公开目录。若计划发布到 Google Play，选择同一窗口中的 Android App Bundle，生成 `.aab` 文件。

修改 `.env` 中的 `APP_URL`、`capacitor.config.ts` 中的应用名称或原生依赖后，运行 `npm run mobile:sync` 再重新构建 APK。`APP_URL` 在 APK 构建时写入原生工程，服务器上仅修改 `.env` 不会改变已安装的 APK。

## 本地开发

### 1. 安装依赖

```bash
npm install
```

### 2. 配置 API

复制 `.env.example` 为 `.env`；AI 服务和全站访问密码均可按需配置：

```bash
cp .env.example .env
```

编辑 `.env`：

```
# 留空则不启用全站访问密码；填写时至少 4 位
SITE_PASSWORD=
API_KEY=你的服务商密钥
API_ENDPOINT=https://服务商地址/v1/chat/completions
API_MODEL=服务商模型名
AI_TIMEOUT_MS=30000
PORT=1314
# Docker Compose 对外端口（可选）
HOST_PORT=1314
```

> 填写 `SITE_PASSWORD` 后，网站入口受其保护；留空则直接访问。AI 服务需要兼容 OpenAI Chat Completions 格式；不需要 AI 时可留空三个 `API_` 配置。

### 3. 启动服务

```bash
node server.js
```

访问 `http://localhost:1314` 即可。

### 4. 运行测试

```bash
npm test
```

## 使用说明

### 首次使用

1. 若设置了 `SITE_PASSWORD`，打开页面后先输入站点访问密码
2. 双方各自设置日记密码（一经设置不可修改）
3. 日记密码同时也是 AI 私密空间的验证密码

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

- **共享空间**：通过站点访问密码的用户都能聊
- **私密空间**：需要日记密码验证，各自独立对话历史
- 每积累 30 条未压缩消息，下一次发送前会调用同一模型生成对话摘要；页面仍保留全部原始消息

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
| AI   | 任意 OpenAI Chat Completions 兼容接口（可选） |

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
├── Dockerfile              # 生产镜像
├── docker-compose.yml      # 容器部署和持久化卷
├── lib/                    # 存储和访问控制模块
├── services/               # AI 客户端
├── test/                   # Node 内置测试
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
```

## 注意事项

1. **不要删除 `data/` 目录** — 密码和数据都在里面，删除后无法恢复
2. **密码不可修改** — 日记加密密钥由密码派生，没有万能密码
3. **站点访问密码可选** — 填写 `SITE_PASSWORD` 时至少 4 位；修改后会让所有设备需要重新输入密码
4. **数据只存在服务器数据卷** — 迁移服务器时必须带上 `love-data` 和 `love-uploads`
5. **修改 AI 指令** — 可在设置页面直接修改，无需编辑代码

## License

MIT

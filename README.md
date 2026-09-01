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

编辑 `.env`。`SITE_PASSWORD` 可选，留空时不启用全站门禁；填写时至少 4 位。AI 聊天可选；若使用任意 OpenAI Chat Completions 兼容服务，再填写有效的 `API_KEY`、`API_ENDPOINT` 和 `API_MODEL`。使用官方 DeepSeek 接口时可写 `API_ENDPOINT=https://api.deepseek.com/chat/completions`、`API_MODEL=deepseek-chat`；其他服务必须使用其文档中的模型名。`API_ENDPOINT` 也可填写域名或 `/v1` 基址，程序会自动补全；不要写成 `https://https://...`。修改 `.env` 后必须执行 `docker compose up -d --build --force-recreate` 让容器重新读取配置。如需修改服务器对外端口，设置 `HOST_PORT`，例如 `HOST_PORT=8080`。

| 配置 | 是否必填 | 说明 |
| --- | --- | --- |
| `SITE_PASSWORD` | 否 | 全站访问密码；留空则不启用，填写时至少 4 位 |
| `API_KEY` | 否 | AI 服务商密钥；留空会禁用 AI 聊天（也可在网页设置中配置中转） |
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

也可以直接执行项目脚本构建调试包：

```powershell
npm run mobile:debug
```

该命令会先读取 `.env` 中的 `APP_URL`，同步 Android 工程，再生成 APK。发布包使用 `npm run mobile:release`，但正式分发前仍需使用自己的签名密钥签名。

### 没有 Android 开发环境时

仓库提供了 GitHub Actions 工作流 `.github/workflows/android-apk.yml`。在 GitHub 仓库的 **Settings > Secrets and variables > Actions** 中新增仓库 Secret：

```text
APP_URL=https://你的域名
```

然后打开 **Actions > 构建 LoveStory APK > Run workflow**。构建完成后，在该次运行页面的 **Artifacts** 下载 `LoveStory-debug-apk`，解压即可得到 `app-debug.apk`。Secret 只在构建环境使用，不会写入仓库。

### 发布签名 APK

在 Android Studio 中打开 `android/`，选择 **Build > Generate Signed Bundle / APK > APK**，首次创建并妥善备份签名密钥，选择 `release` 构建类型。生成的 `app-release.apk` 可分发安装。

签名密钥一旦丢失，今后无法用同一应用身份更新已安装的 APK；请不要上传到 Git 或服务器公开目录。若计划发布到 Google Play，选择同一窗口中的 Android App Bundle，生成 `.aab` 文件。

修改 `.env` 中的 `APP_URL`、`capacitor.config.ts` 中的应用名称或原生依赖后，运行 `npm run mobile:sync` 再重新构建 APK。`APP_URL` 在 APK 构建时写入原生工程，服务器上仅修改 `.env` 不会改变已安装的 APK。

## 原生 Android APK（Java/Android Views）

`android-app/` 是独立的原生 Android 工程，不使用 WebView 或 Capacitor。它通过 HTTPS 调用现有服务的 API，服务器数据和 AI 密钥不会进入 APK。当前原生页面包含：自适应底部导航（聊天和日记详情页自动隐藏）、男女头像与顺序、仅在有内容时显示的未来 10 天纪念日提醒、手动日期时间线、带图片/录音/音频播放器的日记编辑器、解锁后进入的便签式男女日记（支持置顶、详情、编辑和删除）、三列月份相册（全屏预览/缩放/滑动/删除）、微信式三空间聊天（键盘顶端显示最新消息、消息区独立滚动、私密 token 持久化）以及每日恋爱灵感。页面首次打开后会缓存，切换使用淡入动画，新增或删除内容时静默刷新对应页面。首次构建前，将 `android-app/local.properties.example` 复制为 `android-app/local.properties`，填写 `love.api.baseUrl=https://你的域名`，再用 Android Studio 打开 `android-app/`。

在 Android Studio 中等待 Gradle 同步完成后，选择 **Build > Build Bundle(s) / APK(s) > Build APK(s)**。调试 APK 位于：

```text
android-app/app/build/outputs/apk/debug/app-debug.apk
```

也可以在 Android Studio 的 Terminal 中运行：

```powershell
cd android-app
.\gradlew.bat assembleDebug
```

仓库也提供 `.github/workflows/android-native-apk.yml` 原生构建工作流。它与 Capacitor 工作流不同，编译的是 `android-app/` 的 Java/Android 原生工程。配置同名的 `APP_URL` Secret 后，在 GitHub Actions 手动运行该工作流，下载 `LoveStory-native-debug-apk` Artifact 即可。

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

#### AI/日记故障排查

- 日志出现 `HTTP 401`、`INVALID_API_KEY` 时，表示服务商拒绝了密钥；请在服务商后台撤销已泄露或失效的密钥并重新生成。程序无法从代码侧修复无效密钥。
- `API_KEY` 只写 `API_KEY=sk-...`，不要多写一个等号或 `Bearer` 前缀；程序会兼容清理常见误写，但仍建议修正 `.env`。
- 官方 DeepSeek 接口使用 `API_ENDPOINT=https://api.deepseek.com/chat/completions` 与 `API_MODEL=deepseek-chat`。第三方中转必须填写其文档提供的模型名和接口地址。
- 日记中的图片/音频会以 JSON 发送，应用上限为 32 MB；若前面还有 Nginx/Caddy，请同步放行请求体（Nginx 示例：`client_max_body_size 40m;`）。超过上限时客户端会显示明确的压缩提示。
- 网页设置中的“第三方中转”必须使用男生日记密码解锁；保存后服务端优先使用该配置，点击“改用 `.env` 配置”即可清除。完整密钥只保存在服务器的 `data/ai-provider.json`，接口只返回掩码。

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

### 每日恋爱灵感

服务端在上海时区每天 00:00 只生成一条内容，写入 `data/daily-inspiration.json`。首页和原生 App 只读取当天缓存，不会因为重新打开页面重复生成；模型不可用时自动使用备用文案，页面不额外显示来源标签。

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
│   ├── settings.json      # 全局设置
│   ├── ai-provider.json   # 第三方 AI 中转配置（不返回完整密钥）
│   └── daily-inspiration.json # 每日恋爱灵感缓存
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

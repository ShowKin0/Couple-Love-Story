require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { createSiteAccess } = require('./lib/site-access');
const { createStorage } = require('./lib/storage');
const { buildSystemPrompt, compactConversation, getCompactedThrough, normalizeApiKey, normalizeEndpoint, normalizeModel, requestChatReply, shouldCompactConversation } = require('./services/ai');

const app = express();
const PORT = process.env.PORT || 1314;

// ====== 目录初始化 ======
const DATA_DIR = process.env.APP_DATA_DIR || path.join(__dirname, 'data');
const UPLOADS_DIR = process.env.APP_UPLOADS_DIR || path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
const { readJSON, writeJSON } = createStorage(DATA_DIR);
const siteAccess = createSiteAccess(process.env.SITE_PASSWORD);
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

// ====== 工具函数 ======
const ALGO = 'aes-256-gcm';
const KEY_LEN = 32;
const IV_LEN = 16;
const ITERATIONS = 100000;
const DIGEST = 'sha512';

function uid() { return Date.now().toString(36) + crypto.randomBytes(4).toString('hex'); }
function localTime() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// 日记日期由用户手动填写时使用；格式统一后再落盘，旧客户端不传时仍使用服务器当前时间。
function normalizeDiaryTime(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const match = value.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = match[4] === undefined ? 0 : Number(match[4]);
  const minute = match[5] === undefined ? 0 : Number(match[5]);
  const check = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || hour > 23 || minute > 59) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
// 从密码派生 AES 密钥
function deriveKey(password, saltHex) {
  return crypto.pbkdf2Sync(password, Buffer.from(saltHex, 'hex'), ITERATIONS, KEY_LEN, DIGEST);
}

// AES-256-GCM 加密
function encryptText(text, key) {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  let enc = cipher.update(text, 'utf8', 'hex');
  enc += cipher.final('hex');
  return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), data: enc };
}

// AES-256-GCM 解密
function decryptText(pkg, key) {
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(pkg.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(pkg.tag, 'hex'));
  let dec = decipher.update(pkg.data, 'hex', 'utf8');
  dec += decipher.final('utf8');
  return dec;
}

// ====== Session 管理（内存 + 持久化） ======
let sessions = readJSON('sessions') || {};
const SESSION_TTL_MS = 60 * 60 * 1000;
function saveSessions() { writeJSON('sessions', sessions); }
function newSession(person, encKeyHex, scope = 'diary') {
  const token = uid() + uid();
  sessions[token] = { person, encKey: encKeyHex, scope, createdAt: Date.now() };
  saveSessions();
  return token;
}
function getSession(token) {
  const session = sessions[token];
  if (!session) return null;
  if (Date.now() - Number(session.createdAt || 0) > SESSION_TTL_MS) { delSession(token); return null; }
  return session;
}
function delSession(token) { delete sessions[token]; saveSessions(); }
function isDiarySession(session, person) {
  return !!session && session.person === person && (session.scope || 'diary') === 'diary';
}
function requestToken(req) {
  const auth = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  return (req.query && req.query.token) || (req.body && req.body.token) || '';
}
// 清理过期 session（1小时）
const sessionCleanupTimer = setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [k, v] of Object.entries(sessions)) {
    if (now - v.createdAt > SESSION_TTL_MS) { delete sessions[k]; changed = true; }
  }
  if (changed) saveSessions();
}, 5 * 60 * 1000);
sessionCleanupTimer.unref();

// ====== 中间件 ======
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});
// 日记可携带图片/录音/音频的 base64 内容，允许更大的单次请求；照片上传仍由 MAX_UPLOAD_BYTES 单独限制。
app.use(express.json({ limit: '32mb' }));

app.get('/healthz', (req, res) => res.json({ ok: true }));

app.get('/api/access/status', (req, res) => {
  res.json({
    configured: siteAccess.isEnabled(),
    invalidConfiguration: siteAccess.hasInvalidConfiguration(),
    authenticated: !siteAccess.isEnabled() || siteAccess.hasAccess(req),
  });
});

app.post('/api/access/login', (req, res) => {
  if (!siteAccess.isEnabled()) return res.status(400).json({ error: 'SITE_PASSWORD 未启用或少于 4 位' });
  if (!siteAccess.verifyPassword(req.body.password)) return res.status(403).json({ error: '访问密码错误' });
  siteAccess.setAccessCookie(req, res);
  res.json({ ok: true });
});

app.post('/api/access/logout', (req, res) => {
  siteAccess.clearAccessCookie(res);
  res.json({ ok: true });
});

app.use('/api', siteAccess.requireAccess);
app.use('/uploads', siteAccess.requireAccess, express.static(UPLOADS_DIR, { index: false }));
app.get('/index.css', (req, res) => res.sendFile(path.join(__dirname, 'index.css')));
app.get('/index.js', (req, res) => res.sendFile(path.join(__dirname, 'index.js')));

// ====== 密码系统 API ======

// 检查密码状态
app.get('/api/diary/:person/status', (req, res) => {
  const { person } = req.params;
  if (!['his', 'her'].includes(person)) return res.status(400).json({ error: 'invalid person' });
  const pw = readJSON('passwords') || {};
  res.json({ individualSet: !!(pw[person] && pw[person].set) });
});

// 设置个人密码
app.post('/api/diary/:person/set-password', async (req, res) => {
  const { person } = req.params;
  if (!['his', 'her'].includes(person)) return res.status(400).json({ error: 'invalid person' });
  const { password } = req.body;
  if (!password || password.length < 4) return res.status(400).json({ error: '密码至少4位' });

  let pw = readJSON('passwords') || {};
  if (pw[person] && pw[person].set) return res.status(403).json({ error: '已设置密码，不可修改' });

  const hash = await bcrypt.hash(password, 10);
  const salt = crypto.randomBytes(32).toString('hex');
  const keyFromPwd = deriveKey(password, salt);

  // 生成独立的日记加密密钥，用密码派生密钥加密存储
  const diaryEncKey = crypto.randomBytes(32);
  const wrappedKey = encryptText(diaryEncKey.toString('hex'), keyFromPwd);

  if (!pw[person]) pw[person] = {};
  pw[person].set = true;
  pw[person].hash = hash;
  pw[person].salt = salt;
  pw[person].wrappedKey = wrappedKey;

  writeJSON('passwords', pw);

  // 初始化空日记
  const diaryKey = 'diary-' + person;
  if (!readJSON(diaryKey)) writeJSON(diaryKey, []);

  // 创建 session
  const token = newSession(person, diaryEncKey.toString('hex'));
  res.json({ ok: true, token, message: '密码设置成功！' });
});

// 验证个人密码
app.post('/api/diary/:person/verify', async (req, res) => {
  const { person } = req.params;
  const { password } = req.body;
  if (!['his', 'her'].includes(person)) return res.status(400).json({ error: 'invalid person' });

  const pw = readJSON('passwords') || {};
  if (!pw[person] || !pw[person].set) return res.status(400).json({ error: '未设置密码' });

  const match = await bcrypt.compare(password, pw[person].hash);
  if (!match) return res.status(403).json({ error: '密码错误' });

  const keyFromPwd = deriveKey(password, pw[person].salt);
  const diaryEncKey = decryptText(pw[person].wrappedKey, keyFromPwd);
  const token = newSession(person, diaryEncKey);

  res.json({ ok: true, token });
});

// ====== 日记 API（加密存储） ======

// 获取日记条目
app.get('/api/diary/:person/entries', (req, res) => {
  const { person } = req.params;
  if (!['his', 'her'].includes(person)) return res.status(400).json({ error: 'invalid person' });
  const token = req.query.token;
  const session = getSession(token);
  if (!session) return res.status(401).json({ error: '未登录' });

  if (!isDiarySession(session, person)) return res.status(403).json({ error: '无权限' });

  const key = Buffer.from(session.encKey, 'hex');
  const diaryKey = 'diary-' + person;
  const entries = readJSON(diaryKey) || [];

  // 解密所有条目
  const decrypted = entries.map(e => {
    try {
      const content = decryptText(e.encrypted, key);
      return { id: e.id, content, time: e.time, pinned: e.pinned === true };
    } catch {
      return { id: e.id, content: '（解密失败）', time: e.time, pinned: e.pinned === true };
    }
  });

  decrypted.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.time.replace(' ✏️', '').replace(' ','T')) - new Date(a.time.replace(' ✏️', '').replace(' ','T'));
  });
  res.json(decrypted);
});

// 添加日记条目
app.post('/api/diary/:person/entries', (req, res) => {
  const { person } = req.params;
  if (!['his', 'her'].includes(person)) return res.status(400).json({ error: 'invalid person' });
  const token = req.body.token;
  const session = getSession(token);
  if (!session) return res.status(401).json({ error: '未登录' });

  if (!isDiarySession(session, person)) return res.status(403).json({ error: '无权限' });

  const { content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: '内容不能为空' });

  const key = Buffer.from(session.encKey, 'hex');
  const diaryKey = 'diary-' + person;
  const entries = readJSON(diaryKey) || [];

  const time = req.body.time === undefined || req.body.time === null || req.body.time === ''
    ? localTime()
    : normalizeDiaryTime(req.body.time);
  if (!time) return res.status(400).json({ error: '日期格式无效，应为 YYYY-MM-DD HH:mm' });

  const entry = {
    id: uid(),
    encrypted: encryptText(content, key),
    time,
    pinned: req.body.pinned === true,
  };

  entries.push(entry);
  writeJSON(diaryKey, entries);

  res.json({ ok: true, id: entry.id, time });
});

// 删除日记条目
app.delete('/api/diary/:person/entries/:id', (req, res) => {
  const { person, id } = req.params;
  if (!['his', 'her'].includes(person)) return res.status(400).json({ error: 'invalid person' });
  const token = req.query.token;
  const session = getSession(token);
  if (!session) return res.status(401).json({ error: '未登录' });
  if (!isDiarySession(session, person)) return res.status(403).json({ error: '无权限' });

  const diaryKey = 'diary-' + person;
  let entries = readJSON(diaryKey) || [];
  entries = entries.filter(e => e.id !== id);
  writeJSON(diaryKey, entries);
  res.json({ ok: true });
});

// 编辑日记条目
app.put('/api/diary/:person/entries/:id', (req, res) => {
  const { person, id } = req.params;
  if (!['his', 'her'].includes(person)) return res.status(400).json({ error: 'invalid person' });
  const token = req.body.token;
  const session = getSession(token);
  if (!session) return res.status(401).json({ error: '未登录' });
  if (!isDiarySession(session, person)) return res.status(403).json({ error: '无权限' });

  const { content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: '内容不能为空' });

  const key = Buffer.from(session.encKey, 'hex');
  const diaryKey = 'diary-' + person;
  const entries = readJSON(diaryKey) || [];
  const idx = entries.findIndex(e => e.id === id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });

  const time = req.body.time === undefined || req.body.time === null || req.body.time === ''
    ? localTime()
    : normalizeDiaryTime(req.body.time);
  if (!time) return res.status(400).json({ error: '日期格式无效，应为 YYYY-MM-DD HH:mm' });

  entries[idx].encrypted = encryptText(content, key);
  entries[idx].time = time + ' ✏️';
  if (req.body.pinned !== undefined) entries[idx].pinned = req.body.pinned === true;
  writeJSON(diaryKey, entries);
  res.json({ ok: true, time: entries[idx].time });
});

// ====== 时间线 API ======
app.get('/api/timeline', (req, res) => {
  const data = readJSON('timeline') || [];
  data.sort((a, b) => new Date(b.date) - new Date(a.date));
  res.json(data);
});

app.post('/api/timeline', (req, res) => {
  const { date, title, desc } = req.body;
  if (!date || typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: '需要日期和标题' });
  const data = readJSON('timeline') || [];
  data.push({ id: uid(), date, title: title.trim().slice(0, 100), desc: typeof desc === 'string' ? desc.trim().slice(0, 500) : '' });
  writeJSON('timeline', data);
  res.json({ ok: true });
});

app.delete('/api/timeline/:id', (req, res) => {
  const { id } = req.params;
  let data = readJSON('timeline') || [];
  data = data.filter(d => d.id !== id);
  writeJSON('timeline', data);
  res.json({ ok: true });
});

// ====== 照片墙 API ======
function parseImageData(base64Data) {
  if (typeof base64Data !== 'string') return null;
  const matches = base64Data.match(/^data:image\/(jpeg|png|webp|gif);base64,([A-Za-z0-9+/=]+)$/i);
  if (!matches) return null;

  const buffer = Buffer.from(matches[2], 'base64');
  if (!buffer.length || buffer.length > MAX_UPLOAD_BYTES) return null;

  const extension = matches[1].toLowerCase() === 'jpeg' ? 'jpg' : matches[1].toLowerCase();
  return { buffer, extension };
}

app.get('/api/photos', (req, res) => {
  const data = readJSON('photos') || [];
  res.json(data);
});

app.post('/api/photos/upload', (req, res) => {
  const image = parseImageData(req.body.data);
  if (!image) return res.status(400).json({ error: '图片格式无效或超过 8MB' });

  const fileName = `${uid()}.${image.extension}`;
  const filePath = path.join(UPLOADS_DIR, fileName);
  fs.writeFileSync(filePath, image.buffer);

  const photos = readJSON('photos') || [];
  const photo = {
    id: uid(),
    url: '/uploads/' + fileName,
    time: localTime(),
  };
  photos.push(photo);
  writeJSON('photos', photos);

  res.json({ ok: true, photo });
});

app.delete('/api/photos/:id', (req, res) => {
  const { id } = req.params;
  let photos = readJSON('photos') || [];
  const photo = photos.find(p => p.id === id);
  if (photo) {
    const filePath = path.join(UPLOADS_DIR, path.basename(photo.url));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  photos = photos.filter(p => p.id !== id);
  writeJSON('photos', photos);
  res.json({ ok: true });
});

// ====== 设置 API ======
app.get('/api/settings', (req, res) => {
  let settings = readJSON('settings');
  if (!settings) settings = {};
  // 补全默认字段
  const defaults = { hisNickname: '男生', herNickname: '女生', hisAvatar: '👦', herAvatar: '👧', loveDate: '2026-04-06', aiInstruction: '' };
  let changed = false;
  for (const [k, v] of Object.entries(defaults)) {
    if (settings[k] === undefined) { settings[k] = v; changed = true; }
  }
  if (changed) writeJSON('settings', settings);
  res.json(settings);
});

app.put('/api/settings', (req, res) => {
  const { hisNickname, herNickname, hisAvatar, herAvatar, hisAvatarData, herAvatarData, loveDate, aiInstruction } = req.body;
  const existing = {
    hisNickname: '男生',
    herNickname: '女生',
    hisAvatar: '👦',
    herAvatar: '👧',
    loveDate: '2026-04-06',
    aiInstruction: '',
    ...(readJSON('settings') || {}),
  };
  let finalHis = typeof hisAvatar === 'string' && hisAvatar ? hisAvatar : existing.hisAvatar;
  let finalHer = typeof herAvatar === 'string' && herAvatar ? herAvatar : existing.herAvatar;
  if (hisAvatarData) { const u = saveAvatarFile(hisAvatarData, 'his'); if (u) finalHis = u; }
  if (herAvatarData) { const u = saveAvatarFile(herAvatarData, 'her'); if (u) finalHer = u; }
  const settings = {
    hisNickname: typeof hisNickname === 'string' ? (hisNickname.trim().slice(0, 30) || '男生') : existing.hisNickname,
    herNickname: typeof herNickname === 'string' ? (herNickname.trim().slice(0, 30) || '女生') : existing.herNickname,
    hisAvatar: finalHis,
    herAvatar: finalHer,
    loveDate: typeof loveDate === 'string' && loveDate ? loveDate : existing.loveDate,
    aiInstruction: typeof aiInstruction === 'string' ? aiInstruction.slice(0, 5_000) : existing.aiInstruction,
  };
  writeJSON('settings', settings);
  res.json({ ok: true, settings });
});

// ====== 第三方 AI 中转设置（男生日记密码保护） ======
// 中转密钥单独存储，绝不随普通设置接口返回给浏览器。
function readAiProvider() {
  const provider = readJSON('ai-provider');
  if (!provider || typeof provider !== 'object') return null;
  const endpoint = normalizeEndpoint(provider.endpoint);
  const model = normalizeModel(provider.model);
  const apiKey = normalizeApiKey(provider.apiKey);
  if (!endpoint || !model || !apiKey) return null;
  return { endpoint, model, apiKey };
}

function maskApiKey(value) {
  const key = normalizeApiKey(value);
  if (!key) return '';
  if (key.length <= 8) return '••••••••';
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

function aiProviderView() {
  const custom = readAiProvider();
  const endpoint = custom?.endpoint || normalizeEndpoint(process.env.API_ENDPOINT);
  const model = custom?.model || normalizeModel(process.env.API_MODEL);
  const apiKey = custom?.apiKey || normalizeApiKey(process.env.API_KEY);
  return {
    configured: !!(endpoint && model && apiKey),
    source: custom ? 'custom' : 'env',
    endpoint: endpoint || '',
    model: model || '',
    apiKeyMasked: maskApiKey(apiKey),
  };
}

function aiSettingsSession(req) {
  const session = getSession(requestToken(req));
  return session && session.person === 'his' && session.scope === 'ai-settings' ? session : null;
}

app.post('/api/ai/provider/verify', async (req, res) => {
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const passwords = readJSON('passwords') || {};
  const record = passwords.his;
  if (!record?.set || !record.hash) return res.status(400).json({ error: '请先设置男生日记密码' });
  const match = await bcrypt.compare(password, record.hash);
  if (!match) return res.status(403).json({ error: '男生日记密码错误' });
  const token = newSession('his', null, 'ai-settings');
  res.json({ ok: true, token });
});

app.get('/api/ai/provider', (req, res) => {
  if (!aiSettingsSession(req)) return res.status(403).json({ error: '需要男生日记密码' });
  res.json(aiProviderView());
});

app.put('/api/ai/provider', (req, res) => {
  if (!aiSettingsSession(req)) return res.status(403).json({ error: '需要男生日记密码' });
  if (req.body?.clear === true) {
    writeJSON('ai-provider', {});
    return res.json({ ok: true, provider: aiProviderView() });
  }

  const endpoint = normalizeEndpoint(req.body?.endpoint);
  const model = normalizeModel(req.body?.model);
  const existing = readAiProvider();
  const apiKey = normalizeApiKey(req.body?.apiKey) || existing?.apiKey || '';
  if (!endpoint) return res.status(400).json({ error: '请输入有效的中转接口地址' });
  if (endpoint.length > 500) return res.status(400).json({ error: '接口地址过长' });
  if (!model || model.length > 120) return res.status(400).json({ error: '请输入有效的模型名称' });
  if (!apiKey || apiKey.length > 1_000) return res.status(400).json({ error: '请输入有效的 API 密钥' });

  writeJSON('ai-provider', { endpoint, model, apiKey, updatedAt: localTime() });
  res.json({ ok: true, provider: aiProviderView() });
});

function saveAvatarFile(base64Data, person) {
  const image = parseImageData(base64Data);
  if (!image) return null;
  const name = `avatar-${person}-${uid()}.${image.extension}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, name), image.buffer);
  return '/uploads/' + name;
}

// ====== 每日恋爱灵感 ======
const DAILY_FALLBACKS = [
  '把普通的日子过得浪漫一点，就是爱情。',
  '真正的陪伴，不是时时刻刻在一起，而是彼此都在心上。',
  '今天也给对方留一盏灯，哪怕只是一句晚安。',
  '爱不是轰轰烈烈的誓言，是愿意把小事认真说给你听。',
  '愿你们在每一个平凡的日子里，都发现一点值得庆祝的事。',
];
let dailyGenerationPromise = null;

function shanghaiDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = type => parts.find(part => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function ensureDailyInspiration() {
  const day = shanghaiDateKey();
  const existing = readJSON('daily-inspiration');
  if (existing && existing.date === day && existing.text) return existing;

  // 先写入备用内容，接口始终快速可用；AI 成功后在后台替换同一天内容。
  const fallback = { date: day, text: DAILY_FALLBACKS[Math.floor(Math.random() * DAILY_FALLBACKS.length)], source: 'AI 原创' };
  writeJSON('daily-inspiration', fallback);
  if (!dailyGenerationPromise) {
    const prompt = '请写一句或两句温柔、克制、适合情侣 App 首页展示的恋爱灵感或原创短故事，不超过60字，不要冒充名人名句，不要使用引号。';
    dailyGenerationPromise = requestChatReply([{ role: 'user', content: prompt }], '你是 LoveStory 的每日文案编辑，只输出中文原创内容。', '', readAiProvider())
      .then(text => { const fresh = { date: day, text: String(text).trim().slice(0, 180), source: 'AI 原创' }; writeJSON('daily-inspiration', fresh); return fresh; })
      .catch(error => { console.error('Daily inspiration generation failed:', error.message); return fallback; })
      .finally(() => { dailyGenerationPromise = null; });
  }
  return fallback;
}

app.get('/api/daily-inspiration', (req, res) => res.json(ensureDailyInspiration()));

function scheduleDailyInspiration() {
  const now = new Date();
  const today = shanghaiDateKey(now);
  // 上海全年 UTC+8，无夏令时；16:00Z 即次日 00:00（留 5 秒给系统跨日）。
  let next = new Date(`${today}T16:00:05.000Z`);
  if (next <= now) { next = new Date(next.getTime() + 24 * 60 * 60 * 1000); }
  const timer = setTimeout(() => { ensureDailyInspiration(); scheduleDailyInspiration(); }, Math.max(1000, next.getTime() - now.getTime()));
  timer.unref();
}

// ====== AI 聊天 — 历史对话 ======

// 获取所有对话（支持空间筛选）
app.get('/api/chat/conversations', (req, res) => {
  const data = readJSON('chat-conversations') || [];
  const space = req.query.space || 'public';
  let filtered = data;
  if (space === 'public') {
    filtered = data.filter(c => !c.space || c.space === 'public');
  } else if (space === 'his' || space === 'her') {
    const token = req.query.token;
    const session = getSession(token);
    if (!isDiarySession(session, space)) return res.status(403).json({ error: '无权限' });
    filtered = data.filter(c => c.space === space);
  }
  const summary = filtered.map(c => ({
    id: c.id,
    title: c.title,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    msgCount: c.messages ? c.messages.length : 0,
    space: c.space || 'public',
  }));
  summary.sort((a, b) => new Date(b.updatedAt.replace(' ','T')) - new Date(a.updatedAt.replace(' ','T')));
  res.json(summary);
});

// 创建新对话（支持空间）
app.post('/api/chat/conversations', (req, res) => {
  const data = readJSON('chat-conversations') || [];
  const now = localTime();
  const space = req.body.space || 'public';
  // 私密空间需验证 token
  if (space !== 'public') {
    const session = getSession(req.body.token);
    if (!isDiarySession(session, space)) return res.status(403).json({ error: '无权限' });
  }
  const conv = {
    id: uid(),
    title: req.body.title || '新对话 ' + now,
    messages: [],
    createdAt: now,
    updatedAt: now,
    space,
  };
  data.push(conv);
  writeJSON('chat-conversations', data);
  res.json(conv);
});

// 获取单个对话完整内容
app.get('/api/chat/conversations/:id', (req, res) => {
  const data = readJSON('chat-conversations') || [];
  const conv = data.find(c => c.id === req.params.id);
  if (!conv) return res.status(404).json({ error: 'not found' });
  // 私密空间需验证
  if (conv.space && conv.space !== 'public') {
    const token = req.query.token;
    const session = getSession(token);
    if (!isDiarySession(session, conv.space)) return res.status(403).json({ error: '无权限' });
  }
  res.json(conv);
});

// 添加消息到对话
app.post('/api/chat/conversations/:id/messages', async (req, res) => {
  const data = readJSON('chat-conversations') || [];
  const conv = data.find(c => c.id === req.params.id);
  if (!conv) return res.status(404).json({ error: 'not found' });

  // 私密空间消息需验证
  if (conv.space && conv.space !== 'public') {
    const session = getSession(req.body.token);
    if (!isDiarySession(session, conv.space)) return res.status(403).json({ error: '无权限' });
  }

  const { role, content } = req.body;
  if (role !== 'user' || typeof content !== 'string' || !content.trim()) return res.status(400).json({ error: '需要用户消息内容' });

  if (shouldCompactConversation(conv.messages, conv.compaction)) {
    try {
      const through = getCompactedThrough(conv.compaction, conv.messages.length);
      const summary = await compactConversation(conv.compaction?.summary || '', conv.messages.slice(through), readAiProvider());
      conv.compaction = { summary, through: conv.messages.length, updatedAt: localTime() };
      writeJSON('chat-conversations', data);
    } catch (error) {
      console.error('Conversation compaction failed:', error.message);
    }
  }

  conv.messages.push({ role, content: content.trim().slice(0, 10_000) });
  conv.updatedAt = localTime();

  // 自动生成标题（第一条用户消息）
  if (conv.title === '新对话 ' + conv.createdAt.slice(0, 16).replace('T', ' ') && role === 'user') {
    conv.title = content.slice(0, 30) + (content.length > 30 ? '...' : '');
  }

  writeJSON('chat-conversations', data);

  try {
    const systemPrompt = buildSystemPrompt({
      timeline: readJSON('timeline') || [],
      settings: readJSON('settings') || {},
      space: conv.space,
    });
    const through = getCompactedThrough(conv.compaction, conv.messages.length);
    const reply = await requestChatReply(conv.messages.slice(through), systemPrompt, conv.compaction?.summary || '', readAiProvider());
    conv.messages.push({ role: 'assistant', content: reply });
    conv.updatedAt = localTime();
    writeJSON('chat-conversations', data);
    res.json({ reply, conversationId: conv.id });
  } catch (error) {
    console.error('AI request failed:', error.message);
    res.status(502).json({ reply: null, error: publicAiError(error) });
  }
});

function publicAiError(error) {
  const message = String(error?.message || '').toLowerCase();
  if (message.includes('尚未配置') || message.includes('authentication') || message.includes('invalid') || message.includes('http 401')) {
    return 'AI 配置无效，请检查 API_KEY、API_ENDPOINT 和 API_MODEL';
  }
  if (message.includes('http 404') || message.includes('model')) return 'AI 接口或模型不存在，请检查 API_ENDPOINT 和 API_MODEL';
  if (message.includes('timeout') || message.includes('timed out') || message.includes('abort')) return 'AI 请求超时，请检查网络或适当增大 AI_TIMEOUT_MS';
  return 'AI 服务暂时不可用，请稍后重试';
}

// 删除对话
app.delete('/api/chat/conversations/:id', (req, res) => {
  let data = readJSON('chat-conversations') || [];
  const target = data.find(c => c.id === req.params.id);
  if (!target) return res.status(404).json({ error: 'not found' });
  if (target.space && target.space !== 'public') {
    const session = getSession(requestToken(req));
    if (!isDiarySession(session, target.space)) return res.status(403).json({ error: '无权限' });
  }
  data = data.filter(c => c.id !== req.params.id);
  writeJSON('chat-conversations', data);
  res.json({ ok: true });
});

// 重命名对话
app.put('/api/chat/conversations/:id', (req, res) => {
  const data = readJSON('chat-conversations') || [];
  const conv = data.find(c => c.id === req.params.id);
  if (!conv) return res.status(404).json({ error: 'not found' });
  if (conv.space && conv.space !== 'public') {
    const session = getSession(requestToken(req));
    if (!isDiarySession(session, conv.space)) return res.status(403).json({ error: '无权限' });
  }
  const { title } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: '标题不能为空' });
  conv.title = title.trim();
  conv.updatedAt = localTime();
  writeJSON('chat-conversations', data);
  res.json({ ok: true, title: conv.title });
});

// ====== 静态文件服务 ======
app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 让移动端能拿到可读的 JSON 错误，而不是 body-parser 默认返回的 HTML。
// 尤其是日记携带图片/音频时，超过代理或应用上限应明确提示用户压缩附件。
app.use((error, req, res, next) => {
  if (error?.type === 'entity.too.large') {
    return res.status(413).json({ error: '请求内容过大，请压缩图片或音频后重试' });
  }
  if (error instanceof SyntaxError && error.status === 400 && Object.prototype.hasOwnProperty.call(error, 'body')) {
    return res.status(400).json({ error: '请求数据格式无效' });
  }
  if (error) {
    console.error('Unhandled API error:', error);
    return res.status(500).json({ error: '服务器内部错误，请稍后重试' });
  }
  return next();
});

if (require.main === module) {
  // 启动时补偿当天尚未生成的内容，避免服务器在 00:00 重启后错过任务。
  ensureDailyInspiration();
  scheduleDailyInspiration();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`💕 情侣网站已启动: http://localhost:${PORT}`);
    console.log(`📡 局域网访问: http://${getLANIP()}:${PORT}`);
  });
}

function getLANIP() {
  const nets = require('os').networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '0.0.0.0';
}

module.exports = { app };

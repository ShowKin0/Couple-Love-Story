require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { createSiteAccess } = require('./lib/site-access');
const { createStorage } = require('./lib/storage');
const { buildSystemPrompt, compactConversation, getCompactedThrough, requestChatReply, shouldCompactConversation } = require('./services/ai');

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
function saveSessions() { writeJSON('sessions', sessions); }
function newSession(person, encKeyHex) {
  const token = uid() + uid();
  sessions[token] = { person, encKey: encKeyHex, createdAt: Date.now() };
  saveSessions();
  return token;
}
function getSession(token) { return sessions[token] || null; }
function delSession(token) { delete sessions[token]; saveSessions(); }
// 清理过期 session（24小时）
const sessionCleanupTimer = setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [k, v] of Object.entries(sessions)) {
    if (now - v.createdAt > 86400000) { delete sessions[k]; changed = true; }
  }
  if (changed) saveSessions();
}, 3600000);
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
app.use(express.json({ limit: '12mb' }));

app.get('/healthz', (req, res) => res.json({ ok: true }));

app.get('/api/access/status', (req, res) => {
  res.json({ configured: Boolean(process.env.SITE_PASSWORD), authenticated: siteAccess.hasAccess(req) });
});

app.post('/api/access/login', (req, res) => {
  if (!process.env.SITE_PASSWORD) return res.status(503).json({ error: '未配置 SITE_PASSWORD' });
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

  if (session.person !== person) return res.status(403).json({ error: '无权限' });

  const key = Buffer.from(session.encKey, 'hex');
  const diaryKey = 'diary-' + person;
  const entries = readJSON(diaryKey) || [];

  // 解密所有条目
  const decrypted = entries.map(e => {
    try {
      const content = decryptText(e.encrypted, key);
      return { id: e.id, content, time: e.time };
    } catch {
      return { id: e.id, content: '（解密失败）', time: e.time };
    }
  });

  decrypted.sort((a, b) => new Date(b.time.replace(' ','T')) - new Date(a.time.replace(' ','T')));
  res.json(decrypted);
});

// 添加日记条目
app.post('/api/diary/:person/entries', (req, res) => {
  const { person } = req.params;
  if (!['his', 'her'].includes(person)) return res.status(400).json({ error: 'invalid person' });
  const token = req.body.token;
  const session = getSession(token);
  if (!session) return res.status(401).json({ error: '未登录' });

  if (session.person !== person) return res.status(403).json({ error: '无权限' });

  const { content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: '内容不能为空' });

  const key = Buffer.from(session.encKey, 'hex');
  const diaryKey = 'diary-' + person;
  const entries = readJSON(diaryKey) || [];

  const now = new Date();
  const time = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  const entry = {
    id: uid(),
    encrypted: encryptText(content, key),
    time,
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
  if (session.person !== person) return res.status(403).json({ error: '无权限' });

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
  if (session.person !== person) return res.status(403).json({ error: '无权限' });

  const { content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: '内容不能为空' });

  const key = Buffer.from(session.encKey, 'hex');
  const diaryKey = 'diary-' + person;
  const entries = readJSON(diaryKey) || [];
  const idx = entries.findIndex(e => e.id === id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });

  const now = new Date();
  const time = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  entries[idx].encrypted = encryptText(content, key);
  entries[idx].time = time + ' ✏️';
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
  let finalHis = hisAvatar || '👦';
  let finalHer = herAvatar || '👧';
  if (hisAvatarData) { const u = saveAvatarFile(hisAvatarData, 'his'); if (u) finalHis = u; }
  if (herAvatarData) { const u = saveAvatarFile(herAvatarData, 'her'); if (u) finalHer = u; }
  const settings = {
    hisNickname: typeof hisNickname === 'string' && hisNickname.trim() ? hisNickname.trim().slice(0, 30) : '男生',
    herNickname: typeof herNickname === 'string' && herNickname.trim() ? herNickname.trim().slice(0, 30) : '女生',
    hisAvatar: finalHis,
    herAvatar: finalHer,
    loveDate: loveDate || '2026-04-06',
    aiInstruction: typeof aiInstruction === 'string' ? aiInstruction.slice(0, 5_000) : ''
  };
  writeJSON('settings', settings);
  res.json({ ok: true, settings });
});

function saveAvatarFile(base64Data, person) {
  const image = parseImageData(base64Data);
  if (!image) return null;
  const name = `avatar-${person}-${uid()}.${image.extension}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, name), image.buffer);
  return '/uploads/' + name;
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
    if (!session || session.person !== space) return res.status(403).json({ error: '无权限' });
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
    if (!session || session.person !== space) return res.status(403).json({ error: '无权限' });
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
    if (!session || session.person !== conv.space) return res.status(403).json({ error: '无权限' });
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
    if (!session || session.person !== conv.space) return res.status(403).json({ error: '无权限' });
  }

  const { role, content } = req.body;
  if (role !== 'user' || typeof content !== 'string' || !content.trim()) return res.status(400).json({ error: '需要用户消息内容' });

  if (shouldCompactConversation(conv.messages, conv.compaction)) {
    try {
      const through = getCompactedThrough(conv.compaction, conv.messages.length);
      const summary = await compactConversation(conv.compaction?.summary || '', conv.messages.slice(through));
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
    const reply = await requestChatReply(conv.messages.slice(through), systemPrompt, conv.compaction?.summary || '');
    conv.messages.push({ role: 'assistant', content: reply });
    conv.updatedAt = localTime();
    writeJSON('chat-conversations', data);
    res.json({ reply, conversationId: conv.id });
  } catch (error) {
    console.error('AI request failed:', error.message);
    res.status(502).json({ reply: null, error: 'AI 服务暂时不可用，请稍后重试' });
  }
});

// 删除对话
app.delete('/api/chat/conversations/:id', (req, res) => {
  let data = readJSON('chat-conversations') || [];
  data = data.filter(c => c.id !== req.params.id);
  writeJSON('chat-conversations', data);
  res.json({ ok: true });
});

// 重命名对话
app.put('/api/chat/conversations/:id', (req, res) => {
  const data = readJSON('chat-conversations') || [];
  const conv = data.find(c => c.id === req.params.id);
  if (!conv) return res.status(404).json({ error: 'not found' });
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

if (require.main === module) {
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

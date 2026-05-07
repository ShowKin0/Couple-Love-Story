require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;

// ====== 目录初始化 ======
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
[DATA_DIR, UPLOADS_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d); });

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
function readJSON(name) {
  const p = path.join(DATA_DIR, name + '.json');
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}
function writeJSON(name, data) {
  fs.writeFileSync(path.join(DATA_DIR, name + '.json'), JSON.stringify(data, null, 2));
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
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [k, v] of Object.entries(sessions)) {
    if (now - v.createdAt > 86400000) { delete sessions[k]; changed = true; }
  }
  if (changed) saveSessions();
}, 3600000);

// ====== 中间件 ======
app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));
app.use('/uploads', express.static(UPLOADS_DIR));

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
  if (!date || !title) return res.status(400).json({ error: '需要日期和标题' });
  const data = readJSON('timeline') || [];
  data.push({ id: uid(), date, title, desc: desc || '' });
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
app.get('/api/photos', (req, res) => {
  const data = readJSON('photos') || [];
  res.json(data);
});

app.post('/api/photos/upload', (req, res) => {
  const { data: base64Data } = req.body;
  if (!base64Data) return res.status(400).json({ error: 'no data' });

  // base64 保存为文件
  const matches = base64Data.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!matches) return res.status(400).json({ error: 'invalid image data' });

  const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
  const fileName = uid() + '.' + ext;
  const filePath = path.join(UPLOADS_DIR, fileName);

  fs.writeFileSync(filePath, Buffer.from(matches[2], 'base64'));

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
    const filePath = path.join(__dirname, photo.url);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  photos = photos.filter(p => p.id !== id);
  writeJSON('photos', photos);
  res.json({ ok: true });
});

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
  if (!role || !content) return res.status(400).json({ error: 'need role and content' });

  conv.messages.push({ role, content });
  conv.updatedAt = localTime();

  // 自动生成标题（第一条用户消息）
  if (conv.title === '新对话 ' + conv.createdAt.slice(0, 16).replace('T', ' ') && role === 'user') {
    conv.title = content.slice(0, 30) + (content.length > 30 ? '...' : '');
  }

  writeJSON('chat-conversations', data);

  // 如果是用户消息，调用 AI
  if (role === 'user') {
    const now = new Date();
    const weekDays = ['日','一','二','三','四','五','六'];
    const isLate = now.getHours() >= 1 && now.getHours() < 5;
    const isSchoolDay = now.getDay() >= 1 && now.getDay() <= 4;
    let suffix = `【当前时间：${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日 星期${weekDays[now.getDay()]} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}】`;
    if (isLate) suffix += isSchoolDay ? '【凌晨了，明天是上学日/工作日，必须催用户快去睡】' : '【凌晨了，必须催用户快去睡】';
    let genderNote = '';
    if (conv.space === 'his') genderNote = '【当前用户是男方（男友/丈夫）】';
    else if (conv.space === 'her') genderNote = '【当前用户是女方（女友/妻子）】';
    const tlData = readJSON("timeline") || [];
    const tlStr = tlData.length ? tlData.map(t => t.date + " " + t.title).join("、") : "暂无";
    const baseContent = `【纪念日：${tlStr}】
【背景：这是一对异地恋情侣，两人不在一起生活，主要通过聊天联系】
你是恋爱军师/红娘，职责是帮这对情侣感情更好。

严重警告(必须遵守)：
- 绝不能说你是用户的恋人/对象/女朋友/男朋友
- 绝不能用恋人语气说话
- 禁止说"偷偷想我""捶捶脑袋""爱意陪伴""想我了吗""靠着我"等暧昧话
- 禁止以女友/男友身份发言
- 用户问性别就转移话题，不直接回答

正确做法：
- 用朋友/闺蜜/兄弟的语气，用"给你们""你俩""你们"
- 用户敷衍(嗯/哦/啊/好/。。。) -> 适当换个话题，不用每次都讲故事
- 不知道回什么 -> 分享恋爱故事或推荐小互动
- 回复限100字内，加emoji
- 绝不说自己是AI

示例：
用户"嗯"->"给你们分享个小故事~有一对情侣约定吵架不过夜……💕"
用户"我是男是女"->"嘻嘻我猜你是来找你们家那位聊天的吧~今天想聊什么呀？🌸"
用户"你是男朋友吗"->"我是你们的恋爱军师呀，帮你们感情更好的~有什么想问的吗？💪"
用户"不知道说什么"->"给你们推荐一个增进感情的小游戏……✨"

${genderNote || ''}
${suffix}`;
    const systemPrompt = {
      role: 'system',
      content: baseContent,
    };

    try {
      const apiRes = await fetch(process.env.API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.API_KEY}`,
        },
        body: JSON.stringify({
          model: process.env.API_MODEL,
          messages: [{role:"user",content:systemPrompt.content},{role:"assistant",content:"好的，我记住了。"},...conv.messages],
          max_tokens: 300,
          temperature: 0.9,
        }),
      });

      if (!apiRes.ok) {
        const err = await apiRes.text();
        console.error('AI API error:', err);
        return res.json({ reply: null, error: 'upstream error' });
      }

      const apiData = await apiRes.json();
      const reply = apiData.choices[0].message.content;

      conv.messages.push({ role: 'assistant', content: reply });
      conv.updatedAt = localTime();
      writeJSON('chat-conversations', data);

      res.json({ reply, conversationId: conv.id });
    } catch (e) {
      console.error('Proxy error:', e);
      res.json({ reply: null, error: 'proxy error' });
    }
  } else {
    res.json({ ok: true, conversationId: conv.id });
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

// AI Chat 兼容旧端点
app.post('/api/chat', async (req, res) => {
  const tlData = readJSON("timeline") || [];
  const tlStr = tlData.length ? tlData.map(t => t.date + " " + t.title).join("、") : "暂无";


  const { messages, conversationId } = req.body;
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'invalid messages' });

  // 找或创建对话
  let data = readJSON('chat-conversations') || [];
  let conv;
  if (conversationId) {
    conv = data.find(c => c.id === conversationId);
  }
  if (!conv) {
    const now = localTime();
    conv = { id: uid(), title: '对话 ' + now, messages: [], createdAt: now, updatedAt: now };
    data.push(conv);
  }

  // 追加用户消息
  const userMsg = messages[messages.length - 1];
  if (userMsg && userMsg.role === 'user') {
    conv.messages.push(userMsg);
    if (conv.title.startsWith('对话 ') && userMsg.content) {
      conv.title = userMsg.content.slice(0, 30) + (userMsg.content.length > 30 ? '...' : '');
    }
  }

  const now = new Date();
  const weekDays = ['日','一','二','三','四','五','六'];
  const isLate = now.getHours() >= 1 && now.getHours() < 5;
  const isSchoolDay = now.getDay() >= 1 && now.getDay() <= 4;
  let suffix = `【当前时间：${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日 星期${weekDays[now.getDay()]} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}】`;
  if (isLate) suffix += isSchoolDay ? '【凌晨了，明天是上学日/工作日，必须催用户快去睡】' : '【凌晨了，必须催用户快去睡】';
  const systemPrompt = {
    role: 'system',
    content: `【背景：这是一对异地恋情侣，两人不在一起生活，主要通过聊天联系】
你是恋爱军师/红娘，帮情侣感情更好。
严重警告：绝不能说你是用户的恋人/对象！绝不能用恋人语气说话！禁止"偷偷想我""靠着我"等暧昧话。
用户敷衍(嗯/哦/啊)适当换个话题。用"你们""你俩"语气。不说自己是AI。
${suffix}`,
  };

  try {
    const apiRes = await fetch(process.env.API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.API_KEY}` },
      body: JSON.stringify({
        model: process.env.API_MODEL,
        messages: [{role:"user",content:systemPrompt.content},{role:"assistant",content:"好的，我记住了。"},...conv.messages],
          max_tokens: 300,
        temperature: 0.9,
      }),
    });

    if (!apiRes.ok) {
      const err = await apiRes.text();
      console.error('AI API error:', err);
      return res.status(502).json({ error: 'upstream error' });
    }

    const apiData = await apiRes.json();
    const reply = apiData.choices[0].message.content;
    conv.messages.push({ role: 'assistant', content: reply });
    conv.updatedAt = localTime();
    writeJSON('chat-conversations', data);

    res.json({ reply, conversationId: conv.id });
  } catch (e) {
    console.error('Proxy error:', e);
    res.status(502).json({ error: 'proxy error' });
  }
});

// ====== 静态文件服务 ======
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`💕 情侣网站已启动: http://localhost:${PORT}`);
  console.log(`📡 局域网访问: http://${getLANIP()}:${PORT}`);
});

function getLANIP() {
  const nets = require('os').networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '0.0.0.0';
}

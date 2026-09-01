const DEFAULT_TIMEOUT_MS = 30_000;
const COMPACTION_THRESHOLD = 30;

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function buildSystemPrompt({ timeline, settings, space, now = new Date() }) {
  const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
  const isLate = now.getHours() >= 1 && now.getHours() < 5;
  const isSchoolDay = now.getDay() >= 1 && now.getDay() <= 4;
  const timelineText = timeline.length ? timeline.map((item) => `${item.date} ${item.title}`).join('、') : '暂无';
  let timeNote = `【当前时间：${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 星期${weekDays[now.getDay()]} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}】`;
  if (isLate) timeNote += isSchoolDay ? '【凌晨了，明天是上学日/工作日，必须催用户快去睡】' : '【凌晨了，必须催用户快去睡】';

  const genderNote = space === 'his' ? '【当前用户是男生（男方）】' : space === 'her' ? '【当前用户是女生（女方）】' : '';
  const customInstruction = (settings.aiInstruction || '').trim();
  if (customInstruction) return `【纪念日：${timelineText}】\n${customInstruction}\n${genderNote}\n${timeNote}`;

  return `【纪念日：${timelineText}】
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

${genderNote}
${timeNote}`;
}

function getCompactedThrough(compaction, messageCount) {
  const through = Number(compaction?.through);
  if (!Number.isInteger(through) || through < 0 || through > messageCount) return 0;
  return through;
}

function shouldCompactConversation(messages, compaction) {
  return messages.length - getCompactedThrough(compaction, messages.length) >= COMPACTION_THRESHOLD;
}

async function requestCompletion(messages, { maxTokens, temperature }, provider = null) {
  const source = provider && typeof provider === 'object' ? provider : process.env;
  const endpoint = normalizeEndpoint(source.endpoint ?? source.API_ENDPOINT);
  const apiKey = normalizeApiKey(source.apiKey ?? source.API_KEY);
  const model = normalizeModel(source.model ?? source.API_MODEL);
  if (!endpoint || !apiKey || !model) throw new Error('AI 服务尚未配置');

  const timeoutMs = positiveInteger(process.env.AI_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const response = await fetch(endpoint, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
    }),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`AI 服务返回 HTTP ${response.status}: ${detail}`);
  }

  const data = await response.json();
  const reply = data?.choices?.[0]?.message?.content;
  if (typeof reply !== 'string' || !reply.trim()) throw new Error('AI 服务返回了不兼容的响应格式');
  return reply.trim();
}

// .env 中误写成 API_KEY==sk-... 或填写了完整 "Bearer sk-..." 很常见；
// 在客户端统一清理，避免把多余字符发送给服务商导致 401。
function normalizeApiKey(value) {
  if (typeof value !== 'string') return '';
  let key = value.trim();
  while (/^[='\"]/.test(key)) key = key.slice(1).trim();
  while (/[='\"]$/.test(key)) key = key.slice(0, -1).trim();
  key = key.replace(/^bearer\s+/i, '').trim();
  return key;
}

function normalizeModel(value) {
  if (typeof value !== 'string') return '';
  let model = value.trim();
  while (/^[='\"]/.test(model)) model = model.slice(1).trim();
  while (/[='\"]$/.test(model)) model = model.slice(0, -1).trim();
  return model;
}

// 兼容 .env 中常见的填写方式：允许填写完整接口、/v1 基址或仅域名，自动修正重复协议。
function normalizeEndpoint(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  let raw = value.trim().replace(/^['"]|['"]$/g, '').replace(/^\[.*\]\((https?:\/\/[^)]+)\)$/i, '$1').replace(/^https?:\/\/https?:\/\//i, 'https://');
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  try {
    const url = new URL(raw);
    let pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '');
    if (!pathname || pathname === '/v1') pathname = `${pathname}/chat/completions`;
    url.pathname = pathname;
    return url.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

async function compactConversation(previousSummary, messages, provider = null) {
  const summaryMessages = [
    {
      role: 'system',
      content: '你负责压缩情侣对话的长期记忆。提炼双方身份、关系背景、重要日期、明确偏好、事实、承诺、未完成事项和仍有价值的情绪上下文。不要编造，不要复述寒暄，使用简洁的中文要点。这个摘要会作为后续对话的内部上下文。',
    },
  ];
  if (previousSummary) summaryMessages.push({ role: 'user', content: `此前摘要：\n${previousSummary}` });
  summaryMessages.push({ role: 'user', content: '请精炼以下新增对话记录：' }, ...messages);

  return requestCompletion(summaryMessages, { maxTokens: 800, temperature: 0.2 }, provider);
}

async function requestChatReply(messages, systemPrompt, summary = '', provider = null) {
  const context = [{ role: 'system', content: systemPrompt }];
  if (summary) context.push({ role: 'system', content: `以下是此前对话的精炼摘要，请作为既有事实和上下文使用：\n${summary}` });
  context.push(...messages);
  return requestCompletion(context, { maxTokens: 300, temperature: 0.9 }, provider);
}

module.exports = { buildSystemPrompt, compactConversation, getCompactedThrough, normalizeApiKey, normalizeEndpoint, normalizeModel, requestChatReply, shouldCompactConversation };

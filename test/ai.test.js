const assert = require('assert/strict');
const test = require('node:test');
const { buildSystemPrompt, compactConversation, requestChatReply, shouldCompactConversation } = require('../services/ai');

test('AI client sends the complete conversation history', async () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };
  let request;
  process.env.API_ENDPOINT = 'https://example.test/v1/chat/completions';
  process.env.API_KEY = 'test-key';
  process.env.API_MODEL = 'test-model';
  global.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ choices: [{ message: { content: '你好' } }] }) };
  };

  try {
    const reply = await requestChatReply([
      { role: 'user', content: '第一条' },
      { role: 'assistant', content: '第二条' },
      { role: 'user', content: '第三条' },
    ], '系统提示');
    assert.equal(reply, '你好');
    const payload = JSON.parse(request.options.body);
    assert.equal(request.url, process.env.API_ENDPOINT);
    assert.equal(payload.messages.length, 4);
    assert.equal(payload.messages[1].content, '第一条');
  } finally {
    global.fetch = originalFetch;
    process.env = originalEnv;
  }
});

test('system prompt includes timeline and private-space context', () => {
  const prompt = buildSystemPrompt({
    timeline: [{ date: '2026-04-06', title: '相恋日' }],
    settings: {},
    space: 'his',
    now: new Date('2026-04-07T12:00:00'),
  });
  assert.match(prompt, /2026-04-06 相恋日/);
  assert.match(prompt, /当前用户是男生/);
});

test('conversation compaction triggers after 30 uncompressed messages and retains prior summary', async () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };
  process.env.API_ENDPOINT = 'https://example.test/v1/chat/completions';
  process.env.API_KEY = 'test-key';
  process.env.API_MODEL = 'test-model';
  let payload;
  global.fetch = async (_url, options) => {
    payload = JSON.parse(options.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: '精炼后的摘要' } }] }) };
  };

  try {
    const messages = Array.from({ length: 30 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `消息 ${index + 1}` }));
    assert.equal(shouldCompactConversation(messages, undefined), true);
    assert.equal(shouldCompactConversation(messages, { through: 1 }), false);
    const summary = await compactConversation('已有摘要', messages);
    assert.equal(summary, '精炼后的摘要');
    assert.equal(payload.max_tokens, 800);
    assert.match(payload.messages[1].content, /已有摘要/);
  } finally {
    global.fetch = originalFetch;
    process.env = originalEnv;
  }
});

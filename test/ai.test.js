const assert = require('assert/strict');
const test = require('node:test');
const { buildSystemPrompt, compactConversation, normalizeApiKey, normalizeEndpoint, normalizeModel, requestChatReply, shouldCompactConversation } = require('../services/ai');

test('AI endpoint accepts a host or repairs a duplicated protocol', () => {
  assert.equal(normalizeEndpoint('api.deepseek.com'), 'https://api.deepseek.com/chat/completions');
  assert.equal(normalizeEndpoint('https://https://us-api.example.com'), 'https://us-api.example.com/chat/completions');
  assert.equal(normalizeEndpoint('https://api.example.com/v1'), 'https://api.example.com/v1/chat/completions');
});

test('AI credentials tolerate common .env formatting mistakes', () => {
  assert.equal(normalizeApiKey('=="Bearer sk-test"'), 'sk-test');
  assert.equal(normalizeApiKey(' sk-test '), 'sk-test');
  assert.equal(normalizeModel('="deepseek-chat"'), 'deepseek-chat');
});

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

test('AI client can use a runtime provider configured outside .env', async () => {
  const originalFetch = global.fetch;
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ choices: [{ message: { content: '中转正常' } }] }) };
  };
  try {
    const reply = await requestChatReply([{ role: 'user', content: '测试' }], '系统', '', {
      endpoint: 'https://relay.example/v1',
      model: 'relay-model',
      apiKey: 'relay-key',
    });
    assert.equal(reply, '中转正常');
    assert.equal(request.url, 'https://relay.example/v1/chat/completions');
    assert.equal(request.options.headers.Authorization, 'Bearer relay-key');
    assert.equal(JSON.parse(request.options.body).model, 'relay-model');
  } finally {
    global.fetch = originalFetch;
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

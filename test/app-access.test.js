const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'love-app-'));
process.env.SITE_PASSWORD = 'test-site-password';
process.env.APP_DATA_DIR = path.join(testRoot, 'data');
process.env.APP_UPLOADS_DIR = path.join(testRoot, 'uploads');
const { app } = require('../server');

test('site gate protects APIs and prevents static data exposure', async () => {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const health = await fetch(`${baseUrl}/healthz`);
    assert.equal(health.status, 200);

    const unauthorized = await fetch(`${baseUrl}/api/settings`);
    assert.equal(unauthorized.status, 401);

    const login = await fetch(`${baseUrl}/api/access/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'test-site-password' }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/);

    const authorized = await fetch(`${baseUrl}/api/settings`, { headers: { Cookie: cookie } });
    assert.equal(authorized.status, 200);

    const initialSettings = await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        hisNickname: '男生',
        herNickname: '女生',
        hisAvatar: '🧑',
        herAvatar: '🌷',
        loveDate: '2026-04-06',
        aiInstruction: '',
      }),
    });
    assert.equal(initialSettings.status, 200);

    const updateHisAvatar = await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ hisAvatar: '👨' }),
    });
    const updatedSettings = await updateHisAvatar.json();
    assert.equal(updatedSettings.settings.hisAvatar, '👨');
    assert.equal(updatedSettings.settings.herAvatar, '🌷');

    const setDiaryPassword = await fetch(`${baseUrl}/api/diary/his/set-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ password: 'diary-test-password' }),
    });
    assert.equal(setDiaryPassword.status, 200);
    const diarySession = await setDiaryPassword.json();
    assert.ok(diarySession.token);

    const aiNoAuth = await fetch(`${baseUrl}/api/ai/provider`, { headers: { Cookie: cookie } });
    assert.equal(aiNoAuth.status, 403);
    const aiWrongPassword = await fetch(`${baseUrl}/api/ai/provider/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ password: 'wrong-password' }),
    });
    assert.equal(aiWrongPassword.status, 403);
    const aiVerify = await fetch(`${baseUrl}/api/ai/provider/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ password: 'diary-test-password' }),
    });
    assert.equal(aiVerify.status, 200);
    const aiSession = await aiVerify.json();
    const saveProvider = await fetch(`${baseUrl}/api/ai/provider`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        token: aiSession.token,
        endpoint: 'https://relay.example/v1',
        model: 'relay-model',
        apiKey: 'relay-secret-key',
      }),
    });
    assert.equal(saveProvider.status, 200);
    const provider = await saveProvider.json();
    assert.equal(provider.provider.source, 'custom');
    assert.equal(provider.provider.apiKeyMasked, 'rela••••-key');
    assert.doesNotMatch(JSON.stringify(provider), /relay-secret-key/);

    const clearProvider = await fetch(`${baseUrl}/api/ai/provider`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ token: aiSession.token, clear: true }),
    });
    assert.equal(clearProvider.status, 200);
    assert.equal((await clearProvider.json()).provider.source, 'env');

    const ordinarySettings = await fetch(`${baseUrl}/api/settings`, { headers: { Cookie: cookie } });
    assert.doesNotMatch(await ordinarySettings.text(), /relay-secret-key/);

    const addDiary = await fetch(`${baseUrl}/api/diary/his/entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        token: diarySession.token,
        content: JSON.stringify({ text: '测试日记', images: [], audio: [] }),
        time: '2026-09-01 20:30',
      }),
    });
    assert.equal(addDiary.status, 200);
    const diaryEntry = await addDiary.json();
    assert.ok(diaryEntry.id);

    const diaryList = await fetch(`${baseUrl}/api/diary/his/entries?token=${diarySession.token}`, { headers: { Cookie: cookie } });
    assert.equal(diaryList.status, 200);
    const entries = await diaryList.json();
    assert.equal(entries[0].content, JSON.stringify({ text: '测试日记', images: [], audio: [] }));

    const malformed = await fetch(`${baseUrl}/api/diary/his/entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: '{',
    });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error, '请求数据格式无效');

    const dataPath = await fetch(`${baseUrl}/data/passwords.json`);
    assert.match(dataPath.headers.get('content-type'), /^text\/html/i);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    fs.rmSync(testRoot, { recursive: true, force: true });
  }
});

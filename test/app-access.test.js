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

    const dataPath = await fetch(`${baseUrl}/data/passwords.json`);
    assert.match(dataPath.headers.get('content-type'), /^text\/html/i);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    fs.rmSync(testRoot, { recursive: true, force: true });
  }
});

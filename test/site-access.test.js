const assert = require('assert/strict');
const test = require('node:test');
const { createSiteAccess } = require('../lib/site-access');

test('site access issues and validates a signed HTTP-only cookie', () => {
  const access = createSiteAccess('a-long-private-password');
  const headers = {};
  const response = { setHeader(name, value) { headers[name] = value; } };

  assert.equal(access.verifyPassword('wrong-password'), false);
  assert.equal(access.verifyPassword('a-long-private-password'), true);
  access.setAccessCookie({ secure: false }, response);
  assert.match(headers['Set-Cookie'], /HttpOnly/);
  assert.match(headers['Set-Cookie'], /SameSite=Strict/);
  assert.equal(access.hasAccess({ headers: { cookie: headers['Set-Cookie'] } }), true);
});

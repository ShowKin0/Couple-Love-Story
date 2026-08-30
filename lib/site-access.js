const crypto = require('crypto');

const COOKIE_NAME = 'love_site_access';
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

function parseCookies(cookieHeader = '') {
  return Object.fromEntries(cookieHeader.split(';').map((item) => {
    const index = item.indexOf('=');
    if (index === -1) return ['', ''];
    return [item.slice(0, index).trim(), decodeURIComponent(item.slice(index + 1).trim())];
  }).filter(([name]) => name));
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left || '');
  const rightBuffer = Buffer.from(right || '');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createSiteAccess(password) {
  function sign(payload) {
    return crypto.createHmac('sha256', password).update(payload).digest('base64url');
  }

  function createToken() {
    const payload = `${Date.now()}.${crypto.randomBytes(24).toString('base64url')}`;
    return `${payload}.${sign(payload)}`;
  }

  function isValidToken(token) {
    if (!password || !token) return false;
    const parts = token.split('.');
    if (parts.length !== 3) return false;

    const [issuedAt, nonce, signature] = parts;
    const payload = `${issuedAt}.${nonce}`;
    const timestamp = Number(issuedAt);
    if (!Number.isFinite(timestamp) || Date.now() - timestamp > SESSION_MAX_AGE_SECONDS * 1000) return false;
    return safeEqual(signature, sign(payload));
  }

  function hasAccess(req) {
    return isValidToken(parseCookies(req.headers.cookie)[COOKIE_NAME]);
  }

  function setAccessCookie(req, res) {
    const attributes = [
      `${COOKIE_NAME}=${encodeURIComponent(createToken())}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Strict',
      `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    ];
    if (req.secure) attributes.push('Secure');
    res.setHeader('Set-Cookie', attributes.join('; '));
  }

  function clearAccessCookie(res) {
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
  }

  function verifyPassword(candidate) {
    return Boolean(password) && typeof candidate === 'string' && safeEqual(candidate, password);
  }

  function requireAccess(req, res, next) {
    if (!password) return res.status(503).json({ error: '未配置 SITE_PASSWORD' });
    if (!hasAccess(req)) return res.status(401).json({ error: '需要站点访问密码' });
    next();
  }

  return { clearAccessCookie, hasAccess, requireAccess, setAccessCookie, verifyPassword };
}

module.exports = { createSiteAccess };

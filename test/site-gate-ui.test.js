const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const projectRoot = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(projectRoot, 'index.css'), 'utf8');

test('site access gate remains hidden until site access is enabled', () => {
  assert.match(html, /id="siteAccessGate"\s+hidden/);
  assert.match(css, /\.site-access-gate\[hidden\]\s*\{[^}]*display:\s*none\s*!important;/s);
});

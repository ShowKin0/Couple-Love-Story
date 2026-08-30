const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const projectRoot = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(projectRoot, 'index.css'), 'utf8');

test('mobile layout provides an app tab bar and safe-area support', () => {
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /<nav class="app-tabbar" aria-label="应用导航">/);
  assert.equal((html.match(/class="app-tab-item"/g) || []).length, 6);
  assert.match(css, /\.app-tabbar\s*\{\s*position:\s*fixed;/s);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /\.navbar\s*\{\s*display:\s*none;/s);
});

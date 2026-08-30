const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const rootDir = path.join(__dirname, '..');

test('love-story labels consistently render his name before her name', () => {
  const script = fs.readFileSync(path.join(rootDir, 'index.js'), 'utf8');
  const html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');

  assert.match(script, /s\.hisNickname}\和\$\{s\.herNickname\}的爱情故事/);
  assert.doesNotMatch(script, /s\.herNickname}\和\$\{s\.hisNickname\}的爱情故事/);
  assert.match(html, /男生和女生的爱情故事/);
  assert.doesNotMatch(html, /女生和男生的爱情故事/);
});

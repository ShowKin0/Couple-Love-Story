const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { createStorage } = require('../lib/storage');

test('storage atomically persists and reads JSON', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'love-storage-'));
  try {
    const storage = createStorage(dataDir);
    storage.writeJSON('settings', { loveDate: '2026-04-06' });
    assert.deepEqual(storage.readJSON('settings'), { loveDate: '2026-04-06' });
    assert.equal(fs.readdirSync(dataDir).some((name) => name.endsWith('.tmp')), false);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

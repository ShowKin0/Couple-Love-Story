const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function createStorage(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });

  function getPath(name) {
    return path.join(dataDir, `${name}.json`);
  }

  function readJSON(name) {
    const filePath = getPath(name);
    if (!fs.existsSync(filePath)) return null;

    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
      console.error(`Unable to read ${name}.json:`, error.message);
      return null;
    }
  }

  function writeJSON(name, data) {
    const filePath = getPath(name);
    const tempPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempPath, filePath);
  }

  return { readJSON, writeJSON };
}

module.exports = { createStorage };

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const original = fs.rmSync;
const allowed = /^gryt-(voiceswitch|voicejoin|voiceroom|voice-speak|livecaps|voice-recovery)-/;
fs.rmSync = function(target, options) {
  const absolute = path.resolve(String(target));
  if (process.platform === 'win32' && path.dirname(absolute).toLowerCase() === path.resolve(os.tmpdir()).toLowerCase() && allowed.test(path.basename(absolute))) {
    try {
      const db = require('../src/db/sqlite/connection').getSqliteDb();
      const file = db.prepare('PRAGMA database_list').all().find(row => row.name === 'main')?.file;
      if (file && path.dirname(path.resolve(file)).toLowerCase() === absolute.toLowerCase()) db.close();
    } catch (error) {
      if (!String(error.message).includes('SQLite not initialized')) throw error;
    }
  }
  return original.call(fs, target, options);
};

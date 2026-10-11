const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const caddy = fs.readFileSync(path.join(__dirname, 'Caddyfile.voice-landing.reviewed'), 'utf8');
function extract(name) { const match = caddy.match(new RegExp('header_regexp ' + name + ' [^`]+`([^`]+)`')); assert(match, name); return new RegExp(match[1].replace(/^\(\?i\)/, ''), 'i'); }
const html = extract('htmlAccept'), disabled = extract('htmlDisabled'), upgrade = extract('connUpgrade');
const baseline = { method: 'GET', path: '/', query: '', dest: 'document', mode: 'navigate', accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', connection: '', upgrade: '' };
const landing = request => ['GET', 'HEAD'].includes(request.method) && request.path === '/' && request.query === '' && request.dest === 'document' && request.mode === 'navigate' && html.test(request.accept) && !disabled.test(request.accept) && !request.upgrade && !upgrade.test(request.connection);
const cases = [
  ['browser navigation', {}, true], ['browser HEAD', { method: 'HEAD' }, true],
  ['positive HTML weight', { accept: 'text/html;q=0.5' }, true],
  ['HTML rejected', { accept: 'text/html;q=0' }, false], ['HTML rejected decimal', { accept: 'text/html;q=0.00,*/*' }, false],
  ['API discovery', { path: '/info' }, false], ['API', { path: '/api/server' }, false],
  ['Socket.IO polling', { path: '/socket.io/', query: 'EIO=4&transport=polling' }, false],
  ['Socket.IO upgrade', { path: '/socket.io/', upgrade: 'websocket' }, false],
  ['root upgrade', { upgrade: 'websocket' }, false], ['upgrade connection', { connection: 'keep-alive, Upgrade' }, false],
  ['root query', { query: 'probe=1' }, false], ['POST root', { method: 'POST' }, false],
  ['preflight', { method: 'OPTIONS' }, false], ['fetch root', { dest: 'empty', mode: 'cors' }, false],
  ['curl root', { dest: '', mode: '', accept: '*/*' }, false],
  ['missing fetch metadata', { dest: '', mode: '' }, false], ['unknown path', { path: '/unknown' }, false]
];
for (const [name, changes, expected] of cases) assert.equal(landing({ ...baseline, ...changes }), expected, name);
console.log(`PASS ${cases.length} route scenarios against candidate regexes (pure model, not live Caddy routing)`);

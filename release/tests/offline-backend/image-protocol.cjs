'use strict';
// Runs only inside the reviewed network=none image. All identities/data are synthetic.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const {DatabaseSync} = require('node:sqlite');
const jose = require('/app/node_modules/jose');
const jwt = require('/app/node_modules/jsonwebtoken');
const WebSocket = require('/app/node_modules/ws');
const BUNDLE_SHA = '8181b0834bcb93937b567939f69b26e8719a15e2785f9fd5ea3be955dade3fe5';
const checks = [], exits = [], liveSockets = new Set();
const secret = crypto.randomBytes(32).toString('hex'); // Ephemeral test-only; never exported.
const base = '/data/original', candidate = '/data/candidate', rollback = '/data/restored';
let child;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const check = (name, fn) => {fn(); checks.push(name);};
const dbAt = dir => new DatabaseSync(path.join(dir, 'gryt.db'));
const markers = db => db.prepare('SELECT key,value FROM schema_meta ORDER BY key').all();
const config = db => db.prepare('SELECT owner_gryt_user_id,sfu_secret,token_version,display_name,discoverable,is_configured FROM server_config').get();
function checkpoint(dir) {
  const db = dbAt(dir);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.close();
}
function files(dir, prefix = '') {
  return fs.readdirSync(dir, {withFileTypes:true}).flatMap(item => {
    const rel = path.join(prefix, item.name), abs = path.join(dir, item.name);
    assert.equal(item.isSymbolicLink(), false, 'Fixture must not have symlinks');
    return item.isDirectory() ? files(abs, rel) : [{path:rel, sha256:sha(abs)}];
  }).sort((a,b) => a.path.localeCompare(b.path));
}
async function stop() {
  for (const socket of liveSockets) socket.close();
  liveSockets.clear();
  if (!child) return;
  const running = child;
  running.kill('SIGTERM');
  const stopped = await Promise.race([running.done, delay(5000).then(() => {throw Error('Owned backend failed bounded TERM');})]);
  assert.equal(stopped.code, 0, 'Backend TERM must exit0');
  assert.equal(stopped.signal, null);
  exits.push(stopped);
  child = undefined;
}
async function start(dir, allowLocal = true) {
  assert.equal(child, undefined);
  const env = {PATH:process.env.PATH, NODE_ENV:'production', JWT_SECRET:secret, DATA_DIR:dir,
    HOST:'127.0.0.1', PORT:'5000', METRICS_PORT:'0', DISABLE_S3:'true', SERVER_DISCOVERABLE:'false',
    SERVER_NAME:'SYNTHETIC-OFFLINE-PROTOCOL', SERVER_INSTANCE_ID:'synthetic-only',
    SERVER_VERSION:'1.0.76-laokuai.hybrid.85ec3b9c', VOICE_HYBRID_ENABLED:'true', UV_THREADPOOL_SIZE:'2'};
  if (allowLocal) env.GRYT_IDENTITY_TIERS = 'account,local';
  const running = spawn(process.execPath, ['/app/bundle.js'], {cwd:'/app', env, stdio:['ignore','pipe','pipe']});
  child = running;
  let log = '';
  for (const stream of [running.stdout,running.stderr]) stream.on('data', data => {log = (log + data).slice(-32768);});
  running.done = new Promise(resolve => running.once('exit', (code,signal) => resolve({code,signal})));
  const deadline = Date.now()+15000;
  while (Date.now()<deadline) {
    if (running.exitCode !== null) throw Error('Exact bundle exited before health; FATAL-placeholder='+log.includes('JWT_SECRET is the default placeholder'));
    try {const response = await fetch('http://127.0.0.1:5000/health', {signal:AbortSignal.timeout(500)});
      if (response.ok && (await response.json()).status === 'healthy') {await delay(100);return;}
    } catch {}
    await delay(100);
  }
  throw Error('Exact bundle health deadline');
}
async function connect() {
  const socket = new WebSocket('ws://127.0.0.1:5000/socket.io/?EIO=4&transport=websocket');
  liveSockets.add(socket);
  const events = [];
  let connected = false;
  socket.on('message', data => {
    const packet = data.toString();
    if (packet[0] === '0') socket.send('40');
    else if (packet === '2') socket.send('3');
    else if (packet.startsWith('40')) connected = true;
    else if (packet.startsWith('42')) {const [event,payload] = JSON.parse(packet.slice(2));events.push({event,payload});}
  });
  let transportError;
  socket.on('error', error => {transportError = error;});
  async function wait(event, from = 0) {
    const deadline = Date.now()+5000;
    while (Date.now()<deadline) {
      if (transportError) throw Error('Loopback websocket transport error');
      const result = events.slice(from).find(item => item.event === event);
      if (result) return result.payload;
      await delay(10);
    }
    throw Error('Missing actual Socket.IO event: '+event);
  }
  const deadline = Date.now()+5000;
  while (!connected && Date.now()<deadline) {if(transportError) throw transportError;await delay(10);}
  assert.equal(connected, true, 'Actual Engine.IO/Socket.IO handshake');
  return {socket, events, wait, send(event,payload){socket.send('42'+JSON.stringify([event,payload]));},
    close(){socket.close();liveSockets.delete(socket);}};
}
async function main() {
  assert.equal(process.getuid(), 1001);
  assert.equal(sha('/app/bundle.js'), BUNDLE_SHA, 'Immutable image bundle SHA');
  assert.deepEqual(fs.readdirSync('/data'), [], 'Only fresh container tmpfs allowed');
  const keys = await jose.generateKeyPair('ES256', {extractable:true});
  const jwk = await jose.exportJWK(keys.publicKey);
  const thumb = await jose.calculateJwkThumbprint(jwk, 'sha256');
  const memberId = 'synthetic-existing-member', grytId = 'key:'+thumb;
  const certificate = await new jose.SignJWT({jwk}).setProtectedHeader({alg:'ES256',typ:'JWT'})
    .setIssuer('gryt:self').setSubject('ignored').setIssuedAt().setExpirationTime('24h').sign(keys.privateKey);
  fs.mkdirSync(base);
  await start(base);
  checks.push('Exact production bundle healthy with ephemeral synthetic JWT, UID1001');
  await stop();
  let db = dbAt(base);
  const now = new Date().toISOString(), future = new Date(Date.now()+3600000).toISOString();
  db.prepare('UPDATE server_config SET owner_gryt_user_id=?,sfu_secret=?,token_version=7,is_configured=1,display_name=?,discoverable=0').run('synthetic-existing-owner','synthetic-only-sfu-key','Preserved synthetic community');
  db.prepare('INSERT INTO users (gryt_user_id,server_user_id,nickname,created_at,last_seen) VALUES (?,?,?,?,?)').run(grytId,memberId,'Synthetic member',now,now);
  db.prepare('INSERT INTO roles (server_user_id,role,created_at,updated_at) VALUES (?,?,?,?)').run(memberId,'member',now,now);
  for (const [id,expires,revoked] of [['synthetic-prior-refresh',future,0],['synthetic-expired-refresh','2000-01-01T00:00:00.000Z',0],['synthetic-revoked-refresh',future,1]])
    db.prepare('INSERT INTO refresh_tokens (token_id,gryt_user_id,server_user_id,created_at,expires_at,revoked) VALUES (?,?,?,?,?,?)').run(id,grytId,memberId,now,expires,revoked);
  const originalConfig = config(db), originalMarkers = markers(db);
  assert.equal(originalMarkers.find(row => row.key==='permission_schema_version').value, '10');
  db.close();checkpoint(base);
  const originalFiles = files(base);
  fs.cpSync(base, candidate, {recursive:true,errorOnExist:true,force:false});
  check('Stopped consistent synthetic baseline copied byte-for-byte', () => assert.deepEqual(files(candidate),originalFiles));
  await start(candidate);
  db = dbAt(candidate);
  check('Candidate init preserves owner/SFU key/tokenVersion/config/markers', () => {
    assert.deepEqual(config(db), originalConfig);assert.deepEqual(markers(db), originalMarkers);
    assert.equal(db.prepare('SELECT role FROM roles WHERE server_user_id=?').get(memberId).role, 'member');
    assert.equal(db.prepare('SELECT revoked FROM refresh_tokens WHERE token_id=?').get('synthetic-prior-refresh').revoked, 0);
  });
  db.close();
  const client = await connect();
  client.send('server:join', {nickname:'Synthetic member'});
  const challenge = await client.wait('server:challenge');
  const assertion = await new jose.SignJWT({nonce:challenge.nonce}).setProtectedHeader({alg:'ES256',typ:'JWT'})
    .setSubject(grytId).setAudience(challenge.serverHost).setIssuedAt().setExpirationTime('60s').sign(keys.privateKey);
  client.send('server:verify', {certificate, assertion});
  const joined = await client.wait('server:joined');
  const claims = token => jwt.verify(token, secret);
  check('Actual legacy wire join keeps prior member ID and tokenVersion7', () => {
    assert.equal(claims(joined.accessToken).serverUserId,memberId);
    assert.equal(claims(joined.accessToken).tokenVersion,7);assert.ok(joined.refreshToken);
  });
  async function refresh(payload, event='token:refreshed', target=client) {
    const from = target.events.length;target.send('token:refresh',payload);return target.wait(event,from);
  }
  const renewed = await refresh({refreshToken:joined.refreshToken});
  check('Actual refresh-token branch returns signed access/file tokens', () => {
    assert.equal(claims(renewed.accessToken).serverUserId,memberId);
    assert.equal(claims(renewed.fileToken).scope,'file');assert.ok(renewed.fileKey);
  });
  const accessRenewed = await refresh({accessToken:renewed.accessToken});
  check('Actual access-token branch preserves token version', () => assert.equal(claims(accessRenewed.accessToken).tokenVersion,7));
  const oldClaims = {grytUserId:grytId,serverUserId:memberId,nickname:'Synthetic member',serverHost:'127.0.0.1:5000',tokenVersion:7};
  const legacyAccess = jwt.sign(oldClaims,secret,{expiresIn:'15m'});
  await refresh({accessToken:legacyAccess});checks.push('Legacy access token without userTokenVersion still refreshes');
  const reconnect = await connect();
  await refresh({refreshToken:'synthetic-prior-refresh'},'token:refreshed',reconnect);
  checks.push('Fresh socket resumes with pre-copy refresh token');reconnect.close();
  for (const [id,expected] of [['not-a-real-token','refresh_token_invalid'],['synthetic-expired-refresh','refresh_token_expired'],['synthetic-revoked-refresh','refresh_token_invalid']]) {
    const error = await refresh({refreshToken:id},'token:error');
    check('Reject '+id, () => assert.equal(error.error,expected));
  }
  const revoked = await refresh({accessToken:jwt.sign({...oldClaims,tokenVersion:6},secret,{expiresIn:'15m'})},'token:revoked');
  check('Stale server-wide access-token version rejected', () => assert.equal(revoked.reason,'token_version_mismatch'));
  const wrongHost = await refresh({accessToken:jwt.sign({...oldClaims,serverHost:'wrong.synthetic.invalid'},secret,{expiresIn:'15m'})},'token:error');
  check('Wrong-host access-token refresh rejected', () => assert.equal(wrongHost,'Invalid access token for this server'));
  const bad = await connect();bad.send('server:join',{nickname:'Synthetic member'});
  const badChallenge = await bad.wait('server:challenge');
  const badAssertion = await new jose.SignJWT({nonce:'wrong-nonce'}).setProtectedHeader({alg:'ES256',typ:'JWT'})
    .setSubject(grytId).setAudience(badChallenge.serverHost).setIssuedAt().setExpirationTime('60s').sign(keys.privateKey);
  bad.send('server:verify',{certificate,assertion:badAssertion});
  const badResult = await bad.wait('server:error');
  check('Wrong nonce rejected by real bundled handler', () => {assert.equal(badResult.error,'identity_verification_failed');assert.equal(bad.events.some(event=>event.event==='server:joined'),false);});
  bad.close();client.close();await stop();checkpoint(candidate);
  check('Original synthetic rollback directory never modified by candidate', () => assert.deepEqual(files(base),originalFiles));
  fs.cpSync(base,rollback,{recursive:true,errorOnExist:true,force:false});
  check('Restored pre-trial snapshot byte-for-byte', () => assert.deepEqual(files(rollback),originalFiles));
  await start(rollback);
  const restored = await connect();
  const resumed = await refresh({refreshToken:'synthetic-prior-refresh'},'token:refreshed',restored);
  check('Restored data resumes original token on exact candidate bundle', () => assert.equal(claims(resumed.accessToken).serverUserId,memberId));
  const missingAfterRestore = await refresh({refreshToken:joined.refreshToken},'token:error',restored);
  check('Candidate-only refresh token absent after snapshot restoration', () => assert.equal(missingAfterRestore.error,'refresh_token_invalid'));
  restored.close();await stop();checkpoint(rollback);
  await start(rollback,false);
  const defaultPolicy = await connect();defaultPolicy.send('server:join',{nickname:'Synthetic member'});
  const defaultChallenge = await defaultPolicy.wait('server:challenge');
  const defaultAssertion = await new jose.SignJWT({nonce:defaultChallenge.nonce}).setProtectedHeader({alg:'ES256',typ:'JWT'})
    .setSubject(grytId).setAudience(defaultChallenge.serverHost).setIssuedAt().setExpirationTime('60s').sign(keys.privateKey);
  defaultPolicy.send('server:verify',{certificate,assertion:defaultAssertion});
  await defaultPolicy.wait('server:error');
  check('Default account policy does not admit test local certificate', () => assert.equal(defaultPolicy.events.some(event=>event.event==='server:joined'),false));
  defaultPolicy.close();await stop();
  check('All backend runs stop with TERM exit0', () => {assert.equal(exits.length,4);assert.ok(exits.every(exit=>exit.code===0&&exit.signal===null));});
  console.log(JSON.stringify({passed:true,checks,backendExits:exits,node:process.versions.node,sqlite:process.versions.sqlite,
    bundleSha256:BUNDLE_SHA,syntheticOnly:true,network:'container-none-loopback-only',hostListeners:false,
    productionNodeEnv:true,realAccountOrCredentials:false,externalAccountCaE2e:false,oldBinaryRollbackTested:false,
    dataRollback:'Pre-trial synthetic snapshot restored and resumed on same exact candidate image',
    originalRollbackBytesUnchanged:true,sourceOrImageModified:false}));
}
const watchdog = setTimeout(() => {if(child) child.kill('SIGTERM');console.error('fixture_watchdog');process.exit(2);},90000);
main().catch(async error => {
  console.error(JSON.stringify({passed:false,error:String(error.message),stack:error.stack?.split('\n').slice(0,5),checks}));
  try {await stop();} catch {if(child) child.kill('SIGKILL');}
  process.exitCode = 1;
}).finally(() => clearTimeout(watchdog));

// The actual signaling connector under deterministic browser-operation seams.
// All WebSockets/RTCPeerConnections and time are in-memory; nothing listens.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(process.argv[2] ?? new URL('../../../', import.meta.url).pathname);
const source = fs.readFileSync(path.join(root, 'components/voice/src/webrtc/hooks/sfuConnection.ts'), 'utf8');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const offer = suffix => ({ type: 'offer', sdp: `v=0\r\ns=${suffix}\r\n` });

function harness({ hold = 'remote', codec = false } = {}) {
  const timers = new Map(), sockets = [], gate = deferred();
  let timerId = 0, dispose, abnormal = 0, joined = 0, codecStates = 0;
  const quiet = new Proxy({}, { get: () => () => {} });
  const setTimer = fn => { const id = ++timerId; timers.set(id, fn); return id; };
  class Socket {
    static OPEN = 1; static CONNECTING = 0;
    constructor() { this.readyState = 1; this.sent = []; sockets.push(this); }
    send(text) { this.sent.push(JSON.parse(text)); }
    close() { this.readyState = 3; }
    message(event, data) { this.onmessage?.({ data: JSON.stringify({ event, data: JSON.stringify(data) }) }); }
  }
  class Peer {
    constructor(name) {
      this.name = name; this.connectionState = 'connected'; this.signalingState = 'stable';
      this.calls = []; this.remoteDescription = null; this.localDescription = null;
    }
    async operation(phase, value) {
      this.calls.push([phase, value]);
      if (this.name === 'a' && phase === hold && this.calls.filter(x => x[0] === phase).length === 1) await gate.promise;
    }
    async setRemoteDescription(value) { await this.operation('remote', value); this.remoteDescription = value; }
    async createAnswer() { await this.operation('answer'); return { type: 'answer', sdp: 'v=0\r\n' }; }
    async setLocalDescription(value) { await this.operation('local', value); this.localDescription = value; }
    addIceCandidate(value) { this.calls.push(['candidate', value]); return Promise.resolve(); }
    getTransceivers() { return []; }
    close() { this.connectionState = 'closed'; this.signalingState = 'closed'; }
  }
  const a = new Peer('a'), b = new Peer('b');
  const refs = { peerConnectionRef: { current: a }, sfuWebSocketRef: { current: null },
    isDisconnectingRef: { current: false } };
  const deps = {
    '../../shared/mediaPolicy': { applyPeerMediaPolicy() {}, isAudioOnly: () => true, restrictMediaSdp: text => text },
    './videoDemand': { parseVideoWanted: () => null },
    './voiceLogger': { voiceLog: quiet },
    './microphoneCodec': {
      applyLocalMicrophoneCodecSdp: (_pc, _senders, sdp) => sdp,
      applyMicrophoneCodec: async pc => { await pc.operation('codec'); return { status: 'active' }; },
    },
  };
  const exports = {};
  const compiled = ts.transpileModule(source, { reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
  assert.ok(!compiled.diagnostics.some(d => d.category === ts.DiagnosticCategory.Error));
  vm.runInNewContext(compiled.outputText, { exports, console: quiet, WebSocket: Socket,
    RTCSessionDescription: class { constructor(value) { Object.assign(this, value); } },
    RTCIceCandidate: class { constructor(value) { Object.assign(this, value); } },
    setTimeout: setTimer, setInterval: setTimer, clearTimeout: id => timers.delete(id), clearInterval: id => timers.delete(id),
    require: key => { assert.ok(Object.hasOwn(deps, key), key); return deps[key]; },
  });
  const connecting = exports.connectToSfuWebSocket('ws://fake.invalid', { room_id: 'a' }, refs, false, {
    onDisposeAvailable: callback => { dispose = callback; },
    onRoomJoined: () => { joined++; }, onAbnormalClose: () => { abnormal++; },
    microphoneCodec: codec ? { mode: 'test' } : undefined,
    onMicrophoneCodecState: () => { codecStates++; },
  });
  const ws = sockets[0]; ws.onopen(); ws.message('room_joined', {});
  refs.sfuWebSocketRef.current = ws;
  return { a, b, refs, ws, gate, timers, connecting, dispose: () => dispose(),
    get abnormal() { return abnormal; }, get joined() { return joined; }, get codecStates() { return codecStates; } };
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
for (const completion of ['resolve', 'reject']) {
  test(`Retired ${completion} of room A offer cannot drain its queued offer into B`, async () => {
    const h = harness(); await h.connecting;
    h.ws.message('offer', offer('a-active')); h.ws.message('offer', offer('a-queued'));
    await flush(); h.dispose(); h.a.close(); h.refs.peerConnectionRef.current = h.b;
    h.refs.sfuWebSocketRef.current = { readyState: 1 };
    h.gate[completion](completion === 'reject' ? new Error('closed operation') : undefined);
    await flush();
    assert.equal(h.b.calls.length, 0, 'retired room A offer touched room B PC');
    assert.equal(h.timers.size, 0); assert.equal(h.refs.peerConnectionRef.current, h.b);
  });
}
for (const hold of ['remote', 'answer', 'local', 'codec']) {
  test(`Disposal while ${hold} is pending retires its continuation even before owner closes PC`, async () => {
    const h = harness({ hold, codec: hold === 'codec' }); await h.connecting;
    h.ws.message('offer', offer('active')); h.ws.message('offer', offer('queued'));
    await flush(); const calls = h.a.calls.length;
    h.dispose(); h.gate.resolve(); await flush();
    assert.equal(h.a.calls.length, calls, 'disposed connector scheduled another PC operation');
    assert.equal(h.codecStates, 0); assert.equal(h.timers.size, 0);
    assert.equal(h.ws.sent.filter(x => x.event === 'answer').length, 0);
  });
}
test('An old captured socket message callback cannot add candidates or offers to B', async () => {
  const h = harness(); await h.connecting; const callback = h.ws.onmessage;
  h.dispose(); h.refs.peerConnectionRef.current = h.b; h.b.remoteDescription = offer('b');
  for (const [event, data] of [['candidate', { candidate: 'old-a' }], ['offer', offer('old-a')], ['room_joined', {}]]) {
    callback({ data: JSON.stringify({ event, data: JSON.stringify(data) }) });
  }
  await flush(); assert.equal(h.b.calls.length, 0); assert.equal(h.joined, 1);
  assert.equal(h.timers.size, 0);
});
test('A connector cannot adopt a replacement PC without explicit disposal', async () => {
  const h = harness(); await h.connecting; h.refs.peerConnectionRef.current = h.b;
  h.ws.message('offer', offer('old-a')); await flush();
  assert.equal(h.b.calls.length, 0); h.dispose();
});
test('Current-room queued offers still serialize and answer normally', async () => {
  const h = harness(); await h.connecting;
  h.ws.message('offer', offer('one')); h.ws.message('offer', offer('two'));
  h.gate.resolve(); await flush();
  assert.equal(h.a.calls.filter(x => x[0] === 'remote').length, 2);
  assert.equal(h.ws.sent.filter(x => x.event === 'answer').length, 2); h.dispose();
  assert.equal(h.timers.size, 0);
});
test('Current abnormal close is reported once and disposes the queue', async () => {
  const h = harness(); await h.connecting; h.ws.message('offer', offer('one')); h.ws.message('offer', offer('two'));
  const close = h.ws.onclose; close({ code: 1006, reason: '', wasClean: false });
  const calls = h.a.calls.length; h.gate.resolve(); await flush();
  assert.equal(h.abnormal, 1); assert.equal(h.a.calls.length, calls);
  assert.equal(h.timers.size, 0);
});
const results = [];
for (const { name, fn } of tests) {
  try { await fn(); results.push({ name, passed: true }); console.log('PASS ' + name); }
  catch (error) { results.push({ name, passed: false, error: error.message }); console.log('FAIL ' + name + ': ' + error.message); }
}
console.log(JSON.stringify({ sourceRoot: root, checks: results.length,
  passed: results.filter(x => x.passed).length, results }, null, 2));
if (results.some(x => !x.passed)) process.exitCode = 1;

import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root = path.resolve(process.argv[2] ?? new URL('../../../', import.meta.url).pathname);
const sdk = path.join(root, 'components/voice');
const { advance, fakePhonePlatform, fakeRoom, log, mountEngine, settle, voiceConfig, FakeSocket } = await import(pathToFileURL(path.join(sdk, 'scripts/engine-harness.mjs')));
const { VoiceConfigProvider } = await import(pathToFileURL(path.join(sdk, 'dist/config/index.js')));
const { setVoicePlatform } = await import(pathToFileURL(path.join(sdk, 'dist/platform/index.js')));
const { VoiceSingletonHooks } = await import(pathToFileURL(path.join(sdk, 'dist/shared/SingletonHooks.js')));
const { useSFU } = await import(pathToFileURL(path.join(sdk, 'dist/webrtc/hooks/useSFU.js')));
const phone = fakePhonePlatform(), room = fakeRoom('server-a'); setVoicePlatform(phone);
const engine = await mountEngine({ provider: VoiceConfigProvider, runner: VoiceSingletonHooks, read: () => useSFU(),
  config: voiceConfig({ stunHosts: ['stun:fixture.test'] }), target: { id: 'server-a', room } });
try {
  let a; await settle(() => { a = engine.current.connect('room-a'); }); await advance(1000); await a;
  const oldPc = phone.peers.at(-1), oldWs = FakeSocket.all.at(-1);
  await settle(() => oldPc.reach('connecting'));
  assert.equal(engine.current.connectionState, 'connecting');
  let b; await settle(() => { b = engine.current.connect('room-b'); }); await advance(1000); await b;
  const newPc = phone.peers.at(-1), newWs = FakeSocket.all.at(-1);
  assert.notEqual(newPc, oldPc); assert.notEqual(newWs, oldWs);
  const result = { sourceRoot: root, oldPcState: oldPc.connectionState, oldWsState: oldWs.readyState,
    newPcState: newPc.connectionState, currentRoom: engine.current.currentChannelConnected,
    stateBeforeOldEvent: engine.current.connectionState };
  // The old PC may legitimately finish ICE later only if the owner left it live.
  if (oldPc.connectionState !== 'closed') await settle(() => oldPc.reach('connected'));
  result.stateAfterOldEvent = engine.current.connectionState;
  log(JSON.stringify(result, null, 2));
  assert.equal(result.oldPcState, 'closed', 'signaling-complete room A PC survived switching to B');
  assert.equal(result.oldWsState, FakeSocket.CLOSED, 'old signaling connector was orphaned');
  assert.equal(result.stateAfterOldEvent, result.stateBeforeOldEvent, 'old PC falsely settled current room status');
  log('PASS a room switch retires the earlier transport while ICE is still connecting');
} finally { await engine.unmount(); }

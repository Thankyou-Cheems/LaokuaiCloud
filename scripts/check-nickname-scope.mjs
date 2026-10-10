import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { nicknameFailureKey, planNicknameUpdate, requestNicknameUpdate } from '../src/packages/settings/src/utils/nicknameScope.ts';

const known = ['fixture-a.invalid', 'fixture-b.invalid'];
function fixture() {
  return { default: 'Fixture D', servers: { [known[0]]: 'Fixture A', [known[1]]: 'Fixture B' }, avatar: 'fixture-avatar' };
}
function applyPlan(state, plan) {
  if (plan.updateDefault) state.default = plan.nickname;
  for (const host of plan.hosts) state.servers[host] = plan.nickname;
}
class FakeSocket extends EventEmitter {
  connected = true;
  sent = [];
  throwOnSend = false;
  emit(event, payload) {
    if (event === 'profile:update') {
      if (this.throwOnSend) throw Error('fixture transport failure');
      this.sent.push({ event, payload });
      return true;
    }
    return super.emit(event, payload);
  }
}
function clean(socket) {
  assert.equal(socket.listenerCount('profile:updated'), 0);
  assert.equal(socket.listenerCount('disconnect'), 0);
  assert.equal(socket.listenerCount('profile:error'), 0);
}

test('D/A/B: editing A does not change D, B, or avatar', () => {
  const state = fixture();
  applyPlan(state, planNicknameUpdate('Fixture A2', { kind: 'server', host: known[0] }, known));
  assert.deepEqual(state, { default: 'Fixture D', servers: { [known[0]]: 'Fixture A2', [known[1]]: 'Fixture B' }, avatar: 'fixture-avatar' });
});
test('D/A/B: editing D does not change A, B, or avatar', () => {
  const state = fixture();
  applyPlan(state, planNicknameUpdate('Fixture D2', { kind: 'default' }, known));
  assert.deepEqual(state, { default: 'Fixture D2', servers: { [known[0]]: 'Fixture A', [known[1]]: 'Fixture B' }, avatar: 'fixture-avatar' });
});
test('only explicit all-servers batches A and B; default stays separate', () => {
  const state = fixture();
  applyPlan(state, planNicknameUpdate('Fixture All', { kind: 'all-servers' }, known));
  assert.deepEqual(state, { default: 'Fixture D', servers: { [known[0]]: 'Fixture All', [known[1]]: 'Fixture All' }, avatar: 'fixture-avatar' });
});
test('planner validates names and hosts, deduplicates without mutating input', () => {
  assert.throws(() => planNicknameUpdate('  ', { kind: 'default' }, known));
  assert.throws(() => planNicknameUpdate('X', { kind: 'server', host: 'unjoined.invalid' }, known));
  assert.equal(planNicknameUpdate('  '+ 'x'.repeat(30), { kind: 'default' }, []).nickname.length, 20);
  const hosts = Object.freeze([...known, known[0]]);
  assert.deepEqual(planNicknameUpdate('X', { kind: 'all-servers' }, hosts).hosts, known);
});
test('emit alone is not success; exact nickname observation confirms, payload is nickname-only', async () => {
  const socket = new FakeSocket();
  let settled = false;
  const pending = requestNicknameUpdate(socket, 'Fixture A2', 1000).then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.deepEqual(socket.sent, [{ event: 'profile:update', payload: { nickname: 'Fixture A2' } }]);
  socket.emit('profile:updated', { nickname: 'different' });
  await Promise.resolve();
  assert.equal(settled, false);
  socket.emit('profile:updated', { nickname: 'Fixture A2' });
  await pending;
  clean(socket);
});
test('offline does not buffer a write or attach listeners', async () => {
  const socket = new FakeSocket(); socket.connected = false;
  await assert.rejects(requestNicknameUpdate(socket, 'Fixture A2'), /server-offline/);
  assert.deepEqual(socket.sent, []); clean(socket);
});
test('timeout leaves caller draft intact and cleans listeners', async () => {
  const socket = new FakeSocket(); let draft = 'Fixture draft';
  try { await requestNicknameUpdate(socket, draft, 5); draft = ''; }
  catch (error) { assert.match(error.message, /unconfirmed/); }
  assert.equal(draft, 'Fixture draft'); clean(socket);
});
test('disconnect and synchronous transport failure reject and clean listeners', async () => {
  const socket = new FakeSocket();
  const pending = requestNicknameUpdate(socket, 'Fixture A2');
  socket.emit('disconnect'); await assert.rejects(pending, /unconfirmed/); clean(socket);
  socket.throwOnSend = true;
  await assert.rejects(requestNicknameUpdate(socket, 'Fixture A2'), /fixture transport failure/); clean(socket);
});
test('mixed batch preserves confirmed result and reports unconfirmed host', async () => {
  const a = new FakeSocket(), b = new FakeSocket();
  const pending = Promise.allSettled([requestNicknameUpdate(a, 'Fixture All', 10), requestNicknameUpdate(b, 'Fixture All', 10)]);
  a.emit('profile:updated', { nickname: 'Fixture All' });
  const result = await pending;
  assert.deepEqual(result.map(r => r.status), ['fulfilled', 'rejected']); clean(a); clean(b);
});
test('UI source guards: explicit save/cancel, no nickname blur submit, IME and scope wiring', () => {
  const source = readFileSync(new URL('../src/packages/settings/src/components/profileSettings.tsx', import.meta.url), 'utf8');
  const editor = source.slice(source.indexOf('function ProfileEditor('), source.indexOf('function ActivityField('));
  assert.doesNotMatch(editor, /onBlur=/);
  assert.match(editor, /isComposing/); assert.match(editor, /keyCode !== 229/);
  assert.match(editor, /onClick=\{\(\) => setDraft\(nickname\)\}/);
  assert.match(editor, /savingNicknameRef.current/);
  const save = source.slice(source.indexOf('  const handleSaveNickname ='), source.indexOf('  const handleFileChange'));
  assert.match(save, /if \(plan.updateDefault\)/);
  assert.doesNotMatch(save, /setServerProfiles|avatarWorn|handleSyncToAll/);
  assert.match(source, /kind: "default"/); assert.match(source, /kind: "server", host/);
  assert.match(source, /kind: "all-servers"/);
  assert.doesNotMatch(source, /handleSyncToAll/);
  assert.match(source, /key=\{host\}/);
});

test('separate avatar-sync entry preserves upload/remove contract and never sets nickname', () => {
  const source = readFileSync(new URL('../src/packages/settings/src/components/profileSettings.tsx', import.meta.url), 'utf8');
  const avatar = source.slice(source.indexOf('  const handleSyncAvatarToAll ='), source.indexOf('  const [showAvatarSyncConfirm,'));
  assert.match(avatar, /getStoredAvatar/); assert.match(avatar, /copyVideoAvatar/);
  assert.match(avatar, /uploadAvatarToHost/); assert.match(avatar, /removeAvatarFromHost/);
  assert.match(avatar, /avatarWorn: worn/); assert.doesNotMatch(avatar, /nickname/);
  assert.match(source, /open=\{showAvatarSyncConfirm\}/);
  assert.match(source, /onClick=\{\(\) => setDraft\(nickname\)\}/);
});

test('own-avatar menu has a labeled nickname entry using existing settings navigation', () => {
  const source = readFileSync(new URL('../src/components/sidebar.tsx', import.meta.url), 'utf8');
  assert.match(source, /openSettings\("profile\/profile\/nickname"\)/);
  assert.match(source, /PiPencilSimpleFill size=\{14\}/);
  assert.match(source, /tr\("nicknameScope.editNickname"\)/);
  assert.match(source, /data-tour="menu-settings"\s+onClick=\{\(\) => setShowSettings\(true\)\}/);
});
test('nickname is before avatar/activity, and the mounted settings route focuses its stable anchor', () => {
  const profile = readFileSync(new URL('../src/packages/settings/src/components/profileSettings.tsx', import.meta.url), 'utf8');
  assert.ok(profile.indexOf('data-setting="profile.nickname"') < profile.indexOf('onClick={onPickAvatar}'));
  assert.ok(profile.indexOf('<ProfileEditor') < profile.indexOf('<ActivityField />'));
  assert.match(profile, /onClick=\{onPickAvatar\}/);
  const settings = readFileSync(new URL('../src/packages/settings/src/components/settings.tsx', import.meta.url), 'utf8');
  assert.match(settings, /!showSettings \|\| settingsTab !== "profile\/profile\/nickname"/);
  assert.match(settings, /\[data-setting="profile.nickname"\] input/);
  assert.match(settings, /field.focus\(\{ preventScroll: true \}\)/);
  assert.match(settings, /cancelAnimationFrame\(frame\)/);
});


test('explicit nickname refusal rejects immediately, preserves draft and cleans listeners', async () => {
  for (const message of ['Names that start with "bot" are reserved.', 'You do not have permission to change your nickname here.', 'Not authenticated']) {
    const socket = new FakeSocket(); let draft = 'Fixture refused';
    const pending = requestNicknameUpdate(socket, draft, 1000).then(() => { draft = ''; });
    socket.emit('profile:error', message);
    await assert.rejects(pending, /nickname-rejected/);
    assert.equal(draft, 'Fixture refused'); clean(socket);
    assert.equal(nicknameFailureKey(new Error('nickname-rejected')), 'nicknameScope.rejected');
  }
});
test('unrelated profile refusal cannot falsely identify a nickname rejection', async () => {
  const socket = new FakeSocket(); let settled = false;
  const pending = requestNicknameUpdate(socket, 'Fixture A2', 1000).finally(() => { settled = true; });
  socket.emit('profile:error', 'That avatar could not be read.');
  await Promise.resolve(); assert.equal(settled, false);
  socket.emit('profile:updated', { nickname: 'Fixture A2' });
  await pending; clean(socket);
});
test('offline, pending, explicit refusal and ambiguous timeout have distinct safe copy', () => {
  assert.equal(nicknameFailureKey(new Error('server-offline')), 'nicknameScope.offline');
  assert.equal(nicknameFailureKey(new Error('nickname-operation-pending')), 'nicknameScope.pending');
  assert.equal(nicknameFailureKey(new Error('nickname-unconfirmed')), 'nicknameScope.unconfirmed');
  assert.equal(nicknameFailureKey(new Error('arbitrary server content')), 'nicknameScope.unconfirmed');
});


test('separate callers sharing one socket cannot duplicate an in-flight rename', async () => {
  const socket = new FakeSocket();
  const firstEditor = requestNicknameUpdate(socket, 'Fixture A1', 1000);
  await assert.rejects(requestNicknameUpdate(socket, 'Fixture A2', 1000), /nickname-operation-pending/);
  assert.equal(socket.sent.length, 1);
  for (const event of ['profile:updated', 'profile:error', 'disconnect']) assert.equal(socket.listenerCount(event), 1);
  socket.emit('profile:updated', { nickname: 'Fixture A1' });
  await firstEditor; clean(socket);
  const reopenedEditor = requestNicknameUpdate(socket, 'Fixture A2', 1000);
  socket.emit('profile:updated', { nickname: 'Fixture A2' });
  await reopenedEditor; assert.equal(socket.sent.length, 2); clean(socket);
});
test('different sockets retain independent nickname operations', async () => {
  const a = new FakeSocket(), b = new FakeSocket();
  const first = requestNicknameUpdate(a, 'Fixture A', 1000);
  const second = requestNicknameUpdate(b, 'Fixture B', 1000);
  assert.equal(a.sent.length, 1); assert.equal(b.sent.length, 1);
  a.emit('profile:updated', { nickname: 'Fixture A' });
  b.emit('profile:updated', { nickname: 'Fixture B' });
  await Promise.all([first, second]); clean(a); clean(b);
});
test('refusal, timeout, disconnect and transport throw release the shared socket lock', async () => {
  for (const failure of ['refusal', 'timeout', 'disconnect', 'throw']) {
    const socket = new FakeSocket(); socket.throwOnSend = failure === 'throw';
    const first = requestNicknameUpdate(socket, 'Fixture A1', failure === 'timeout' ? 5 : 1000);
    if (failure === 'refusal') socket.emit('profile:error', 'You do not have permission to change your nickname here.');
    if (failure === 'disconnect') socket.emit('disconnect');
    await assert.rejects(first); clean(socket); socket.throwOnSend = false;
    const second = requestNicknameUpdate(socket, 'Fixture A2', 1000);
    socket.emit('profile:updated', { nickname: 'Fixture A2' });
    await second; clean(socket);
  }
});
test('failure copy does not promise drafts survived editor unmount', () => {
  for (const locale of ['en', 'zh-CN']) {
    const copy = JSON.parse(readFileSync(new URL(`../src/packages/i18n/locales/${locale}.json`, import.meta.url), 'utf8')).nicknameScope;
    for (const key of ['unconfirmed', 'rejected', 'offline']) assert.doesNotMatch(copy[key], /draft is kept|草稿已保留/i);
    assert.ok(copy.unsavedHint);
  }
});

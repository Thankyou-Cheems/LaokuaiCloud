import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
const source = readFileSync(new URL('../src/packages/socket/src/components/serverView.tsx', import.meta.url), 'utf8');
const match = source.match(/const serverNickname = ([^;]+);/);
assert.ok(match);
// Exercise the exact expression wired into the component, using synthetic profiles only.
const displayedName = new Function('serverProfiles', 'currentlyViewingServer', 'nickname', `return ${match[1]}`);
test('A/B server names remain independent of local default D', () => {
  const profiles = { a: { nickname: 'Fixture A' }, b: { nickname: 'Fixture B' } };
  assert.equal(displayedName(profiles, {host:'a'}, 'Fixture D'), 'Fixture A');
  assert.equal(displayedName(profiles, {host:'b'}, 'Fixture D'), 'Fixture B');
  assert.equal(displayedName(profiles, {host:'a'}, 'Fixture D2'), 'Fixture A');
});
test('confirmed server-profile refresh changes only that server display', () => {
  const profiles = { a: { nickname: 'Fixture A' }, b: { nickname: 'Fixture B' } };
  const refreshed = { ...profiles, a: { nickname: 'Fixture A2' } };
  assert.equal(displayedName(refreshed, {host:'a'}, 'Fixture D'), 'Fixture A2');
  assert.equal(displayedName(refreshed, {host:'b'}, 'Fixture D'), 'Fixture B');
  assert.equal(displayedName(refreshed, {host:'new'}, 'Fixture D'), 'Fixture D');
  assert.equal(displayedName(refreshed, null, 'Fixture D'), 'Fixture D');
});
test('hook and existing display share the scoped nickname before any early return', () => {
  assert.equal([...source.matchAll(/const serverNickname =/g)].length, 1);
  assert.ok(source.indexOf('const serverNickname =') < source.indexOf('} = useChat({'));
  assert.match(source, /serverDetailsList, nickname: serverNickname,/);
});

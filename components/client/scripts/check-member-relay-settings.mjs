/* eslint-env node */
// Real parsers/store and rendered controls with fake IPC; no native or network calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

import ts from 'typescript';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const dependencies = {};
function load(path) {
  const code = ts.transpileModule(read(path), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText;
  const exports = {};
  vm.runInThisContext(`(function(exports,require,window,setInterval,clearInterval){${code}\n})`)(exports, key => {
    assert.ok(Object.hasOwn(dependencies, key), `Unmocked dependency: ${key}`); return dependencies[key];
  }, {easyTierCommunity: api}, callback => {timers.add(callback); return callback;}, callback => timers.delete(callback));
  return exports;
}
const timers = new Set(), api = {};
const contract = load('src/lib/communityRelay.ts');
dependencies['../src/lib/communityRelay'] = contract;
const {CommunityRelayPreferences} = load('electron/communityRelayPreferences.ts');
const desire = {v: 1, serverId: 'community-a', enabled: true, bytesPerSecond: 32000};
assert.deepEqual(contract.parseRelayPreference(desire), desire);
for (const bad of [{...desire, bytesPerSecond: 0}, {...desire, bytesPerSecond: 1048577}, {...desire, enabled: false},
  {...desire, password: 'private'}, {...desire, [Symbol('extra')]: true}, {...desire, serverId: 'bad\n'}, Object.create(desire)])
  assert.throws(() => contract.parseRelayPreference(bad));
let reads = 0;
const getter = {...desire}; Object.defineProperty(getter, 'enabled', {get() {reads++; return true;}});
assert.throws(() => contract.parseRelayPreference(getter)); assert.equal(reads, 0);
const off = {v: 1, serverId: 'community-a', desiredEnabled: false, desiredBytesPerSecond: 0, status: 'off', reason: null,
  confirmedEnabled: false, localBudgetApplied: false, bytesPerSecond: 0, leaseExpiresAtMs: null};
const active = {...off, desiredEnabled: true, desiredBytesPerSecond: 32000, status: 'active', confirmedEnabled: true,
  localBudgetApplied: true, bytesPerSecond: 32000, leaseExpiresAtMs: 10000};
assert.deepEqual(contract.parseCommunityRelayState(active, 'community-a'), active);
for (const bad of [{...active, localBudgetApplied: false}, {...active, confirmedEnabled: false}, {...active, desiredEnabled: false},
  {...active, bytesPerSecond: 64000}, {...active, leaseExpiresAtMs: null}, {...active, serverId: 'community-b'}, {...active, status: 'waiting'}])
  assert.throws(() => contract.parseCommunityRelayState(bad, 'community-a'));
let stored;
const prefs = new CommunityRelayPreferences(() => stored, value => {stored = value;});
const keyA = 'a'.repeat(64), keyB = 'b'.repeat(64);
assert.equal(prefs.read(keyA), null);
prefs.write(keyA, {enabled: true, bytesPerSecond: 32000});
assert.equal(prefs.read(keyB), null, 'consent must not cross identity scopes');
const copy = prefs.read(keyA); copy.enabled = false; assert.equal(prefs.read(keyA).enabled, true);
prefs.write(keyA, {enabled: false, bytesPerSecond: 0}); assert.equal(prefs.read(keyA).enabled, false);
assert.throws(() => prefs.write(keyB, {enabled: true, bytesPerSecond: 0}));
stored = {[keyA]: {enabled: true, bytesPerSecond: 32000, password: 'private'}}; assert.equal(prefs.read(keyA), null);
stored = {}; Object.defineProperty(stored, keyA, {enumerable: true, get() {reads++; return desire;}});
assert.equal(prefs.read(keyA), null); assert.equal(reads, 0);

const locale = JSON.parse(read('src/packages/i18n/locales/zh-CN.json'));
const t = key => {const value = key.split('.').reduce((object, part) => object?.[part], locale); assert.equal(typeof value, 'string', key); return value;};
const slots = [], effects = [], calls = []; let cursor = 0, currentServer = 'community-a';
const jsx = (type, props) => ({type, props});
dependencies['react/jsx-runtime'] = {jsx, jsxs: jsx};
dependencies['@gryt/ui'] = {Alert: 'Alert', Button: 'Button', Switch: 'Switch'};
dependencies['@/i18n'] = {useTranslation: () => ({t})};
dependencies['@/socket'] = {useServerManagement: () => ({currentlyViewingServer: {serverId: currentServer}})};
dependencies['../../../../lib/communityRelay'] = contract;
dependencies.react = {
  useState(initial) {const slot = cursor++; if (!(slot in slots)) slots[slot] = initial; return [slots[slot], value => {slots[slot] = value;}];},
  useRef(initial) {const slot = cursor++; return slots[slot] ??= {current: initial};},
  useEffect(run, deps) {const slot = cursor++; if (slots[slot]?.deps[0] !== deps[0]) {slots[slot]?.cleanup?.(); effects.push(() => {slots[slot] = {deps, cleanup: run()};});}},
};
let pendingRead;
api.getRelayState = async () => pendingRead ? await pendingRead.promise : off;
api.setRelayPreference = async value => {calls.push(value); return value.enabled ? active : off;};
const {MemberRelaySettings} = load('src/packages/settings/src/components/memberRelaySettings.tsx');
const render = () => {cursor = 0; return MemberRelaySettings();};
const collect = tree => Array.isArray(tree) ? tree.flatMap(collect) : tree && typeof tree === 'object' ? [tree, ...collect(tree.props?.children)] : [];
const flush = async () => {for (let i = 0; i < 12; i++) await Promise.resolve();};
const defer = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};};
let tree = render(); effects.splice(0).forEach(run => run()); await flush(); tree = render();
const toggle = () => collect(tree).find(node => node.type === 'Switch');
assert.equal(toggle().props.checked, false); assert.equal(toggle().props.disabled, false);
pendingRead = defer(); [...timers][0]();
toggle().props.onCheckedChange(true); await flush(); tree = render();
assert.deepEqual(calls[0], desire); assert.equal(toggle().props.checked, true);
pendingRead.reject(Error('stale poll failure')); await flush(); tree = render();
assert.equal(toggle().props.checked, true, 'old poll failure cannot erase a newer confirmed switch result');
assert.equal(collect(tree).some(node => node.type === 'Alert'), false);
pendingRead = defer(); [...timers][0]();
currentServer = 'community-b'; render(); effects.splice(0).forEach(run => run());
pendingRead.resolve(active); await flush(); tree = render();
assert.equal(toggle().props.checked, false, 'old community result cannot set new community consent');
assert.equal(calls.length, 1, 'polling or switching communities cannot grant relay consent');
for (const slot of slots) slot?.cleanup?.(); assert.equal(timers.size, 0);
console.log('Member relay settings: strict DTO, truthful activation, scoped private consent, optional switch, stale poll/identity fences and cleanup passed; no native execution');

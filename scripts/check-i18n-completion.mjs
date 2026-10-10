import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require(process.env.GRYT_TYPESCRIPT_PATH || 'typescript');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const en = JSON.parse(read('src/packages/i18n/locales/en.json'));
const zh = JSON.parse(read('src/packages/i18n/locales/zh-CN.json'));
function flatten(value, prefix = '', into = {}) {
  for (const [key, entry] of Object.entries(value)) {
    const name = prefix + key;
    if (entry && typeof entry === 'object') flatten(entry, name + '.', into);
    else into[name] = entry;
  }
  return into;
}
const english = flatten(en), chinese = flatten(zh);
assert.deepEqual(Object.keys(english).sort(), Object.keys(chinese).sort(), 'locale key parity');
const parameters = (text) => [...new Set([...text.matchAll(/\{\{\s*([^},\s]+)(?:[^}]*)\}\}/g)].map(m => m[1]))].sort();
for (const [key, text] of Object.entries(english)) {
  assert.equal(typeof text, 'string', key);
  assert.ok(chinese[key]?.trim(), `empty Chinese: ${key}`);
  assert.deepEqual(parameters(text), parameters(chinese[key]), `interpolation: ${key}`);
}
const keyExists = key => key in english || key + '_one' in english || key + '_other' in english;
function files(dir) {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap(entry => {
    const p = join(dir, entry.name);
    return entry.isDirectory() ? files(p) : /\.tsx?$/.test(p) ? [p] : [];
  });
}
const sources = [...files('src'), ...files('electron')];
for (const p of sources) {
  const sf = ts.createSourceFile(p, read(p), ts.ScriptTarget.Latest, true, p.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  function visit(node) {
    let key;
    if (ts.isCallExpression(node) && /(?:^|\.)(?:t|tr)$/.test(node.expression.getText(sf)) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) key = node.arguments[0].text;
    if (ts.isJsxAttribute(node) && ['translationKey', 'i18nKey'].includes(node.name.text) && node.initializer && ts.isStringLiteral(node.initializer)) key = node.initializer.text;
    if (key && /^(shellFull|settingsFull|socketFull|pairingFull|crossProfile|shellSecond|shellThird|socketHooksFull|settingsSearch|settingsNativeDisplay)\./.test(key)) {
      assert.ok(keyExists(key), `missing source key ${key} in ${p}`);
      const machineFields = new Set(['kind', 'type', 'id', 'key', 'value', 'className', 'height', 'width', 'style', 'role', 'permission', 'code', 'mode', 'method', 'event', 'conversationKind', 'seed', 'display_name']);
      for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
        if (ts.isPropertyAssignment(ancestor) || ts.isJsxAttribute(ancestor) || ts.isGetAccessorDeclaration(ancestor)) {
          const name = ancestor.name.getText(sf);
          assert.ok(!machineFields.has(name), `translation reached machine field ${name}: ${p}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
          break; // A nested display label is distinct from its enclosing object prop.
        }
        if (ts.isStatement(ancestor)) break;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
}
for (const file of ['ChannelList', 'TypingIndicator', 'connectedUser']) {
  const source = read(`src/packages/socket/src/components/${file}.tsx`);
  assert.ok(!/height:\s*socketI18n\.t\(/.test(source), 'CSS auto must remain a CSS value: ' + file);
}
assert.ok(!/kind:\s*socketI18n\.t\(/.test(read('src/packages/socket/src/components/ChannelList.tsx')), 'notification kind must remain a protocol discriminator');
const discovery = read('src/components/discovery.tsx');
assert.ok(!discovery.includes('error.toLowerCase().includes("invite")'), 'invite actions must not depend on translated text');
assert.ok(discovery.includes('requiresInvite: outcome.kind === "invite_required"'), 'invite action has a structured kind');
assert.ok(discovery.includes('messageKey: outcome.messageKey'), 'retained error can react to language changes');

// Native language formatter is pure: test it without launching Electron or touching stored data.
const nativeJs = ts.transpileModule(read('electron/uiLanguage.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(nativeJs, {
  module, exports: module.exports,
  require: path => path.endsWith('/zh-CN.json') ? zh : path.endsWith('/en.json') ? en : (() => { throw new Error('Unexpected native dependency ' + path); })(),
});
const { nativeT, setNativeLanguagePreference } = module.exports;
const key = Object.keys(en.nativeFull).find(k => en.nativeFull[k] === 'Show Gryt');
assert.ok(key);
setNativeLanguagePreference('zh-CN', ['en-US']);
assert.equal(nativeT(key), '显示 Gryt');
setNativeLanguagePreference('en', ['zh-CN']);
assert.equal(nativeT(key), 'Show Gryt');
setNativeLanguagePreference('system', ['zh-TW', 'en-US']);
assert.equal(nativeT(key), 'Show Gryt');
setNativeLanguagePreference('system', ['zh-Hans']);
assert.equal(nativeT(key), '显示 Gryt');
setNativeLanguagePreference(undefined, []);
assert.equal(nativeT(key), 'Show Gryt');
setNativeLanguagePreference({ unexpected: 'data' }, ['zh-CN']);
assert.equal(nativeT(key), '显示 Gryt');
setNativeLanguagePreference('arbitrary-protocol-key', ['en-US']);
assert.equal(nativeT(key), 'Show Gryt');
setNativeLanguagePreference('system', ['zh-SG']);
assert.equal(nativeT(key), '显示 Gryt');
const nameKey = Object.keys(en.nativeFull).find(k => en.nativeFull[k] === 'Voice — {{value0}}');
assert.equal(nativeT(nameKey, { value0: '用户 Server <test>' }), '语音 · 用户 Server <test>');

// Version-bound report-summary adapter: display only, with unknown values preserved.
const attachmentModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(read('src/lib/reports/attachmentLabels.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { module: attachmentModule, exports: attachmentModule.exports });
const originalLines = Object.freeze([
  Object.freeze({ label: 'Install', value: 'private-id-123' }),
  Object.freeze({ label: 'Where you were', value: '/user/中文-name' }),
  Object.freeze({ label: 'In voice', value: 'yes' }),
  Object.freeze({ label: 'Log', value: 'last 12 lines' }),
  Object.freeze({ label: 'Running for', value: '3 min' }),
  Object.freeze({ label: 'New upstream field', value: 'unknown user content' }),
]);
const translatedLines = attachmentModule.exports.localizeAttachmentLines(originalLines, (key, values = {}) =>
  chinese[key].replace(/\{\{(\w+)\}\}/g, (_, name) => String(values[name])),
);
assert.equal(translatedLines[0].value, 'private-id-123');
assert.equal(translatedLines[1].value, '/user/中文-name');
assert.equal(translatedLines[2].value, '是');
assert.equal(translatedLines[3].value, '最近 12 行');
assert.equal(translatedLines[4].value, '3 分钟');
assert.equal(translatedLines[5].label, 'New upstream field');
assert.equal(translatedLines[5].value, 'unknown user content');
assert.equal(originalLines[2].value, 'yes');

// Parse all source files without pretending this is a semantic typecheck or a build.
for (const p of sources) {
  const sf = ts.createSourceFile(p, read(p), ts.ScriptTarget.Latest, true, p.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  assert.equal(sf.parseDiagnostics.length, 0, `TypeScript parse errors: ${p}`);
}
console.log(`i18n completion checks passed: ${Object.keys(english).length} matching locale keys, ${sources.length} parsed source files, structured invite action and native formatter. Runtime UI, full typecheck, build and real devices are separate acceptance stages.`);

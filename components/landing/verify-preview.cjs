const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
assert(!/<(?:a|form|iframe|audio|video)\b/i.test(html));
assert(!/(?:src|href)\s*=\s*["']https?:/i.test(html));
assert(html.includes('打开唠蒯云客户端，添加服务器，输入 voice.ruikang.wang。'));
assert(html.includes('@media (max-width: 420px)'));
assert(html.includes(':focus-visible'));
async function check(name, clipboard, secure, shouldCopy) {
  const handlers = {};
  const address = { value: 'voice.ruikang.wang', focus() { this.focused = true; }, select() { this.selected = true; }, setSelectionRange(a, b) { this.range = [a, b]; }, addEventListener(type, fn) { handlers['address:' + type] = fn; } };
  const button = { addEventListener(type, fn) { handlers['button:' + type] = fn; } };
  const status = { textContent: '' };
  vm.runInNewContext(script, { document: { getElementById: id => ({ 'server-address': address, 'copy-address': button, 'copy-status': status })[id] }, navigator: { clipboard }, window: { isSecureContext: secure } });
  await handlers['button:click']();
  if (shouldCopy) assert.equal(status.textContent, '地址已复制，去客户端添加服务器吧。');
  else { assert.equal(address.focused, true); assert.equal(address.selected, true); assert.deepEqual(address.range, [0, 18]); assert(status.textContent.includes('地址已选中')); }
  handlers['address:click']();
  assert.equal(address.selected, true);
  console.log('PASS ' + name);
}
(async () => {
  let copied;
  await check('clipboard success', { async writeText(value) { copied = value; } }, true, true);
  assert.equal(copied, 'voice.ruikang.wang');
  await check('clipboard denied', { async writeText() { throw new Error('NotAllowedError'); } }, true, false);
  await check('clipboard unavailable', undefined, true, false);
  await check('insecure preview context', { async writeText() { throw new Error('must not call'); } }, false, false);
  console.log('PASS static content, no external resources, no form/media/link, responsive and focus styles');
})().catch(error => { console.error(error); process.exitCode = 1; });

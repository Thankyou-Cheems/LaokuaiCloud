import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Static source contracts only. No core, Cargo, child process, network or OS API.
const root = fileURLToPath(new URL('../', import.meta.url));
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const nic = read('easytier/src/instance/virtual_nic.rs');
const arch = read('easytier/src/arch/windows.rs');
const registry = read('easytier/src/common/ifcfg/windows.rs');
const core = read('easytier/src/core.rs');
const lifecycle = read('easytier-core/src/instance/lifecycle.rs');
const nativeFactory = read('easytier/src/instance/factory.rs');
let count = 0;
function check(name, action) { action(); console.log(`ok ${++count} ${name}`); }
function section(source, start, end) {
  assert.ok(source.includes(start)); const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length); assert.ok(b > a); return source.slice(a,b);
}
check('global NetworkList profile and signature mutation has no downstream implementation', () => {
  const helpers = section(registry, 'pub fn reg_delete_obsoleted_items(', '// 根据接口名称查找 GUID');
  assert.ok(!/RegKey::|KEY_ALL_ACCESS|delete_subkey|set_value/.test(helpers));
  assert.ok(!nic.includes('reg_delete_obsoleted_items'));
});
check('downstream host policy is externally managed by default, before every legacy firewall mutation', () => {
  assert.ok(arch.includes('pub const LAOKUAI_HOST_POLICY_EXTERNALLY_MANAGED: bool = true;'));
  for (const name of ['do_add_self_to_firewall_allowlist', 'add_interface_to_firewall_allowlist', 'remove_interface_firewall_rules']) {
    const prefix = arch.slice(arch.indexOf(`pub fn ${name}(`));
    assert.ok(prefix.indexOf('return Ok(());') < prefix.indexOf('ComInitializer::new()'));
  }
  assert.ok(!nic.includes('remove_interface_firewall_rules'));
  assert.ok(!nic.includes('add_interface_to_firewall_allowlist'));
  assert.ok(!nic.includes('add_self_to_firewall_allowlist'));
  assert.ok(!nic.includes('disable Windows Firewall'));
});
check('new TUN GUID is requested and resolved to actual LUID and ifIndex, without alias cleanup', () => {
  assert.ok(nic.includes('config.device_guid(owned_guid.as_u128())'));
  assert.ok(nic.indexOf('laokuai_require_new_interface(') < nic.indexOf('let dev = tun::create(&config)?'));
  assert.ok(nic.includes('laokuai_report_owned_interface(owned_guid)?'));
  assert.ok(arch.includes('ConvertInterfaceGuidToLuid(&native_guid, &mut luid)'));
  assert.ok(arch.includes('ConvertInterfaceLuidToIndex(&luid, &mut index)'));
  assert.ok(arch.includes('luid.Value'));
});
check('owned pipe excludes daemon, default, directory, config-server and shared stdin configuration', () => {
  const guard = section(core, 'async fn run_main(', 'let owned_stdin = cli.laokuai_owned_stdin');
  for (const predicate of ['cli.daemon', 'cli.config_server.is_some()', 'cli.config_dir.is_some()', 'files.len() != 1', 'PathBuf::from("-")', 'cli.network_options.network_name.is_some()']) assert.ok(guard.includes(predicate));
});
check('owned stop is serialized lifecycle stop, preserves config and precedes acknowledgement', () => {
  const stop = section(core, 'if owned_stdin {\n        // CoreInstance::stop', '\nfn memory_monitor');
  assert.ok(stop.includes('for instance in manager.instances()'));
  assert.ok(stop.includes('instance.stop().await;'));
  assert.ok(stop.indexOf('instance.stop().await;') < stop.indexOf('LAOKUAI_OWNED_STOPPED_V1'));
  assert.ok(!/manager\.(delete|retain)|config_control\([^)]*\)\.delete/.test(stop));
  assert.ok(lifecycle.includes('pub async fn stop(self: &Arc<Self>)'));
  assert.ok(lifecycle.includes('self.operation.lock().await'));
  assert.ok(stop.indexOf('drop(_rpc_server)') < stop.indexOf('LAOKUAI_OWNED_STOPPED_V1'));
});
check('private pipe reader terminates on EOF, bounds input and avoids Tokio blocking stdin lifetime', () => {
  const pipe = section(core, 'fn laokuai_owned_stop_pipe()', 'async fn run_main(');
  assert.ok(pipe.includes('std::thread::spawn'));
  assert.ok(pipe.includes('read_exact(&mut command)'));
  assert.ok(pipe.includes('let _ = send.send(());'));
  assert.equal(Buffer.byteLength('LAOKUAI_OWNED_STOP_V1\n'), 22);
  assert.ok(pipe.includes('[0u8; 22]'));
});
check('owned receipt pipe disables peer-controlled CLI event presentation', () => {
  assert.ok(core.includes('let manager = if owned_stdin {\n        native_instance_manager()'));
  const defaultFactory = section(nativeFactory, 'fn native_instance_manager_with_optional_runtime(', '/// Native construction Adapter');
  assert.ok(!defaultFactory.includes('with_cli_event_logging'));
});
check('downstream version does not impersonate official release', () => {
  assert.ok(read('easytier/src/common/constants.rs').includes('EASYTIER_VERSION: &str = "2.7.0-laokuai"'));
});
check('Windows product TUN creation cannot open a foreign alias before validating actual identity', () => {
  const device = read('vendor/rust-tun/src/platform/windows/device.rs');
  const owned = section(device, 'let adapter = if let Some(owned_guid)', '\n        } else {');
  assert.ok(nic.includes('config.create_only();'));
  assert.ok(read('Cargo.toml').includes('tun-easytier = { path = "vendor/rust-tun" }'));
  assert.ok(owned.includes('create_verified_adapter('));
  assert.ok(owned.includes('Adapter::create('));
  assert.ok(!owned.includes('Adapter::open('));
  assert.ok(!owned.includes('start_session('));
  assert.ok(owned.includes('ConvertInterfaceLuidToGuid(&luid, &mut actual)'));
  assert.ok(device.indexOf('create_verified_adapter(') < device.indexOf('adapter.set_network_addresses_tuple('));
  assert.ok(device.indexOf('create_verified_adapter(') < device.indexOf('adapter.start_session('));
  const compact = device.replace(/\s/g, '');
  assert.ok(compact.includes('device_guid.ok_or(Error::InvalidConfig)?'));
  assert.ok(compact.indexOf('device_guid.ok_or(Error::InvalidConfig)?') < compact.indexOf('Library::new('));
  assert.ok(arch.includes('CompareStringOrdinal(&existing_alias, &requested_alias, true)'));
  const lockEntry = section(read('Cargo.lock'), 'name = "tun-easytier"', '\n[[package]]');
  assert.ok(!lockEntry.includes('source ='));
});
check('declared Rust minimum is 1.95 and toolchain selector matches; lock format does not replace MSRV', () => {
  assert.ok(read('Cargo.toml').includes('rust-version = "1.95"'));
  assert.ok(read('rust-toolchain.toml').includes('channel = "1.95"'));
  assert.ok(read('easytier/Cargo.toml').includes('rust-version.workspace = true'));
  assert.ok(read('Cargo.lock').startsWith('# This file is automatically @generated by Cargo.\n# It is not intended for manual editing.\nversion = 4'));
});
console.log(`${count} static source contracts passed; compilation and Windows/TUN acceptance remain pending`);

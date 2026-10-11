import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/lib/squadMode.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { SquadController, SQUAD_DEFAULTS, resolveSquadConfig, validateSquadConfig, squadProcessMatches, squadCombo, squadObservedKeys, squadGateRequired } =
  await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const game = "C:\\Steam\\steamapps\\common\\Squad\\SquadGame\\Binaries\\Win64\\SquadGame-Win64-Shipping.exe";
const scope = (down = [], path = game) => ({ valid: true, path, down });
let checks = 0;
function check(name, callback) { callback(); checks++; console.log(`PASS ${name}`); }
const fresh = config => { const c = new SquadController(); c.configure({ ...SQUAD_DEFAULTS, ...config }); return c; };
check("new users default on, independent foreground switch", () => { assert.equal(SQUAD_DEFAULTS.enabled, true); assert.equal(SQUAD_DEFAULTS.processDetection, true); });
check("persisted false survives upgrade and damaged shapes are safe", () => {
  assert.equal(resolveSquadConfig({enabled:false,processDetection:false}).enabled,false);
  assert.equal(resolveSquadConfig({enabled:false,keys:null}).enabled,false);
  assert.deepEqual(resolveSquadConfig({keys:17}).keys, SQUAD_DEFAULTS.keys);
  assert.deepEqual(resolveSquadConfig(null), SQUAD_DEFAULTS);
});
check("shipping executable path, case insensitive", () => assert.equal(squadProcessMatches(game.toUpperCase()), true));
check("legacy actual game path accepted", () => assert.equal(squadProcessMatches(game.replace("-Win64-Shipping", "")), true));
check("root launcher excluded", () => assert.equal(squadProcessMatches("C:\\Steam\\Squad\\SquadGame.exe"), false));
check("anti-cheat excluded", () => assert.equal(squadProcessMatches(game.replace("SquadGame-Win64-Shipping", "start_protected_game")), false));
check("unrelated matching title or filename excluded", () => assert.equal(squadProcessMatches("C:\\Other\\SquadGame-Win64-Shipping.exe"), false));
check("user basename target", () => assert.equal(squadProcessMatches("D:\\custom\\MyGame.exe", "mygame.exe"), true));
check("full target distinguishes installation", () => assert.equal(squadProcessMatches("D:\\custom\\MyGame.exe", "C:\\custom\\MyGame.exe"), false));
check("invalid target wildcards and args", () => { assert.equal(validateSquadConfig({ ...SQUAD_DEFAULTS, processTarget: "game.exe --arg" }), "invalid-process"); assert.equal(validateSquadConfig({ ...SQUAD_DEFAULTS, processTarget: "*.exe" }), "invalid-process"); });
check("modifier only and unsupported keys rejected", () => { assert.equal(squadCombo("Shift"), null); assert.equal(squadCombo("KeyUnknown"), null); });
check("same normalized chord rejected, different chords allowed", () => { assert.equal(validateSquadConfig({ ...SQUAD_DEFAULTS, keys: ["Ctrl+Shift+KeyB", "Shift+Ctrl+KeyB"] }), "duplicate-key"); assert.equal(validateSquadConfig({ ...SQUAD_DEFAULTS, keys: ["KeyB", "Shift+KeyB"] }), null); });
check("modifier overlap call shortcut rejected", () => assert.equal(validateSquadConfig(SQUAD_DEFAULTS, ["Ctrl+KeyB"]), "hotkey-conflict"));
check("different bases allowed", () => assert.equal(validateSquadConfig(SQUAD_DEFAULTS, ["Ctrl+KeyM"]), null));
check("configured keys only", () => assert.deepEqual(squadObservedKeys({ ...SQUAD_DEFAULTS, keys: ["Shift+KeyB"] }), [66, 16]));
check("no game standby never blocks ordinary call", () => { const s = fresh().sample(scope([66], "C:\\Editor.exe"), 0); assert.equal(s.status, "standby"); assert.equal(s.gateEnabled, false); assert.equal(s.suppressed, false); });
check("matched foreground arms before key", () => assert.equal(fresh().sample(scope(), 0).status, "armed"));
check("B plus extra Shift works", () => assert.equal(fresh().sample(scope([66, 16]), 0).status, "suppressed"));
check("repeat does not duplicate held count", () => { const c = fresh(); c.sample(scope([66]), 0); assert.equal(c.sample(scope([66]), 20).heldCount, 1); });
check("multiple held keys, one release stays closed", () => { const c = fresh(); c.sample(scope([66,71]), 0); const s = c.sample(scope([71]), 50); assert.equal(s.heldCount, 1); assert.equal(s.suppressed, true); });
check("last release begins 200ms hangover, not fresh ACK", () => { const c = fresh(); c.sample(scope([66]), 0); assert.equal(c.sample(scope(), 10).status, "hangover"); assert.equal(c.sample(scope(), 209).suppressed, true); assert.equal(c.sample(scope(), 210).suppressed, false); });
check("repress invalidates old release boundary", () => { const c = fresh(); c.sample(scope([66]), 0); c.sample(scope(), 10); c.sample(scope([71]), 150); assert.equal(c.sample(scope([71]), 300).suppressed, true); assert.equal(c.sample(scope(), 310).status, "hangover"); assert.equal(c.sample(scope(), 509).suppressed, true); });
check("focus lost while held stays closed until real release", () => { const c = fresh(); c.sample(scope([66]), 0); assert.equal(c.sample(scope([66], "C:\\Editor.exe"), 30).suppressed, true); assert.equal(c.sample(scope([], "C:\\Editor.exe"), 80).status, "hangover"); assert.equal(c.sample(scope([], "C:\\Editor.exe"), 280).status, "standby"); });
check("unknown initial capability does not block ordinary call", () => { const s = fresh().sample({ valid: false, path: "", down: [] }, 0); assert.equal(s.status, "unavailable"); assert.equal(s.suppressed, false); });
check("unknown after armed fails closed", () => { const c = fresh(); c.sample(scope(), 0); assert.equal(c.sample({ valid: false, path: "", down: [] }, 50).suppressed, true); });
check("valid reconciliation clears missing release with hangover", () => { const c = fresh(); c.sample(scope([66]), 0); c.sample({ valid: false, path: "", down: [] }, 1000); assert.equal(c.sample(scope(), 1100).suppressed, true); assert.equal(c.sample(scope(), 1300).suppressed, false); });
check("typing/recording excludes new holds, never releases existing hold", () => { const c = fresh({ processDetection: false }); assert.equal(c.sample(scope([66]), 0, true).suppressed, false); c.sample(scope([66]), 20); assert.equal(c.sample(scope([66]), 50, true).suppressed, true); });
check("global mode explicit, works outside game", () => { const s = fresh({ processDetection: false }).sample(scope([66], "C:\\Editor.exe"), 0); assert.equal(s.global, true); assert.equal(s.suppressed, true); });
check("required modifier release does not open while base held", () => { const c = fresh({ keys: ["Shift+KeyB"] }); assert.equal(c.sample(scope([66]), 0).suppressed, false); c.sample(scope([66,16]), 20); assert.equal(c.sample(scope([66]), 30).suppressed, true); });
check("disable while held drains only after physical release and hangover", () => {
  const c = fresh(); c.sample(scope([66]), 0); c.configure({ ...SQUAD_DEFAULTS, enabled: false });
  assert.equal(c.sample(scope([66]), 30).suppressed, true); assert.equal(c.sample(scope(), 50).status, "hangover");
  assert.equal(c.sample(scope(), 249).suppressed, true); assert.equal(c.sample(scope(), 250).status, "off");
});
check("zero stays empty across resolution and has explicit idle state", () => {
  assert.deepEqual(resolveSquadConfig({ keys: [] }).keys, []); assert.equal(validateSquadConfig({ ...SQUAD_DEFAULTS, keys: [] }), null);
  assert.equal(fresh({ keys: [] }).sample(scope([66]), 0).status, "unconfigured");
});
check("more than six supported bindings survive", () => {
  const keys = ["KeyB", "KeyG", "KeyV", "KeyH", "KeyJ", "KeyK", "KeyL", "Mouse4"];
  assert.equal(validateSquadConfig({ ...SQUAD_DEFAULTS, keys }), null); assert.deepEqual(resolveSquadConfig({ keys }).keys, keys);
  assert.equal(fresh({ keys }).sample(scope([5]), 0).suppressed, true);
});
check("legacy three fields migrate without inserting missing defaults", () => {
  assert.deepEqual(resolveSquadConfig({ squadRadioKey: "F5", commandRadioKey: "Ctrl+KeyG", localVoiceKey: "Mouse4", enabled: false }).keys, ["F5", "Ctrl+KeyG", "Mouse4"]);
  assert.deepEqual(resolveSquadConfig({ keys: [], squadRadioKey: "KeyB" }).keys, []);
  assert.deepEqual(resolveSquadConfig({ squadRadioKey: "", commandRadioKey: "", localVoiceKey: "" }).keys, []);
});
check("persisted exact/reordered duplicates collapse, distinct chords stay", () => {
  assert.deepEqual(resolveSquadConfig({ keys: ["Shift+Ctrl+KeyB", "Ctrl+Shift+KeyB", "KeyB"] }).keys, ["Ctrl+Shift+KeyB", "KeyB"]);
});
check("remove or replace a held binding retains its physical observation", () => {
  const c = fresh(); c.sample(scope([66,71]), 0); c.configure({ ...SQUAD_DEFAULTS, keys: ["KeyV"] });
  assert.deepEqual(c.observedKeys().sort(), [66,71,86]); assert.equal(c.sample(scope([66,71]), 30).heldCount, 2);
  assert.equal(c.sample(scope([71]), 50).suppressed, true); c.sample(scope(), 60);
  assert.equal(c.sample(scope(), 260).suppressed, false); assert.deepEqual(c.observedKeys(), [86]);
});
check("delete final held row reaches unconfigured after release, never restores defaults", () => {
  const c = fresh({ keys: ["KeyB"] }); c.sample(scope([66]), 0); c.configure({ ...SQUAD_DEFAULTS, keys: [] });
  assert.equal(c.sample(scope([66]), 500).suppressed, true); c.sample(scope(), 600);
  assert.equal(c.sample(scope(), 800).status, "unconfigured"); assert.deepEqual(c.observedKeys(), []);
});
check("config change never drops an in-flight press after a trusted armed scope", () => {
  const c = fresh(); c.sample(scope(), 0); c.preservePendingHolds([66]); c.configure({ ...SQUAD_DEFAULTS, keys: [] });
  assert.equal(c.sample(scope([66]), 10).suppressed, true); c.sample(scope(), 20); assert.equal(c.sample(scope(), 220).status, "unconfigured");
});
check("device/scope fault while held waits for a trusted snapshot", () => {
  const c = fresh(); c.sample(scope([66]), 0); c.configure({ ...SQUAD_DEFAULTS, enabled: false });
  assert.equal(c.sample({ valid: false, path: "", down: [] }, 1000, false, "input-unavailable").suppressed, true);
  assert.equal(c.sample(scope([66]), 1200).suppressed, true); c.sample(scope(), 1300); assert.equal(c.sample(scope(), 1500).status, "off");
});
check("changing target or process mode cannot release an old hold", () => {
  const c = fresh(); c.sample(scope([66]), 0); c.configure({ ...SQUAD_DEFAULTS, processTarget: "Other.exe", processDetection: false });
  assert.equal(c.sample(scope([66], "C:\\Other.exe"), 10).suppressed, true); c.sample(scope([], "C:\\Other.exe"), 20);
  assert.equal(c.sample(scope([], "C:\\Other.exe"), 220).suppressed, false);
});
check("graph stays installed through SDK recovery, suspension and failures", () => {
  const state = fresh({ keys: [] }).sample(scope(), 0);
  for (const status of ["recovering","suppressed","suspended","failed"]) assert.equal(squadGateRequired(state, true, status), true);
  assert.equal(squadGateRequired(state, true, "ready"), false); assert.equal(squadGateRequired(state, false, "disabled"), false);
});
const evidence = { checks, realInputObserved: false, realMicrophoneOpened: false, fixtureOnly: true };
fs.writeFileSync(new URL("../squad-state-evidence.json", import.meta.url), JSON.stringify(evidence, null, 2));
console.log(`${checks} Squad state/fixture checks passed`);

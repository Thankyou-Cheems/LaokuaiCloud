// Actual component callbacks with fake React state: no DOM, listeners, helper or network.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const plain = value => JSON.parse(JSON.stringify(value));
function compile(path, dependencies) {
  const compiled = ts.transpileModule(read(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } });
  const exports = {};
  vm.runInNewContext(compiled.outputText, { exports, require(name) {
    assert.ok((Object.hasOwn(dependencies, name) || (name.endsWith("/voiceFacade") && Object.hasOwn(dependencies,"@gryt/voice"))), `unapproved dependency ${name}`);
    return name.endsWith("/voiceFacade") ? dependencies["@gryt/voice"] : dependencies[name];
  } });
  return exports;
}
const mode = compile("src/lib/squadMode.ts", {});
const hotkeys = compile("src/lib/hotkeys.ts", {});
let state = [], cursor = 0, callbacks = [];
const react = {
  useState(initial) { const index = cursor++; if (!(index in state)) state[index] = initial;
    return [state[index], value => { state[index] = typeof value === "function" ? value(state[index]) : value; }]; },
  useEffect() {}, // Never installs the real window listeners.
  useCallback(fn) { callbacks.push(fn); return fn; },
};
const jsx = (type, props, key) => ({ type, props, key });
const locale = JSON.parse(read("src/packages/i18n/locales/zh-CN.json"));
const t = (key, options = {}) => {
  const value = key.split(".").reduce((current, part) => current?.[part], locale);
  assert.equal(typeof value, "string", `missing Chinese label ${key}`);
  return value.replace(/\{\{(\w+)\}\}/g, (_, name) => String(options[name] ?? ""));
};
const boundaries = {
  "react/jsx-runtime": { jsx, jsxs: jsx }, react,
  "@gryt/ui": { Button: "Button", Chip: "Chip" },
  "@/i18n": { useTranslation: () => ({ t }) }, "@/settings": { useSettings() { throw Error("not a real settings/profile test"); } },
  "./settingsComponents": { SettingGroup: "SettingGroup", ToggleSetting: "ToggleSetting", SettingsContainer: "SettingsContainer" },
};
const hotkeyModule = compile("src/packages/settings/src/components/hotkeySettings.tsx", {
  ...boundaries, "../../../../lib/hotkeys": hotkeys,
});
const ui = compile("src/packages/settings/src/components/squadSettings.tsx", {
  ...boundaries, "./hotkeySettings": { HotkeyCapture: "HotkeyCapture" },
  "@gryt/voice": { useMicrophone() { throw Error("no microphone"); } },
  "../../../../lib/electron": { getElectronAPI() { throw Error("no IPC/process validation"); } },
  "../../../../lib/squadMode": mode, "../../../../lib/squadRuntime": { useSquadSnapshot() { throw Error("no runtime"); } },
});
let config = plain(mode.SQUAD_DEFAULTS), saves = 0, checks = 0;
const check = (name, run) => { run(); checks++; console.log(`PASS ${name}`); };
function render() {
  cursor = 0;
  return ui.SquadControl({ config, onChange(next) { config = plain(next); saves++; }, otherKeys: [],
    state: { status: "armed", heldCount: 0 }, transmission: { status: "ready" }, retry() { throw Error("no real recovery"); } });
}
function nodes(tree) {
  if (!tree) return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}
const button = (tree, label) => nodes(tree).find(node => node.type === "Button" && node.props.children === label);
const captures = tree => nodes(tree).filter(node => node.type === "HotkeyCapture");
function add(key) {
  button(render(), t("squad.addKey")).props.onClick();
  const capture = captures(render()).find(node => node.props.anchorId === "squad-key-new");
  assert.ok(capture.props.startListening);
  capture.props.onChange(key);
}
check("three existing bindings render with Chinese delete labels", () => {
  assert.deepEqual(captures(render()).map(node => node.props.value), ["KeyB", "KeyG", "KeyV"]);
  assert.ok(captures(render()).every(node => node.props.clearLabel === "删除"));
});
check("add starts capture without persisting a blank placeholder", () => {
  const before = saves; button(render(), t("squad.addKey")).props.onClick();
  assert.equal(saves, before); assert.equal(config.keys.length, 3);
  const capture = captures(render()).find(node => node.props.anchorId === "squad-key-new");
  capture.props.onChange("KeyH"); assert.deepEqual(config.keys, ["KeyB", "KeyG", "KeyV", "KeyH"]);
});
check("duplicate add has a clear error and leaves saved bindings intact", () => {
  const before = saves; add("KeyH"); assert.equal(saves, before);
  assert.ok(nodes(render()).some(node => node.props?.role === "alert" && node.props.children === t("squad.errors.duplicate-key")));
  button(render(), t("ui.cancel")).props.onClick();
});
check("more than six rows can be added, edited and removed", () => {
  for (const key of ["KeyJ", "KeyK", "KeyL", "Mouse4", "F8", "F9"]) add(key);
  assert.equal(config.keys.length, 10);
  captures(render())[3].props.onChange("Ctrl+KeyH"); assert.equal(config.keys[3], "Ctrl+KeyH");
  captures(render())[3].props.onChange(""); assert.equal(config.keys.length, 9);
});
check("delete all shows unconfigured, never silently restores B/G/V", () => {
  while (config.keys.length) captures(render())[0].props.onChange("");
  assert.deepEqual(config.keys, []); assert.deepEqual(plain(mode.resolveSquadConfig(config).keys), []);
  assert.ok(nodes(render()).some(node => node.props?.children === t("squad.emptyKeys")));
});
check("cancel new row preserves the empty configuration", () => {
  const before = saves; button(render(), t("squad.addKey")).props.onClick();
  button(render(), t("ui.cancel")).props.onClick(); assert.equal(saves, before); assert.deepEqual(config.keys, []);
});
check("only explicit reset restores the default keys", () => {
  button(render(), t("squad.resetKeys")).props.onClick(); assert.deepEqual(config.keys, ["KeyB", "KeyG", "KeyV"]);
});
check("actual capture callbacks handle keyboard, modifiers, mouse, cancel and IME", () => {
  state = []; cursor = 0; callbacks = [];
  const values = [];
  hotkeyModule.HotkeyCapture({ anchorId: "fixture", label: "键", description: "", value: "", startListening: true, onChange: value => values.push(value) });
  const [keydown, mousedown] = callbacks;
  let prevented = 0;
  const event = { code: "KeyH", ctrlKey: true, shiftKey: false, altKey: false, metaKey: false,
    preventDefault() { prevented++; }, stopPropagation() {} };
  keydown({ ...event, isComposing: true }); assert.equal(prevented, 0); assert.deepEqual(values, []);
  keydown(event); assert.deepEqual(values, ["Ctrl+KeyH"]);
  keydown({ ...event, code: "Escape" }); assert.equal(values.length, 1);
  mousedown({ ...event, button: 0 }); assert.equal(values.length, 1);
  mousedown({ ...event, button: 3 }); assert.deepEqual(values, ["Ctrl+KeyH", "Ctrl+Mouse4"]);
});
console.log(`${checks} actual component/capture callback scenarios passed; no DOM/window/global input/audio/network`);

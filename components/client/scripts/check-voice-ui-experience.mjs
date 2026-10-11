// Actual component callbacks in a VM: all hooks, timers and browser boundaries are fake.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const componentPath = name => `src/packages/webRTC/src/components/${name}.tsx`;
const jsx = (type, props, key) => ({ type, props, key });
const locales = Object.fromEntries(["en", "zh-CN"].map(language => [language, JSON.parse(read(`src/packages/i18n/locales/${language}.json`))]));
let language = "zh-CN";
const lookup = (locale, key) => key.split(".").reduce((value, part) => value?.[part], locale);
const t = (key, values = {}) => {
  const text = lookup(locales[language], key) ?? lookup(locales.en, key);
  assert.equal(typeof text, "string", `missing UI translation ${key}`);
  return text.replace(/\{\{(\w+)\}\}/g, (_, name) => String(values[name] ?? ""));
};
let slots = [], cursor = 0, effects = [], scheduled = new Map(), timerId = 0;
const listeners = new Map();
const document = { fullscreenElement: null, activeElement: null, addEventListener() {}, removeEventListener() {} };
const window = { addEventListener(name, callback) { listeners.set(name, callback); }, removeEventListener(name) { listeners.delete(name); } };
const react = {
  useState(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
    return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
  },
  useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
  useId() { return `fake-id-${cursor++}`; },
  useEffect(callback, dependencies) {
    const index = cursor++, previous = slots[index];
    if (!previous || !dependencies || dependencies.some((value, i) => value !== previous[i])) effects.push(callback);
    slots[index] = dependencies;
  },
};
function compile(path, dependencies) {
  const result = ts.transpileModule(read(path), { reportDiagnostics: true, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } });
  assert.deepEqual(result.diagnostics?.filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error), [], path);
  const exports = {};
  vm.runInNewContext(result.outputText, { exports, document, window, HTMLElement: class {},
    setTimeout(callback, delay) { const id = ++timerId; scheduled.set(id, { callback, delay }); return id; },
    clearTimeout(id) { scheduled.delete(id); },
    require(name) { assert.ok(Object.hasOwn(dependencies, name), `unexpected dependency ${name}`); return dependencies[name]; },
  });
  return exports;
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}
const find = (tree, type) => nodes(tree).find(node => node.type === type);
const reset = () => { slots = []; cursor = 0; effects = []; scheduled.clear(); listeners.clear(); };
function render(component, props) { cursor = 0; const tree = component(props); effects.splice(0).forEach(callback => callback()); return tree; }
let settings, policy, checks = 0;
const routes = [], modes = [], squadSaves = [];
const dependencies = {
  "react/jsx-runtime": { jsx, jsxs: jsx }, react,
  "@/i18n": { useTranslation: () => ({ t }) },
  "@/settings": { useSettings: () => settings },
  "./EffectiveVoicePolicy": { useEffectiveVoicePolicy: () => policy },
};
const hotkeys = compile("src/lib/hotkeys.ts", {});
const { VoiceModeControl } = compile(componentPath("VoiceModeControl"), { ...dependencies, "../../../../lib/hotkeys": hotkeys });
const { SquadControl } = compile(componentPath("SquadControl"), {
  ...dependencies, "@gryt/ui": { Button: "Button" },
  "@gryt/voice": { useMicrophone: () => ({ transmissionState: { status: "ready" } }) },
  "../../../../lib/icons": { PiGameControllerFill: "GameIcon" },
  "../../../../lib/squadRuntime": { useSquadSnapshot: () => ({ status: "armed", heldCount: 0 }) },
  "../../../settings/src/components/squadSettings": { SquadStatusText: "SquadStatusText" },
  "./CallControlButton": { CallControlButton: "CallControlButton" },
  "./HoverAudioControl": { HoverAudioControl: "HoverAudioControl" },
});
const popover = Object.fromEntries(["Root", "Trigger", "Portal", "Positioner", "Popup", "Title", "Close"].map(name => [name, `Popover.${name}`]));
const { HoverAudioControl } = compile(componentPath("HoverAudioControl"), {
  ...dependencies, "@gryt/ui": { Button: "Button", IconButton: "IconButton", Popover: popover },
  "../../../../lib/icons": { PiCaretRightBold: "CaretIcon" },
});
let leveling = { available: true, enabled: true, runtime: "loading", setEnabled() {} };
const volumeChanges = [], muteChanges = [], toasts = [];
const { VoiceAudioControls } = compile(componentPath("VoiceAudioControls"), {
  ...dependencies, "@gryt/ui": { Button: "Button", Slider: "Slider" },
  "react-hot-toast": { default: text => toasts.push(text) },
  "@/lib/audioVolume": { MAX_VOLUME_PERCENT: 200 },
  "../../../../lib/icons": Object.fromEntries(["PiMicrophoneFill", "PiMicrophoneSlashFill", "PiSpeakerHighFill", "PiSpeakerSlashFill"].map(name => [name, name])),
  "./CallControlButton": { CallControlButton: "CallControlButton" },
  "./HoverAudioControl": { HoverAudioControl: "HoverAudioControl" },
  "./ReceiveLevelingAdapter": { useReceiveLeveling: () => leveling },
});
const check = (name, callback) => { callback(); checks++; console.log(`PASS ${name}`); };
settings = { inputMode: "push_to_talk", pushToTalkKey: "Ctrl+Mouse4", setInputMode: mode => modes.push(mode), openSettings: route => routes.push(route),
  squadConfig: { enabled: false, keys: ["KeyB", "KeyG", "KeyV"] }, setSquadConfig: next => squadSaves.push(next) };
check("PTT key control opens the page containing its binding, with a localized mouse label", () => {
  reset(); policy = undefined;
  const tree = render(VoiceModeControl);
  const button = nodes(tree).find(node => node.type === "button" && node.props.title);
  button.props.onClick(); assert.equal(routes.pop(), "hotkeys");
  assert.match(button.props.title, /鼠标/); assert.match(button.props["aria-label"], /鼠标/);
  assert.match(read("src/packages/settings/src/components/settings.tsx"), /value: "hotkeys"[^\n]*content: <HotkeySettings/);
  assert.match(read("src/packages/settings/src/components/hotkeySettings.tsx"), /anchorId="push-to-talk-key"/);
});
check("radio arrow keys change only mode and preserve the forced PTT boundary", () => {
  reset(); policy = { inputMode: "push_to_talk", requiredPushToTalk: true };
  const tree = render(VoiceModeControl), radios = nodes(tree).filter(node => node.props?.role === "radio");
  assert.equal(radios[0].props.disabled, true); assert.equal(radios[1].props.tabIndex, 0);
  let prevented = 0, focused = 0;
  radios[1].props.ref({ focus() { focused++; } });
  radios[1].props.onKeyDown({ key: "Home", preventDefault() { prevented++; } });
  assert.equal(modes.length, 0); assert.equal(focused, 0);
  radios[1].props.onKeyDown({ key: "End", preventDefault() { prevented++; } });
  assert.equal(modes.pop(), "push_to_talk"); assert.equal(focused, 1); assert.equal(prevented, 2);
  policy = undefined;
  render(VoiceModeControl).props.children[0].props.children[1].props.onKeyDown({ key: "ArrowLeft", preventDefault() {} });
  assert.equal(modes.pop(), "voice_activity");
});
check("Squad toggle preserves bindings and delegates a single settings entry to the key-list page", () => {
  const tree = render(SquadControl);
  tree.props.action.props.onClick();
  assert.equal(squadSaves[0].enabled, true); assert.equal(squadSaves[0].keys, settings.squadConfig.keys);
  assert.equal(tree.props.settingsTab, "voice");
  assert.equal(find(tree, "Button"), undefined, "shared popup owns the settings entry");
  assert.match(read("src/packages/settings/src/components/voiceSettings.tsx"), /<SquadSettings \/>/);
});
const hoverProps = { label: "音量", side: "top", action: jsx("Action", {}), children: jsx("Slider", {}) };
const group = tree => nodes(tree).find(node => node.props?.["data-gryt"] === "hover-audio-control");
const flush = delay => { const timers = [...scheduled.entries()].filter(([, timer]) => timer.delay === delay); assert.ok(timers.length); timers.forEach(([id, timer]) => { scheduled.delete(id); timer.callback(); }); };
check("hover timers keep the panel open during drag across the gap and close after release outside", () => {
  reset(); let tree = render(HoverAudioControl, hoverProps);
  group(tree).props.onPointerEnter({ pointerType: "mouse" }); flush(150);
  tree = render(HoverAudioControl, hoverProps); assert.equal(tree.props.open, true);
  const panel = find(tree, "Popover.Popup");
  panel.props.onPointerEnter({ pointerType: "mouse" }); group(tree).props.onPointerLeave(); flush(220);
  assert.equal(render(HoverAudioControl, hoverProps).props.open, true);
  panel.props.onPointerDownCapture({ pointerType: "mouse" }); panel.props.onPointerLeave({ pointerType: "mouse" }); flush(220);
  assert.equal(render(HoverAudioControl, hoverProps).props.open, true);
  listeners.get("pointerup")(); assert.equal(render(HoverAudioControl, hoverProps).props.open, false);
});
check("explicit keyboard opening returns focus, dismissal closes, settings navigation suppresses stale focus", () => {
  reset(); let tree = render(HoverAudioControl, { ...hoverProps, settingsTab: "voice" });
  tree.props.onOpenChange(true); tree = render(HoverAudioControl, { ...hoverProps, settingsTab: "voice" });
  assert.equal(find(tree, "Popover.Popup").props.finalFocus, find(tree, "Popover.Trigger").props.ref);
  listeners.get("pointerup")(); assert.equal(render(HoverAudioControl, hoverProps).props.open, true);
  tree.props.onOpenChange(false); assert.equal(render(HoverAudioControl, hoverProps).props.open, false);
  tree = render(HoverAudioControl, { ...hoverProps, settingsTab: "voice" }); tree.props.onOpenChange(true);
  tree = render(HoverAudioControl, { ...hoverProps, settingsTab: "voice" });
  assert.equal(find(tree, "Button").props.children, t("pureVoice.squadSettings"));
  find(tree, "Button").props.onClick(); assert.equal(routes.pop(), "voice");
  tree = render(HoverAudioControl, hoverProps); assert.equal(tree.props.open, false); assert.equal(find(tree, "Popover.Popup").props.finalFocus, false);
});
check("manual receive volume is independent of leveling and exposes its explanation to keyboard users", () => {
  reset(); policy = undefined;
  Object.assign(settings, { micVolume: 100, outputVolume: 50, isMuted: false, isDeafened: false,
    setMicVolume: value => volumeChanges.push(["mic", value]), setOutputVolume: value => volumeChanges.push(["output", value]),
    setIsMuted: value => muteChanges.push(value), setIsDeafened() {} });
  const tree = render(VoiceAudioControls, {}), controls = nodes(tree).filter(node => node.type === "HoverAudioControl");
  const receive = controls[1], slider = find(receive, "Slider");
  const description = nodes(receive).find(node => node.props?.id === slider.props["aria-describedby"]);
  assert.equal(description.props.children, t("receiveVolume.description"));
  slider.props.onValueChange(25); assert.deepEqual(volumeChanges.pop(), ["output", 25]);
  assert.equal(controls[2].props.action.props.state, "idle", "loading is not shown as active");
  assert.equal(controls[2].props.action.props["aria-pressed"], true);
  leveling = { ...leveling, runtime: "active" };
  assert.equal(nodes(render(VoiceAudioControls, {})).filter(node => node.type === "HoverAudioControl")[2].props.action.props.state, "live");
});
check("speak denial blocks the microphone button and appears in its volume popup", () => {
  reset(); policy = { canSpeak: false };
  const microphone = nodes(render(VoiceAudioControls, {})).find(node => node.type === "HoverAudioControl");
  microphone.props.action.props.onClick(); assert.equal(muteChanges.length, 0); assert.equal(toasts.pop(), t("pureVoice.speakDenied"));
  assert.ok(nodes(microphone).some(node => node.props?.role === "status" && node.props.children === t("pureVoice.speakDenied")));
});
check("collision constraints use the positioner's available height and retain scrolling/fullscreen portal", () => {
  reset(); const tree = render(HoverAudioControl, hoverProps);
  assert.equal(find(tree, "Popover.Positioner").props.collisionPadding, 8);
  assert.equal(find(tree, "Popover.Positioner").props.positionMethod, "fixed");
  assert.match(find(tree, "Popover.Popup").props.className, /overflow-y-auto/);
  assert.match(read("src/style.css"), /\[data-gryt="audio-control-popup"\]\s*\{\s*max-height: min\(var\(--available-height/);
  assert.match(read(componentPath("HoverAudioControl")), /fullscreenchange/);
});
check("rename is visible outside the account menu and reuses the existing focused nickname editor", () => {
  const source = read("src/components/sidebar.tsx");
  const button = source.slice(source.indexOf('<button type="button" data-gryt="edit-nickname"'), source.indexOf('<Menu.Root>', source.indexOf('data-gryt="edit-nickname"')));
  assert.match(button, /nicknameScope.renameShort/); assert.match(button, /profile\/profile\/nickname/); assert.match(button, /aria-label/);
  assert.match(read("src/packages/settings/src/components/settings.tsx"), /settingsTab !== "profile\/profile\/nickname"/);
});
check("pure voice surfaces have no retired media settings heading, camera or share entry", () => {
  assert.doesNotMatch(read("src/packages/settings/src/components/audioSettings.tsx"), /screenShareVariant|nativeAudioActive/);
  assert.doesNotMatch(read(componentPath("controls")), /useCamera|useScreenShare|ScreenShareControl|CameraControl/);
  assert.doesNotMatch(read("src/packages/socket/src/components/VoiceView.tsx"), /useCamera|useScreenShare|<video/);
  assert.match(read("src/packages/settings/src/hooks/useAudioSettings.ts"), /autoGainEnabled: false/);
});
check("English and Chinese copy preserves the post-leveling manual-volume explanation and fallback", () => {
  for (const locale of Object.values(locales)) {
    for (const key of ["nicknameScope.renameShort", "voiceAudio.levelingDescription", "receiveVolume.description", "receiveLeveling.description"]) assert.ok(lookup(locale, key)?.trim());
    assert.doesNotMatch(locale.receiveVolume.description + locale.receiveLeveling.description, /screen|屏幕/i);
  }
  assert.match(locales.en.receiveVolume.description, /after automatic leveling/);
  assert.match(locales.en.receiveLeveling.description, /not automatically compensated/);
  assert.match(locales["zh-CN"].receiveVolume.description, /之后/);
  assert.match(locales["zh-CN"].receiveLeveling.description, /不会自动补回来/);
  language = "en"; reset(); policy = undefined;
  assert.equal(nodes(render(VoiceModeControl)).find(node => node.props?.title).props.title, "Ctrl + Mouse 4");
  assert.match(read("src/packages/i18n/index.ts"), /fallbackLng: "en"/);
});
check("all edited TSX sources transpile without syntax errors", () => {
  for (const path of ["src/components/sidebar.tsx", "src/packages/settings/src/components/audioSettings.tsx",
    ...["VoiceModeControl", "SquadControl", "HoverAudioControl", "VoiceAudioControls"].map(componentPath)]) {
    const result = ts.transpileModule(read(path), { reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } });
    assert.deepEqual(result.diagnostics?.filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error), [], path);
  }
});
console.log(`${checks} UI component/source scenarios passed; no real React DOM, browser, helper, profile, audio or network.`);

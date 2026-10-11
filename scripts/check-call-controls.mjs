/* eslint-env node */

/**
 * Every layout that drops the voice panel still offers a way out of the call.
 * A source check, because the failure is a branch that renders one element too few.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const serverView = read("../src/packages/socket/src/components/serverView.tsx");
const mobileView = read("../src/packages/socket/src/components/MobileServerView.tsx");
const sheetButton = read("../src/packages/socket/src/components/VoiceSheetButton.tsx");

/* ── Both narrow layouts wire it up ─────────────────────────────────── */

assert.match(
  mobileView,
  /<VoiceSheetButton\b/,
  "the phone layout must render VoiceSheetButton — without it a call below 768 has no controls",
);

assert.match(
  serverView,
  /<VoiceSheetButton\b/,
  "the tiny window must render VoiceSheetButton — without it a call below 520 has no controls",
);

// It has to sit in the tiny branch specifically. A button landing in the phone or
// full layout would satisfy the check above and leave the tiny window broken.
const tinyBranch = serverView.slice(
  serverView.indexOf("{isTiny ? ("),
  serverView.indexOf(") : isMobile ? ("),
);
assert.ok(
  tinyBranch.length > 0,
  "could not find the tiny branch in serverView — this check needs rewriting against the new shape",
);
assert.match(
  tinyBranch,
  /<VoiceSheetButton\b/,
  "VoiceSheetButton is in serverView but not in the tiny branch",
);

/* ── One component, not two ─────────────────────────────────────────── */

// The chat is shared between these layouts for the same reason: a second copy is
// a second copy to keep in step.
for (const [name, source] of [
  ["serverView", serverView],
  ["MobileServerView", mobileView],
]) {
  assert.doesNotMatch(
    source,
    /aria-label="Leave voice channel"/,
    `${name} draws its own leave control — it should be going through VoiceSheetButton`,
  );
}

/* ── The button is gated on actually being in a call ────────────────── */

// Evaluate the actual participant popover without DOM, capture or Electron.
// Check disconnected hiding and connected reachability in both locales.
for (const language of ["en", "zh-CN"]) {
  const dictionary = JSON.parse(read(`../src/packages/i18n/locales/${language}.json`));
  const translate = key => key.split(".").reduce((value, part) => value?.[part], dictionary);
  const module = { exports: {} };
  const element = (type, props) => ({ type, props: props ?? {} });
  const code = ts.transpileModule(sheetButton, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  runInNewContext(code, { module, exports: module.exports, require(name) {
    if (name === "react/jsx-runtime") return { jsx: element, jsxs: element };
    if (name === "@gryt/ui") return { IconButton: "IconButton", Popover: Object.fromEntries(
      ["Root", "Trigger", "Portal", "Positioner", "Popup", "Title"].map(key => [key, `Popover.${key}`])) };
    if (name === "@/i18n") return { useTranslation: () => ({ t: translate }) };
    if (name.endsWith("lib/icons")) return { PiUsersFill: "PiUsersFill" };
    if (name === "./VoiceView") return { VoiceView: "VoiceView" };
    throw Error(`Unexpected component dependency: ${name}`);
  } });
  const render = module.exports.VoiceSheetButton;
  assert.equal(render({ connected: false }), null);
  const nodes = [];
  function visit(value) {
    if (!value || typeof value !== "object") return;
    if (value.type) nodes.push(value);
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) child.forEach(visit);
      else visit(child);
    }
  }
  visit(render({ connected: true, serverHost: "synthetic.invalid" }));
  const label = translate("pureVoice.participants");
  assert.ok(typeof label === "string" && label.length > 0);
  assert.ok(nodes.some(node => node.type === "IconButton" && node.props["aria-label"] === label));
  assert.ok(nodes.some(node => node.type === "VoiceView" && node.props.showVoiceView === true));
}

console.log("check-call-controls: ok");

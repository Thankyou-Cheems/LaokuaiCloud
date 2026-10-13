/* eslint-env node */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import { kirilieTheme, kirilieThemeVariables, readThemeStyle, resolveDisplayedTheme } from "../src/lib/kirilieTheme.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// Check the production JSX, not just a fixture selector: artwork belongs on
// all four message-history states, never on the composer or a new overlay.
const chatSource = readFileSync(join(root, "src/packages/socket/src/components/ChatView.tsx"), "utf8");
const chatAst = ts.createSourceFile("ChatView.tsx", chatSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const historyNodes = [];
const visit = node => {
  if (ts.isJsxOpeningElement(node)) {
    const attr = name => node.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(chatAst) === name)?.initializer;
    if (attr("data-gryt")?.text === "chat-history") historyNodes.push(node);
  }
  ts.forEachChild(node, visit);
};
visit(chatAst);
assert.equal(historyNodes.length, 4, "disabled, loading, empty and populated history share the artwork hook");
assert.ok(historyNodes.some(node => node.getText(chatAst).includes('className="chat-scroll-container"')), "actual scrolling message viewport carries the artwork hook");
for (const node of historyNodes) {
  assert.equal(node.tagName.getText(chatAst), "div");
  assert.ok(!node.getText(chatAst).includes("background:"), "history inline fills would hide the artwork");
}
const original = { name: "Preserved original" }, draft = { name: "Editor preview" };
for (const appearance of ["light", "dark"]) {
  assert.deepEqual(resolveDisplayedTheme("kirilie", appearance, original, null), { handDrawn: true, appearance: "light", theme: kirilieTheme });
  assert.deepEqual(resolveDisplayedTheme("original", appearance, original, null), { handDrawn: false, appearance, theme: original });
  assert.deepEqual(resolveDisplayedTheme("original", appearance, null, null), { handDrawn: false, appearance, theme: null });
  assert.deepEqual(resolveDisplayedTheme("kirilie", appearance, original, draft), { handDrawn: false, appearance, theme: draft });
}

// Execute the actual preference hook with a minimal deterministic React state
// host. It never mounts the app or runs network/native/media hooks.
const source = readFileSync(join(root, "src/packages/common/src/hooks/useTheme.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const preserved = {
  "theme.appearancePreference": "dark", "theme.accentColor": "violet", "theme.grayColor": "slate",
  "theme.radius": "full", "theme.custom.active": "preset:fixture-original",
  "theme.custom.themes": "fixture-original-library", "theme.uiScale": "1.25",
  "layout.sidebarWidth": "217",
};
for (const saved of [undefined, "original", "kirilie", "invalid"]) {
  const store = new Map(Object.entries({ ...preserved, ...(saved ? { "theme.style": saved } : {}) }));
  const storage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  let slot = 0;
  const states = [];
  const react = {
    useState: initial => {
      const index = slot++;
      if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
      return [states[index], next => { states[index] = typeof next === "function" ? next(states[index]) : next; }];
    },
    useCallback: fn => fn, useEffect: () => {}, useMemo: fn => fn(),
  };
  const exports = {};
  new Function("require", "exports", "localStorage", "window", compiled)(name => {
    if (name === "react") return react;
    if (name === "./singletonHook") return { singletonHook: (_initial, body) => body };
    if (name.endsWith("/kirilieTheme")) return { readThemeStyle };
    throw Error(`Unexpected hook dependency ${name}`);
  }, exports, storage, { matchMedia: () => ({ matches: true }) });
  const render = () => { slot = 0; return exports.useTheme(); };
  let settings = render();
  assert.equal(settings.themeStyle, saved === "original" ? "original" : "kirilie");
  for (const style of ["original", "kirilie", "original", "kirilie"]) {
    settings.setThemeStyle(style);
    settings = render();
    assert.equal(settings.themeStyle, style);
    assert.equal(readThemeStyle(storage), style, "choice survives the next startup read");
    assert.equal(settings.appearancePreference, "dark");
    assert.equal(settings.uiScale, 1.25);
    for (const [key, value] of Object.entries(preserved)) assert.equal(store.get(key), value, `switch rewrote ${key}`);
  }
}

const variables = kirilieThemeVariables();
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const luminance = hex => {
  assert.match(hex, /^#[0-9a-f]{6}$/i);
  const [r, g, b] = rgb(hex).map(value => {
    const c = value / 255;
    return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
  });
  return .2126 * r + .7152 * g + .0722 * b;
};
const reports = [];
for (const [label, foreground, background] of [
  ["body", "text", "surface"], ["muted", "muted", "surface-raised"],
  ["accent link", "accent-11", "surface"], ["selected text", "accent-11", "accent-3"],
  ["primary action", "on-accent", "accent"], ["secondary action", "on-secondary", "secondary"],
  ["danger action", "on-danger", "danger"], ["danger hover", "on-danger", "danger-light"],
  ["danger notice", "danger-11", "danger-3"], ["warning notice", "warning-11", "warning-3"],
  ["success notice", "success-11", "success-3"], ["unread", "on-unread", "unread"],
]) {
  const a = luminance(variables[`--gryt-${foreground}`]), b = luminance(variables[`--gryt-${background}`]);
  const ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  assert.ok(ratio >= 4.5, `${label} contrast ${ratio.toFixed(2)} is below 4.5:1`);
  reports.push(`${label} ${ratio.toFixed(2)}:1`);
}
// Conservative full-opacity SVG colours beneath the actual 75% paper wash,
// including the darker texture stripe. SVG's own alpha only lightens these.
const chatCss = readFileSync(join(root, "src/styles/kirilie.css"), "utf8");
assert.match(chatCss, /linear-gradient\(rgb\(255 253 244 \/ 75%\), rgb\(255 253 244 \/ 75%\)\)/);
const chatMuted = chatCss.match(/--kirilie-chat-muted:\s*(#[0-9a-f]{6})/i)?.[1];
assert.ok(chatMuted, "history secondary ink is calibrated for the artwork");
const garden = readFileSync(join(root, "src/assets/kirilie-garden.svg"), "utf8");
let minimumChatContrast = Infinity;
for (const color of new Set(garden.match(/#[0-9a-f]{6}/gi))) {
  const base = rgb(color), wash = rgb("#fffdf4"), pencil = rgb("#988f69");
  const backdrop = "#" + base.map((value, i) => Math.round((value * .25 + wash[i] * .75) * .972 + pencil[i] * .028).toString(16).padStart(2, "0")).join("");
  for (const foreground of ["text", "muted", "accent-11"]) {
    const a = luminance(foreground === "muted" ? chatMuted : variables[`--gryt-${foreground}`]), b = luminance(backdrop);
    const ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    assert.ok(ratio >= 4.5, `${foreground} over washed garden ${color}: ${ratio.toFixed(2)}:1`);
    minimumChatContrast = Math.min(minimumChatContrast, ratio);
  }
}
for (const family of ["neutral", "accent", "secondary", "success", "danger", "warning"]) {
  for (let step = 1; step <= 12; step++) {
    assert.equal(variables[`--gryt-${family}-${step}`], variables[`--color-gryt-${family}-${step}`], "CSS and Tailwind tokens differ");
  }
}
console.log(`Kirilie pure checks PASS: default/restore/editor, preference preservation, token parity, 12 contrast pairs, four production history hooks and washed garden ink contrast >= ${minimumChatContrast.toFixed(2)}:1. No visual/product/network acceptance.`);
console.log(reports.join(", "));

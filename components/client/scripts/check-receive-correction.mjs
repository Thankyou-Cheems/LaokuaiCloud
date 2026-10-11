/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire, stripTypeScriptTypes } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const root = process.argv[2] || fileURLToPath(new URL("../", import.meta.url));
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const toModuleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const modelUrl = toModuleUrl(stripTypeScriptTypes(read("src/lib/receiveCorrection.ts")));
const model = await import(modelUrl);
const require = createRequire(import.meta.url);
const componentCode = ts.transpileModule(read("src/packages/socket/src/components/ReceiveCorrectionRing.tsx"), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
}).outputText.replaceAll('"../../../../lib/receiveCorrection"', JSON.stringify(modelUrl))
  .replaceAll('"@gryt/ui/tooltip"', JSON.stringify(import.meta.resolve("@gryt/ui/tooltip")))
  .replaceAll('"react/jsx-runtime"', JSON.stringify(pathToFileURL(require.resolve("react/jsx-runtime")).href));
const { ReceiveCorrectionRing } = await import(toModuleUrl(componentCode));
const render = props => renderToStaticMarkup(createElement(ReceiveCorrectionRing, props));
let checks = 0;
const check = (name, run) => { run(); ++checks; console.log(`PASS ${name}`); };

check("missing route supplies no fabricated telemetry and is immutable", () => {
  assert.deepEqual(model.readReceiveCorrection(), { learnedAutoGainDb: null, appliedAutoGainDb: null, state: "unknown" });
  assert.ok(Object.isFrozen(model.readReceiveCorrection()));
});
check("formatter preserves signed actual measurements, zero and boundaries", () => {
  for (const [input, expected] of [[3.2, "+3.2 dB"], [-3.2, "-3.2 dB"], [9, "+9.0 dB"], [-9, "-9.0 dB"], [0, "0.0 dB"], [-0, "0.0 dB"], [-0.01, "0.0 dB"], [15, "+15.0 dB"]]) {
    assert.equal(model.formatCorrectionDb(input), expected);
  }
});
check("missing and non-finite measurements remain unknown without coercion", () => {
  for (const input of [undefined, null, NaN, Infinity, -Infinity, "3.2"]) {
    assert.equal(model.formatCorrectionDb(input), "Not measured");
    assert.equal(model.formatCorrectionDb(input, "尚未测量"), "尚未测量");
    assert.equal(model.correctionArcPercent(input), 0);
  }
});
check("visual scale saturates at the documented limits without changing reported gain", () => {
  assert.equal(model.correctionArcPercent(0), 0);
  assert.equal(model.correctionArcPercent(9), 50);
  assert.equal(model.correctionArcPercent(-6), 50);
  assert.equal(model.correctionArcPercent(-12), 100);
  assert.equal(model.correctionArcPercent(18), 100);
  assert.equal(model.correctionArcPercent(25), 100);
  assert.match(render({ learnedAutoGainDb: 15, appliedAutoGainDb: 9, state: "limited" }), /\+15\.0 dB/);
});
check("real component defaults to accessible static unknown without zero claims", () => {
  const html = render({});
  assert.match(html, /data-receive-correction="unknown"/);
  assert.match(html, /tabindex="0"/);
  assert.match(html, /aria-label="Long-term correction: Not measured; Currently applied: Not measured;/);
  assert.match(html, /title="Long-term correction: Not measured;/);
  assert.doesNotMatch(html, /0\.0 dB|animate-|animation:/);
  assert.equal((html.match(/opacity="0"/g) || []).length, 2);
});
check("boost and attenuation use opposite arcs and explicit direction symbols", () => {
  const boost = render({ learnedAutoGainDb: 3.2, appliedAutoGainDb: 2.4, state: "learning" });
  const attenuation = render({ learnedAutoGainDb: -3.2, appliedAutoGainDb: -2.4, state: "stable" });
  assert.match(boost, /data-receive-correction="boost"/);
  assert.match(boost, />\+<\/text>/);
  assert.match(attenuation, /data-receive-correction="attenuation"/);
  assert.match(attenuation, />−<\/text>/);
  assert.match(boost, /Currently applied: \+2\.4 dB/);
  assert.match(attenuation, /Currently applied: -2\.4 dB/);
});
check("pause changes applied detail while learned ring remains identical", () => {
  const speaking = render({ learnedAutoGainDb: 3.2, appliedAutoGainDb: 3.2, state: "stable" });
  const paused = render({ learnedAutoGainDb: 3.2, appliedAutoGainDb: 0, state: "stable" });
  assert.equal(speaking.match(/<svg[\s\S]*?<\/svg>/)[0], paused.match(/<svg[\s\S]*?<\/svg>/)[0]);
  assert.match(paused, /Long-term correction: \+3\.2 dB; Currently applied: 0\.0 dB/);
});
check("learned and applied missingness remain independent", () => {
  const learnedOnly = render({ learnedAutoGainDb: -3.2, state: "stable" });
  assert.match(learnedOnly, /Currently applied: Not measured/);
  assert.match(learnedOnly, /data-receive-correction="attenuation"/);
  const appliedOnly = render({ appliedAutoGainDb: 3.2, state: "learning" });
  assert.match(appliedOnly, /Long-term correction: Not measured; Currently applied: \+3\.2 dB/);
  assert.match(appliedOnly, /data-receive-correction="unknown"/);
});
check("state, localization, focus target and reduced motion are exposed", () => {
  for (const state of ["unknown", "learning", "stable", "limited"]) {
    const html = render({ state, labels: model.RECEIVE_CORRECTION_LABELS_ZH });
    assert.match(html, new RegExp(`状态: ${model.RECEIVE_CORRECTION_LABELS_ZH[state]}`));
    assert.match(html, /长期校正: 尚未测量; 当前应用: 尚未测量/);
    assert.match(html, /tabindex="0"/);
    assert.match(html, /motion-reduce:transition-none/);
    assert.match(html, /仅自动增益，不含手动音量和压缩器减益/);
  }
});
console.log(`${checks} receive correction checks passed; display tests only, no DSP or physical-call validation.`);

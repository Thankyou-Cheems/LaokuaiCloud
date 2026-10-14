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
  assert.match(html, /aria-label="Loudness balance; Learned compensation: Not measured; Currently applied: Not measured;/);
  assert.match(html, /title="Loudness balance; Learned compensation: Not measured;/);
  assert.doesNotMatch(html, /0\.0 dB|animate-|animation:/);
  assert.equal((html.match(/opacity="0"/g) || []).length, 1);
  assert.match(html, /data-correction-bar="learned"/);
});
check("boost and attenuation use opposite bar halves and explicit direction text", () => {
  const boost = render({ learnedAutoGainDb: 3.2, appliedAutoGainDb: 2.4, state: "learning" });
  const attenuation = render({ learnedAutoGainDb: -3.2, appliedAutoGainDb: -2.4, state: "stable" });
  assert.match(boost, /data-receive-correction="boost"/);
  assert.match(boost, />Increase<\/span>/);
  assert.match(attenuation, /data-receive-correction="attenuation"/);
  assert.match(attenuation, />Decrease<\/span>/);
  assert.ok(Number(boost.match(/d="M72 6 H([^\"]+)"/)[1]) > 72);
  assert.ok(Number(attenuation.match(/d="M72 6 H([^\"]+)"/)[1]) < 72);
  assert.match(boost, /Currently applied: \+2\.4 dB/);
  assert.match(attenuation, /Currently applied: -2\.4 dB/);
});
check("pause changes applied detail while learned ring remains identical", () => {
  const speaking = render({ learnedAutoGainDb: 3.2, appliedAutoGainDb: 3.2, state: "stable" });
  const paused = render({ learnedAutoGainDb: 3.2, appliedAutoGainDb: 0, state: "stable" });
  assert.equal(speaking.match(/<svg[\s\S]*?<\/svg>/)[0], paused.match(/<svg[\s\S]*?<\/svg>/)[0]);
  assert.match(paused, /Learned compensation: \+3\.2 dB; Currently applied: 0\.0 dB/);
});
check("learned and applied missingness remain independent", () => {
  const learnedOnly = render({ learnedAutoGainDb: -3.2, state: "stable" });
  assert.match(learnedOnly, /Currently applied: Not measured/);
  assert.match(learnedOnly, /data-receive-correction="attenuation"/);
  const appliedOnly = render({ appliedAutoGainDb: 3.2, state: "learning" });
  assert.match(appliedOnly, /Learned compensation: Not measured; Currently applied: \+3\.2 dB/);
  assert.match(appliedOnly, /data-receive-correction="unknown"/);
});
check("state, localization, focus target and reduced motion are exposed", () => {
  for (const state of ["unknown", "learning", "stable", "limited"]) {
    const html = render({ state, labels: model.RECEIVE_CORRECTION_LABELS_ZH });
    assert.match(html, new RegExp(`状态: ${model.RECEIVE_CORRECTION_LABELS_ZH[state]}`));
    assert.match(html, /已学习补偿: 尚未测量; 当前应用: 尚未测量/);
    assert.match(html, /tabindex="0"/);
    assert.doesNotMatch(html, /animate-|animation:|transition-/);
    assert.match(html, /仅自动增益，不含手动音量和压缩器减益/);
  }
});
const measured = { learnedAutoGainDb: 3.2, appliedAutoGainDb: 3.2, status: "settled", speechLevelDbfs: -23.2,
  priorRestoring: false, audioTimeSeconds: 10, lastAcceptedSpeechAudioTimeSeconds: 10 };
check("initial analyzer zeros do not become measured neutral, even with a limit reason", () => {
  for (const status of ["learning", "limited"]) {
    const snapshot = model.receiveCorrectionFromMeasurement({ ...measured, status, speechLevelDbfs: null, learnedAutoGainDb: 0, appliedAutoGainDb: 0 });
    assert.equal(snapshot.learnedAutoGainDb, null);
    assert.equal(snapshot.appliedAutoGainDb, null);
    const html = render(snapshot);
    assert.doesNotMatch(html, /0\.0 dB|No compensation/);
    assert.match(html, /data-receive-correction="unknown"/);
  }
});
check("unavailable measurements cannot expose stale gains as current", () => {
  const snapshot = model.receiveCorrectionFromMeasurement({ ...measured, status: "unavailable" });
  assert.equal(snapshot.state, "unknown");
  assert.equal(snapshot.learnedAutoGainDb, null);
  assert.equal(snapshot.appliedAutoGainDb, null);
  const disabled = model.receiveCorrectionFromMeasurement({ ...measured, status: "unavailable", limitReasons: ["disabled"] });
  const html = render(disabled);
  assert.match(html, />Disabled<\/span>/);
  assert.match(html, /manual volume still applies independently/);
  assert.doesNotMatch(html, /Waiting for speech|0\.0 dB/);
});
check("provisional zero is visibly learning and established zero is visibly no compensation", () => {
  const provisional = render({ learnedAutoGainDb: 0, appliedAutoGainDb: 0, state: "learning" });
  assert.match(provisional, />Learning<\/span>/);
  assert.doesNotMatch(provisional, />No compensation<\/span>|>0\.0 dB<\/span>/);
  const stable = render({ learnedAutoGainDb: 0, appliedAutoGainDb: 0, state: "stable" });
  assert.match(stable, />No compensation<\/span>/);
  assert.match(stable, />0\.0 dB<\/span>/);
  assert.equal(model.correctionDirection(-0.01), "neutral");
});
check("speech pauses preserve learned compensation and expose waiting instead of a neutral claim", () => {
  const snapshot = model.receiveCorrectionFromMeasurement({ ...measured, appliedAutoGainDb: 0, audioTimeSeconds: 11 });
  assert.equal(snapshot.waitingForSpeech, true);
  const html = render(snapshot);
  assert.match(html, />Increase<\/span>/);
  assert.match(html, />\+3\.2 dB<\/span>/);
  assert.match(html, /data-correction-status="true">Waiting for speech/);
  assert.match(html, /Currently applied: 0\.0 dB/);
  assert.doesNotMatch(html, />No compensation<\/span>/);
  assert.equal(model.receiveCorrectionFromMeasurement({ ...measured, learnedAutoGainDb: -3.2, audioTimeSeconds: 11 }).waitingForSpeech, false);
});
check("restored priors retain their actual learned value before new speech measurements", () => {
  const snapshot = model.receiveCorrectionFromMeasurement({ ...measured, status: "learning", speechLevelDbfs: null, priorRestoring: true });
  assert.equal(snapshot.learnedAutoGainDb, 3.2);
  assert.match(render(snapshot), />\+3\.2 dB<\/span>/);
});
check("compact and full displays expose actual dB, state and limitations without editable volume", () => {
  for (const compact of [true, false]) {
    const html = render({ ...model.receiveCorrectionFromMeasurement(measured), compact, state: "limited", diagnostic: "Noise limits the boost" });
    assert.match(html, />\+3\.2 dB<\/span>/);
    assert.match(html, /Noise limits the boost/);
    assert.match(html, /data-correction-status="true">Limited/);
    assert.doesNotMatch(html, /type="range"|role="slider"|aria-valuenow/);
  }
  assert.doesNotMatch(render({ learnedAutoGainDb: 0, state: "limited" }), />No compensation<\/span>/);
});
console.log(`${checks} receive correction checks passed; display tests only, no DSP or physical-call validation.`);

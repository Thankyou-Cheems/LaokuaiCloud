import assert from "node:assert/strict";
import fs from "node:fs";
import { stripTypeScriptTypes } from "node:module";

const file = new URL("../src/packages/lib/receiveAudio.ts", import.meta.url);
const { applyReceiveAudioRoles } = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(fs.readFileSync(file, "utf8"))).toString("base64")}`);
let checks = 0;
for (const ids of [["mic", "alias"], ["alias", "mic"], ["screen", "mic"], ["mic", "screen"]]) {
  let actual;
  let changes = 0;
  const control = { setRole: role => { actual = role; changes++; } };
  const sources = Object.fromEntries(ids.map(id => [id, { receiveCleanup: control }]));
  applyReceiveAudioRoles(sources, [{ streamID: "mic", screenShareAudioStreamID: "screen" }]);
  assert.equal(actual, ids.includes("screen") ? "screen" : "microphone", ids.join(","));
  assert.equal(changes, 1, "shared control receives one resolved role");
  checks++;
}
let actual;
const replacement = { setRole: role => { actual = role; } };
applyReceiveAudioRoles({ late: { receiveCleanup: replacement }, absent: {} }, []);
assert.equal(actual, "unknown"); checks++;
applyReceiveAudioRoles({ late: { receiveCleanup: replacement } }, [{ streamID: "late" }]);
assert.equal(actual, "microphone"); checks++;
applyReceiveAudioRoles({ late: { receiveCleanup: replacement } }, [{ streamID: "late", screenShareAudioStreamID: "late" }]);
assert.equal(actual, "screen"); checks++;
applyReceiveAudioRoles({ late: { receiveCleanup: replacement } }, []);
assert.equal(actual, "unknown"); checks++;
console.log(`${checks} receive alias role checks passed`);

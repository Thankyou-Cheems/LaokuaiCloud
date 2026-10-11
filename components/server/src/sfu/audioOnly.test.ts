import { test } from "node:test";
import assert from "node:assert/strict";
import { enforceAudioOnly } from "./audioOnly";
test("audio-only is opt-in and removes sharing even from legacy Doctor grants", () => {
 const previous=process.env.VOICE_AUDIO_ONLY;
 try {
  delete process.env.VOICE_AUDIO_ONLY;
  assert.deepEqual(enforceAudioOnly(["speak","share_video","share_screen"]),["speak","share_video","share_screen"]);
  process.env.VOICE_AUDIO_ONLY="true";
  assert.deepEqual(enforceAudioOnly(["speak"]),["speak","video_checked"]);
  assert.deepEqual(enforceAudioOnly(["speak","share_video","share_screen","app_socket:synthetic"]),["speak","app_socket:synthetic","video_checked"]);
 } finally { if(previous===undefined) delete process.env.VOICE_AUDIO_ONLY; else process.env.VOICE_AUDIO_ONLY=previous; }
});

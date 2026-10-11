import { test } from "node:test";
import assert from "node:assert/strict";
import { setVoiceMoveCapabilitySource, voiceAtomicMoveEnabled } from "./voiceMoveCapability";
test("server move capability requires explicit policy opt-in and confirmed SFU support",async()=>{
 const previous=process.env.VOICE_ATOMIC_MOVE_ENABLED;let probes=0,supported=false;
 setVoiceMoveCapabilitySource({async supportsAtomicMove(){probes++;return supported}});
 try {
  delete process.env.VOICE_ATOMIC_MOVE_ENABLED;assert.equal(await voiceAtomicMoveEnabled(),false);assert.equal(probes,0);
  process.env.VOICE_ATOMIC_MOVE_ENABLED="true";assert.equal(await voiceAtomicMoveEnabled(),false);
  supported=true;assert.equal(await voiceAtomicMoveEnabled(),true);
 } finally {if(previous===undefined) delete process.env.VOICE_ATOMIC_MOVE_ENABLED;else process.env.VOICE_ATOMIC_MOVE_ENABLED=previous;}
});

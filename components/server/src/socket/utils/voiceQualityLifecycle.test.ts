import { test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "socket.io";
import type { Clients } from "../../types";
import { retainVoiceQuality, reconcileVoiceQuality, clearUserVoiceQuality, disposeVoiceQuality } from "./voiceQualityLifecycle";
test("quality lifecycle clears on authoritative move/media replacement/leave and disposes once", () => {
 const io={} as Server;const clients={s:{serverUserId:"u",grytUserId:"g",accessToken:"synthetic",hasJoinedChannel:true,voiceChannelId:"old",streamID:"pc1"}} as unknown as Clients;
 let cleared=0,disposed=0;
 retainVoiceQuality(io,"s",clients,{handlers:{},clear(){cleared++},dispose(){disposed++}});
 reconcileVoiceQuality(io,clients);assert.equal(cleared,0);
 clients.s.voiceChannelId="new";reconcileVoiceQuality(io,clients);assert.equal(cleared,1);
 clients.s.streamID="pc2";reconcileVoiceQuality(io,clients);assert.equal(cleared,2);
 clearUserVoiceQuality(io,"u");assert.equal(cleared,3);
 clients.s.hasJoinedChannel=false;reconcileVoiceQuality(io,clients);assert.equal(cleared,4);
 disposeVoiceQuality(io,"s");disposeVoiceQuality(io,"s");assert.equal(disposed,1);
 delete clients.s;reconcileVoiceQuality(io,clients);assert.equal(cleared,4);
});

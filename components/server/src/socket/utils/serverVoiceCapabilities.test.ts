import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import type { Socket } from "socket.io";

import { initSqlite, getSqliteDb } from "../../db/sqlite/connection";
import { upsertServerChannel } from "../../db/sqlite/channels";
import { createServerConfigIfNotExists, setServerRole } from "../../db/sqlite/servers";
import { upsertUser } from "../../db/sqlite/users";
import type { Clients } from "../../types";
import { setVoiceMoveCapabilitySource } from "./voiceMoveCapability";

const envKeys = ["DATA_DIR", "SFU_PUBLIC_HOST", "SFU_WS_HOST", "NATIVE_LAN_VOICE_ENABLED",
  "VOICE_ATOMIC_MOVE_ENABLED", "VOICE_AUDIO_ONLY"] as const;
const originalEnv = new Map(envKeys.map(key => [key, process.env[key]]));
const capabilityKeys = ["voice_enabled", "voice_atomic_move_enabled", "voice_audio_only",
  "nativeLanVoice", "native_lan_voice_enabled", "nativeLanVoiceProtocol"] as const;
type Payload = Record<string, unknown>;
type Details = Payload & { server_info: Payload; channels: { id: string; canJoin: boolean }[] };
let server: typeof import("./server");
let dir: string;
let clients: Clients;
const socketId = "synthetic-member";

before(async () => {
  // SFU configuration is read at module load: this is the native-only host
  // that rejected the desktop even while its public advertisement was enabled.
  delete process.env.SFU_PUBLIC_HOST;
  delete process.env.SFU_WS_HOST;
  dir = mkdtempSync(join(tmpdir(), "gryt-voice-capabilities-"));
  process.env.DATA_DIR = dir;
  await initSqlite();
  await createServerConfigIfNotExists();
  const member = await upsertUser("synthetic-account", "Synthetic member");
  await setServerRole(member.server_user_id, "member");
  for (const [position, channelId] of ["room", "destination"].entries()) {
    await upsertServerChannel({ channelId, name: channelId, type: "voice", position });
  }
  clients = { [socketId]: {
    serverUserId: member.server_user_id, grytUserId: "synthetic-account", nickname: "Synthetic member",
    color: "#fff", isMuted: false, isDeafened: false, streamID: "", hasJoinedChannel: false,
    voiceChannelId: "", isAFK: false, cameraEnabled: false, cameraStreamID: "", screenShareEnabled: false,
    screenShareVideoStreamID: "", screenShareAudioStreamID: "", isServerMuted: false, isServerDeafened: false,
  } };
  server = await import("./server");
});

beforeEach(() => {
  delete process.env.NATIVE_LAN_VOICE_ENABLED;
  delete process.env.VOICE_ATOMIC_MOVE_ENABLED;
  delete process.env.VOICE_AUDIO_ONLY;
  setVoiceMoveCapabilitySource({ supportsAtomicMove: async () => false });
});

after(() => {
  getSqliteDb().close();
  for (const key of envKeys) {
    const value = originalEnv.get(key);
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  rmSync(dir, { recursive: true, force: true });
});

async function announcements(member = true) {
  const emitted = new Map<string, Payload>();
  const socket = { id: socketId, emit(event: string, payload: Payload) {
    emitted.set(event, payload); return true;
  } } as unknown as Socket;
  const connected = member ? clients : {};
  await server.sendInfo(socket, connected, "server");
  await server.sendServerDetails(socket, connected, "server");
  return { info: emitted.get("server:info")!, details: emitted.get("server:details")! as Details };
}

function capabilities(payload: Payload) {
  return Object.fromEntries(capabilityKeys.map(key => [key, payload[key]]));
}

function expected(native: boolean, move = false, audioOnly = false) {
  return { voice_enabled: native, voice_atomic_move_enabled: native || move,
    voice_audio_only: native || audioOnly, nativeLanVoice: native, native_lan_voice_enabled: native,
    nativeLanVoiceProtocol: native ? 1 : null };
}

describe("voice capabilities through actual public info and authenticated server details", () => {
  it("keeps native voice usable after member details arrive with no SFU configured", async () => {
    process.env.NATIVE_LAN_VOICE_ENABLED = "true";
    const { info, details } = await announcements();
    // Optional private, synthetic fixture lets the real desktop provider consume
    // the backend's emitted details without duplicating a capability object.
    const fixturePath = process.env.LAOKUAI_NATIVE_CAPABILITY_FIXTURE;
    if (fixturePath) {
      mkdirSync(dirname(fixturePath), { recursive: true });
      writeFileSync(fixturePath, JSON.stringify(details, null, 2) + "\n", "utf8");
    }
    assert.equal(details.error, undefined);
    assert.equal(details.server_info.is_owner, false);
    assert.deepEqual(details.channels.map(channel => [channel.id, channel.canJoin]), [["room", true], ["destination", true]]);
    assert.equal(info.native_lan_voice_enabled, true, "public probe already advertises native voice");
    assert.equal(details.server_info.native_lan_voice_enabled, true,
      "member details must enable native voice at the desktop provider's actual gate");
    assert.deepEqual(capabilities(details.server_info), expected(true));
    assert.deepEqual(capabilities(info), expected(true));
    assert.deepEqual(details.sfu_hosts, []);
  });

  for (const flag of [undefined, "false", "TRUE"]) {
    it(`does not enable native mode for ${String(flag)} configuration`, async () => {
      if (flag !== undefined) process.env.NATIVE_LAN_VOICE_ENABLED = flag;
      const { info, details } = await announcements();
      assert.deepEqual(capabilities(info), expected(false));
      assert.deepEqual(capabilities(details.server_info), expected(false));
    });
  }

  it("preserves the legacy atomic move opt-in and SFU support checks", async () => {
    for (const [flag, supported, enabled] of [["true", true, true], ["true", false, false], ["false", true, false]] as const) {
      process.env.VOICE_ATOMIC_MOVE_ENABLED = flag;
      setVoiceMoveCapabilitySource({ supportsAtomicMove: async () => supported });
      const { info, details } = await announcements();
      assert.deepEqual(capabilities(info), expected(false, enabled));
      assert.deepEqual(capabilities(details.server_info), expected(false, enabled));
    }
  });

  it("preserves the explicit legacy audio-only opt-in", async () => {
    process.env.VOICE_AUDIO_ONLY = "true";
    const { info, details } = await announcements();
    assert.deepEqual(capabilities(info), expected(false, false, true));
    assert.deepEqual(capabilities(details.server_info), expected(false, false, true));
  });

  it("still refuses member details before joining and withholds the member version", async () => {
    process.env.NATIVE_LAN_VOICE_ENABLED = "true";
    const { info, details } = await announcements(false);
    assert.equal(info.native_lan_voice_enabled, true);
    assert.equal(info.version, undefined);
    assert.equal(details.error, "join_required");
    assert.equal(details.server_info, undefined);
  });
});

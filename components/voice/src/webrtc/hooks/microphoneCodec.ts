import type { MicrophoneCodecProfile, MicrophoneCodecState } from "../types/MicrophoneCodec";

export function snapshotMicrophoneCodec(profile: MicrophoneCodecProfile | undefined): MicrophoneCodecProfile | undefined {
  if (profile === undefined) return undefined;
  if (!profile || profile.codec !== "opus" || profile.channels !== 1 ||
      !Number.isInteger(profile.maxBitrateBps) || profile.maxBitrateBps < 6_000 || profile.maxBitrateBps > 510_000 ||
      ![10, 20, 40, 60].includes(profile.packetTimeMs) ||
      [profile.vbr, profile.dtx, profile.fec].some(value => typeof value !== "boolean")) {
    throw new TypeError("invalid_profile");
  }
  return { codec: "opus", channels: 1, maxBitrateBps: profile.maxBitrateBps,
    packetTimeMs: profile.packetTimeMs, vbr: profile.vbr, dtx: profile.dtx, fec: profile.fec };
}

function sections(sdp: string): string[][] {
  const groups: string[][] = [[]];
  for (const line of sdp.split(/\r?\n/).filter(Boolean)) {
    if (line.startsWith("m=")) groups.push([]);
    groups[groups.length - 1].push(line);
  }
  return groups;
}
function opusPayloads(lines: string[]): string[] {
  const formats = lines[0]?.split(" ").slice(3) ?? [];
  return lines.flatMap(line => {
    const match = line.match(/^a=rtpmap:(\d+) opus\/48000\/2$/i);
    return match && formats.includes(match[1]) ? [match[1]] : [];
  });
}
function fmtp(lines: string[], payload: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of lines.filter(line => line.startsWith(`a=fmtp:${payload} `))) {
    for (const pair of line.slice(line.indexOf(" ") + 1).split(";")) {
      const [key, value] = pair.trim().split("=");
      if (key) result.set(key.toLowerCase(), value);
    }
  }
  return result;
}
function matches(lines: string[], profile: MicrophoneCodecProfile): boolean {
  if (!lines[0]?.startsWith("m=audio ") || lines[0].split(" ")[1] === "0" ||
      !lines.includes(`a=ptime:${profile.packetTimeMs}`)) return false;
  const maxptime = lines.find(line => line.startsWith("a=maxptime:"));
  if (maxptime && (!Number.isFinite(Number(maxptime.slice(11))) || Number(maxptime.slice(11)) <= 0 || Number(maxptime.slice(11)) > profile.packetTimeMs)) return false;
  return opusPayloads(lines).some(payload => {
    const params = fmtp(lines, payload), bitrate = Number(params.get("maxaveragebitrate"));
    return bitrate === profile.maxBitrateBps &&
      (params.get("stereo") ?? "0") === "0" && (params.get("cbr") ?? "0") === (profile.vbr ? "0" : "1") &&
      (params.get("usedtx") ?? "0") === (profile.dtx ? "1" : "0") &&
      (params.get("useinbandfec") ?? "0") === (profile.fec ? "1" : "0");
  });
}

/** Check the authentic offer, never manufacture remote support by rewriting it. */
export function remoteMicrophoneCodecMatches(pc: RTCPeerConnection, senders: readonly RTCRtpSender[],
  sdp: string, profile: MicrophoneCodecProfile): boolean {
  const groups = sections(sdp);
  return senders.length > 0 && senders.every(sender => {
    const mid = pc.getTransceivers().find(t => t.sender === sender)?.mid;
    const lines = mid == null ? undefined : groups.find(lines => lines.includes(`a=mid:${mid}`));
    return !!lines && matches(lines, profile);
  });
}

/** Our receive preferences and mono sender declaration, restricted to microphone m-lines. */
export function applyLocalMicrophoneCodecSdp(pc: RTCPeerConnection, senders: readonly RTCRtpSender[],
  sdp: string, profile: MicrophoneCodecProfile): string {
  const mids = new Set(pc.getTransceivers().filter(t => senders.includes(t.sender)).map(t => t.mid));
  const groups = sections(sdp);
  for (const lines of groups.slice(1)) {
    const mid = lines.find(line => line.startsWith("a=mid:"))?.slice(6);
    if (!mid || !mids.has(mid) || !lines[0].startsWith("m=audio ") || lines[0].split(" ")[1] === "0") continue;
    const payloads = opusPayloads(lines);
    if (!payloads.length) continue;
    lines[0] = [...lines[0].split(" ").slice(0, 3), ...payloads].join(" ");
    for (let index = lines.length - 1; index > 0; --index) {
      const payload = lines[index].match(/^a=(?:rtpmap|fmtp|rtcp-fb):(\d+)(?: |$)/)?.[1];
      if ((payload && !payloads.includes(payload)) || /^a=(?:ptime|maxptime):/.test(lines[index])) lines.splice(index, 1);
    }
    for (const payload of payloads) {
      const params = fmtp(lines, payload);
      params.set("maxaveragebitrate", String(profile.maxBitrateBps)); params.set("stereo", "0");
      params.set("sprop-stereo", "0"); params.set("cbr", profile.vbr ? "0" : "1");
      params.set("usedtx", profile.dtx ? "1" : "0"); params.set("useinbandfec", profile.fec ? "1" : "0");
      for (let index = lines.length - 1; index > 0; --index) if (lines[index].startsWith(`a=fmtp:${payload} `)) lines.splice(index, 1);
      lines.push(`a=fmtp:${payload} ${[...params].map(([key, value]) => `${key}=${value}`).join(";")}`);
    }
    lines.push(`a=ptime:${profile.packetTimeMs}`, `a=maxptime:${profile.packetTimeMs}`);
  }
  return groups.flat().join("\r\n") + "\r\n";
}

/** Await each transaction; codec/fmtp are read-only in standard setParameters. */
export async function applyMicrophoneCodec(pc: RTCPeerConnection, senders: readonly RTCRtpSender[],
  profile: MicrophoneCodecProfile, remoteSdp?: string, channelMaxBitrateBps?: number | null): Promise<MicrophoneCodecState> {
  const result: MicrophoneCodecState = { status: "applying", reason: null, requested: { ...profile },
    senderMaxBitrateBps: null, remoteOfferMatches: null, rtpVerified: false, errorName: null,
    effectiveMaxBitrateBps: profile.maxBitrateBps, remoteMaxAverageBitrateBps: null, limitedBy: [] };
  let effective = profile.maxBitrateBps;
  if (typeof channelMaxBitrateBps === "number" && Number.isFinite(channelMaxBitrateBps) && channelMaxBitrateBps >= 0) {
    effective = Math.min(effective, channelMaxBitrateBps);
    if (channelMaxBitrateBps < profile.maxBitrateBps) result.limitedBy.push("channel_bitrate");
  }
  if (remoteSdp !== undefined) {
    result.remoteOfferMatches = remoteMicrophoneCodecMatches(pc, senders, remoteSdp, profile);
    const groups = sections(remoteSdp);
    const caps = senders.flatMap(sender => {
      const mid = pc.getTransceivers().find(t => t.sender === sender)?.mid;
      const lines = mid == null ? undefined : groups.find(lines => lines.includes(`a=mid:${mid}`));
      return lines ? opusPayloads(lines).map(payload => Number(fmtp(lines, payload).get("maxaveragebitrate")))
        .filter(cap => Number.isFinite(cap) && cap > 0) : [];
    });
    if (caps.length) {
      result.remoteMaxAverageBitrateBps = Math.min(...caps);
      if (result.remoteMaxAverageBitrateBps < effective) result.limitedBy.push("remote_bitrate");
      effective = Math.min(effective, result.remoteMaxAverageBitrateBps);
    }
  }
  effective = Math.floor(effective);
  result.effectiveMaxBitrateBps = effective;
  if (effective < 6_000) {
    // A closed PC cannot be revived by replaceTrack or an unrelated pipeline rebuild.
    pc.close(); result.status = "degraded"; result.reason = "bitrate_below_opus_minimum"; return result;
  }
  try {
    if (!senders.length) throw new Error("No microphone sender");
    for (const sender of senders) {
      const params = sender.getParameters();
      if (!params.encodings?.length) throw new Error("No microphone encoding");
      params.encodings.forEach(encoding => { encoding.maxBitrate = effective; });
      await sender.setParameters(params);
      const readback = sender.getParameters();
      result.senderMaxBitrateBps = readback.encodings?.[0]?.maxBitrate ?? null;
      if (!readback.encodings?.length || readback.encodings.some(encoding => encoding.maxBitrate !== effective)) {
        result.status = "degraded"; result.reason = "bitrate_readback_mismatch"; return result;
      }
    }
  } catch (error) {
    result.status = "degraded"; result.reason = "set_parameters_failed";
    result.errorName = error instanceof Error ? error.name : "Error"; return result;
  }
  if (remoteSdp === undefined) return result;
  const opus = senders.every(sender => sender.getParameters().codecs?.[0]?.mimeType.toLowerCase() === "audio/opus");
  result.reason = !opus ? "opus_not_negotiated" : !result.remoteOfferMatches ? "remote_offer_profile_mismatch" : null;
  result.status = result.reason ? "degraded" : "configured";
  return result;
}

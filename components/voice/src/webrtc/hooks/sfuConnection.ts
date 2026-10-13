import { MutableRefObject } from "react";

import { applyPeerMediaPolicy, canonicalMediaPolicy, isAudioOnly, refreshPeerReceivePolicy, restrictMediaSdp, type MediaPolicy } from "../../shared/mediaPolicy";
import { parseVideoWanted, type VideoWanted } from "./videoDemand";
import { voiceLog } from "./voiceLogger";
import { applyLocalMicrophoneCodecSdp, applyMicrophoneCodec } from "./microphoneCodec";
import type { MicrophoneCodecProfile, MicrophoneCodecState } from "../types/MicrophoneCodec";

/**
 * Reduce Opus packetization time from the default 20ms to 10ms.
 * Each shaved frame directly reduces one-way latency by ~10ms.
 */
function optimizeSdpForLowLatency(sdp: string): string {
  let result = sdp.replace(/a=ptime:\d+\r\n/g, "");
  result = result.replace(/a=maxptime:\d+\r\n/g, "");
  result = result.replace(
    /(m=audio[^\r\n]*\r\n)/,
    "$1a=ptime:10\r\na=maxptime:10\r\n",
  );
  return result;
}

interface SFUConnectionRefs {
  isDisconnectingRef: MutableRefObject<boolean>;
  sfuWebSocketRef: MutableRefObject<WebSocket | null>;
  peerConnectionRef: MutableRefObject<RTCPeerConnection | null>;
}

export interface SFUWebSocketCloseInfo {
  code: number;
  reason: string;
  wasClean: boolean;
}

interface SFUConnectionOptions {
  microphoneCodec?: MicrophoneCodecProfile;
  channelMaxBitrateBps?: number | null;
  onMicrophoneCodecState?: (state: MicrophoneCodecState) => void;
  interceptDisconnect?: () => boolean;
  onDisposeAvailable?: (dispose: () => void) => void;
  getMediaPolicy?: () => MediaPolicy;
  getMicrophoneSenders?: () => readonly RTCRtpSender[];
  /**
   * Called only after room_joined has completed and the SFU WebSocket later closes
   * abnormally, so the outer hook can mark the state FAILED and let auto-reconnect run.
   */
  onAbnormalClose?: (info: SFUWebSocketCloseInfo) => void;

  /**
   * What the SFU said about itself when it let us in. Called once, before the
   * connect promise resolves.
   */
  onRoomJoined?: (info: RoomJoinedInfo) => void;

  /** What viewers want of one of our streams, from an SFU that says (GRYT-1432). */
  onVideoWanted?: (wanted: VideoWanted & { mid: string }) => void;
}

export interface RoomJoinedInfo {
  /**
   * SFU_CALL_ALONE_TIMEOUT on the SFU we reached, in seconds. Zero means it
   * never ends a call for being one person; null means it did not say.
   */
  callAloneTimeoutSeconds: number | null;
  /** SFU_MAX_INGEST_KBPS: the most this peer should send the SFU, or null for no cap. */
  maxIngestKbps: number | null;
}

/**
 * What room_joined carries, for SFUs that carry anything. It used to be a sentence; this
 * parses and falls back rather than switching on a version, so an older SFU gives nulls.
 */
export function parseRoomJoined(data: unknown): RoomJoinedInfo {
  const nothing: RoomJoinedInfo = { callAloneTimeoutSeconds: null, maxIngestKbps: null };
  if (typeof data !== "string") return nothing;

  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return nothing;
  }

  if (typeof parsed !== "object" || parsed === null) return nothing;

  const seconds = (parsed as Record<string, unknown>)
    .call_alone_timeout_seconds;
  const ingest = (parsed as Record<string, unknown>).max_ingest_kbps;
  const maxIngestKbps = typeof ingest === "number" && Number.isFinite(ingest) && ingest > 0 ? ingest : null;

  // A negative number is not a shorter timeout, it is an SFU we do not understand. Same for
  // a string, which is what a hand-rolled proxy in the middle would produce.
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) {
    return { ...nothing, maxIngestKbps };
  }

  return { callAloneTimeoutSeconds: Math.floor(seconds), maxIngestKbps };
}

export async function connectToSfuWebSocket(
  sfuUrl: string,
  joinToken: unknown,
  refs: SFUConnectionRefs,
  eSportsModeEnabled: boolean = false,
  options: SFUConnectionOptions = {},
): Promise<WebSocket> {
  const { isDisconnectingRef, sfuWebSocketRef, peerConnectionRef } = refs;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(sfuUrl);
    // A signaling socket negotiates exactly the PC that created it. A later room
    // may reuse these refs, but must never inherit this socket's queued SDP/ICE.
    const ownedPeerConnection = peerConnectionRef.current;
    let disposed = false;
    const isOwnedConnection = () => !disposed && !isDisconnectingRef.current &&
      ownedPeerConnection !== null && peerConnectionRef.current === ownedPeerConnection;
    const isCurrentConnection = () => isOwnedConnection() && ownedPeerConnection?.connectionState !== "closed";

    let isResolved = false;
    let offerProcessingInProgress = false;
    let pendingOffer: RTCSessionDescriptionInit | null = null;
    let connectionMonitor: ReturnType<typeof setInterval> | null = null;
    let reconnectAttempt = 0;

    // Candidates the SFU sent before its offer was applied, and the peer connection they
    // belong to. The SFU's candidate and offer race each other down this socket (GRYT-1263).
    let heldCandidates: RTCIceCandidateInit[] = [];
    let heldFor: RTCPeerConnection | null = null;

    const maxReconnectAttempts = 3;

    voiceLog.step("SFU-WS", "7a", "Opening WebSocket to SFU", { url: sfuUrl });

    const timeout = setTimeout(() => {
      if (!isResolved) {
        voiceLog.fail("SFU-WS", "7a", "WebSocket connection timed out (15s)");
        isResolved = true;
        cleanup();
        ws.close();
        reject(new Error("SFU WebSocket connection timeout"));
      }
    }, 15_000);

    const cleanup = () => {
      disposed = true;
      clearTimeout(timeout);
      pendingOffer = null;
      if (connectionMonitor) {
        clearInterval(connectionMonitor);
        connectionMonitor = null;
      }

      reconnectAttempt = maxReconnectAttempts;
      heldCandidates = [];
      heldFor = null;

      try {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
      } catch {
        // Event listeners already removed.
      }
    };

    options.onDisposeAvailable?.(() => {
      clearTimeout(timeout);
      cleanup();
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close(1000, "Connection disposed");
      if (!isResolved) {
        isResolved = true;
        reject(new Error("SFU connection disposed"));
      }
    });

    // The registration may synchronously dispose an already-retired attempt.
    if (disposed) return;

    const handleAbnormalClose = (event: CloseEvent) => {
      if (isDisconnectingRef.current || peerConnectionRef.current !== ownedPeerConnection) return;
      if (sfuWebSocketRef.current && sfuWebSocketRef.current !== ws) return;
      if (options.interceptDisconnect?.()) return;

      // Only 1000 is the SFU ending it. 1001 is a proxy going away, Cloudflare's on a restart,
      // and the SFU has already dropped the peer by then (GRYT-1359).
      if (event.code === 1000 && event.wasClean) return;

      if (sfuWebSocketRef.current === ws) {
        sfuWebSocketRef.current = null;
      }

      options.onAbnormalClose?.({
        code: event.code,
        reason: event.reason || "",
        wasClean: event.wasClean,
      });
    };

    const startConnectionMonitor = () => {
      connectionMonitor = setInterval(() => {
        if (!isCurrentConnection()) {
          cleanup();
          return;
        }

        if (
          isResolved &&
          sfuWebSocketRef.current &&
          sfuWebSocketRef.current !== ws
        ) {
          cleanup();
          return;
        }

        if (ws.readyState !== WebSocket.OPEN) {
          cleanup();

          if (
            (!sfuWebSocketRef.current || sfuWebSocketRef.current === ws) &&
            peerConnectionRef.current &&
            peerConnectionRef.current.connectionState === "connected" &&
            reconnectAttempt < maxReconnectAttempts &&
            !isDisconnectingRef.current
          ) {
            attemptReconnection();
          }

          return;
        }

        try {
          ws.send(
            JSON.stringify({
              event: "keep_alive",
              data: JSON.stringify({ timestamp: Date.now() }),
            }),
          );
        } catch {
          // Keep-alive send failed. The browser will usually fire onclose next.
        }
      }, 15_000);
    };

    const attemptReconnection = () => {
      if (!isCurrentConnection()) return;
      if (sfuWebSocketRef.current && sfuWebSocketRef.current !== ws) return;

      reconnectAttempt++;

      setTimeout(() => {
        if (
          isCurrentConnection() &&
          (!sfuWebSocketRef.current || sfuWebSocketRef.current === ws) &&
          ownedPeerConnection?.connectionState === "connected"
        ) {
          // A full SFU reconnect requires a fresh room token, so the outer
          // useSFU recovery path handles it after this socket is marked failed.
        }
      }, 1000 * reconnectAttempt);
    };

    const addRemoteCandidate = (
      pc: RTCPeerConnection,
      candidate: RTCIceCandidateInit,
    ) => {
      if (!isCurrentConnection() || pc !== ownedPeerConnection) return;
      pc.addIceCandidate(new RTCIceCandidate(candidate)).catch((error) => {
        // Closing mid-add is expected. Anything else loses an address for the SFU, and losing
        // one quietly is how GRYT-1263 went unnoticed.
        if (disposed || pc !== peerConnectionRef.current || pc.signalingState === "closed") return;
        voiceLog.fail(
          "SFU-WS",
          "ICE",
          "Error adding remote ICE candidate",
          error,
        );
      });
    };

    const addHeldCandidates = (pc: RTCPeerConnection) => {
      const held = heldFor === pc ? heldCandidates : [];
      heldCandidates = [];
      heldFor = null;
      if (held.length === 0) return;

      voiceLog.info(
        "SFU-WS",
        `Adding ${held.length} remote ICE candidate(s) held until the offer was applied`,
      );
      for (const candidate of held) addRemoteCandidate(pc, candidate);
    };

    const processOffer = (offer: RTCSessionDescriptionInit) => {
      if (!isCurrentConnection() || !ownedPeerConnection) return;
      const pc = ownedPeerConnection;
      voiceLog.step("SFU-WS", "7d", "Processing SFU offer", {
        sdpLength: offer.sdp?.length || 0,
        signalingState: pc.signalingState,
        connectionState: pc.connectionState,
      });

      if (pc.signalingState !== "stable" && pc.signalingState !== "have-remote-offer") {
        voiceLog.warn(
          "SFU-WS",
          `Cannot process offer — signaling state: ${pc.signalingState}, queuing`,
        );
        pendingOffer = offer;
        return;
      }

      offerProcessingInProgress = true;

      const policy = canonicalMediaPolicy(options.getMediaPolicy?.() ?? {});
      const policyKey = JSON.stringify(policy);
      const policyRevision = new Error("Receive permissions changed during negotiation; retrying current offer");
      const ensureCurrent = (allowTerminalClose = false) => {
        if (!isOwnedConnection() || (!allowTerminalClose && !isCurrentConnection())) {
          throw new Error("SFU connection retired during negotiation");
        }
        const currentPolicy = canonicalMediaPolicy(options.getMediaPolicy?.() ?? {});
        if (JSON.stringify(currentPolicy) !== policyKey) {
          if (isAudioOnly(currentPolicy) !== isAudioOnly(policy)) pc.close();
          else {
            applyPeerMediaPolicy(pc, currentPolicy, options.getMicrophoneSenders?.() ?? [], offer.sdp, false);
            refreshPeerReceivePolicy(pc, currentPolicy);
            pendingOffer ??= offer;
          }
          throw policyRevision;
        }
      };
      const remoteSdp = offer.sdp;
      const restrictedOffer = remoteSdp ? { ...offer, sdp: restrictMediaSdp(remoteSdp, policy, "remote") } : offer;
      pc.setRemoteDescription(new RTCSessionDescription(restrictedOffer))
        .then(() => {
          ensureCurrent();
          applyPeerMediaPolicy(pc, policy, options.getMicrophoneSenders?.() ?? [], remoteSdp, false);
          voiceLog.ok(
            "SFU-WS",
            "7d",
            "Remote description set, creating answer…",
          );
          addHeldCandidates(pc);

          if (isCurrentConnection()) {
            return pc.createAnswer({
              offerToReceiveAudio: true,
              offerToReceiveVideo: !isAudioOnly(policy),
            });
          }

          throw new Error("Peer connection closed during offer processing");
        })
        .then((answer) => {
          ensureCurrent();
          if (answer.sdp) answer = { ...answer, sdp: restrictMediaSdp(answer.sdp, policy, "local", remoteSdp) };
          if (options.microphoneCodec && answer.sdp) {
            answer = { ...answer, sdp: applyLocalMicrophoneCodecSdp(pc, options.getMicrophoneSenders?.() ?? [], answer.sdp, options.microphoneCodec) };
          } else if (eSportsModeEnabled && answer.sdp) {
            voiceLog.info(
              "SFU-WS",
              "eSports mode — optimizing SDP for low latency (ptime=10)",
            );
            answer = { ...answer, sdp: optimizeSdpForLowLatency(answer.sdp) };
          }

          voiceLog.ok(
            "SFU-WS",
            "7e",
            `Answer created (${answer.sdp?.length || 0} bytes SDP)`,
          );

          if (isCurrentConnection()) {
            return pc.setLocalDescription(answer);
          }

          throw new Error("Peer connection closed during answer creation");
        })
        .then(async () => {
          ensureCurrent();
          if (options.microphoneCodec) {
            const state = await applyMicrophoneCodec(pc, options.getMicrophoneSenders?.() ?? [], options.microphoneCodec, remoteSdp, options.channelMaxBitrateBps);
            // A minimum-bitrate refusal closes this PC on purpose. It may report
            // its current terminal reason, but may never send an answer afterward.
            ensureCurrent(state.reason === "bitrate_below_opus_minimum");
            options.onMicrophoneCodecState?.(state);
            if (state.reason) voiceLog.warn("SFU-WS", `Microphone codec: ${state.reason}`);
            if (state.reason === "bitrate_below_opus_minimum") { ws.close(1008, state.reason); throw new Error(state.reason); }
          }
          if (
            ws.readyState !== WebSocket.OPEN ||
            !isCurrentConnection()
          ) {
            return;
          }

          const answer = pc.localDescription;
          if (!answer) {
            throw new Error("No local description available");
          }

          voiceLog.ok("SFU-WS", "7f", "Sending answer to SFU");

          ws.send(
            JSON.stringify({
              event: "answer",
              data: JSON.stringify(answer),
            }),
          );
          applyPeerMediaPolicy(pc, policy, options.getMicrophoneSenders?.() ?? [], remoteSdp);
          refreshPeerReceivePolicy(pc, policy, true);

          const transceivers = pc.getTransceivers();

          for (const t of transceivers) {
            if (t.sender?.track && t.mid) {
              const codec = t.sender.getParameters().codecs?.[0];
              if (codec) {
                voiceLog.info(
                  "SFU-WS",
                  `Negotiated send codec mid=${t.mid} kind=${t.sender.track.kind}: ${codec.mimeType} pt=${codec.payloadType} ${codec.sdpFmtpLine || ""}`,
                );
              }
            }

            if (t.receiver?.track && t.mid && t.direction !== "sendonly") {
              const rCodec = t.receiver.getParameters?.()?.codecs?.[0];
              if (rCodec) {
                voiceLog.info(
                  "SFU-WS",
                  `Negotiated recv codec mid=${t.mid} kind=${t.receiver.track.kind}: ${rCodec.mimeType} pt=${rCodec.payloadType} ${rCodec.sdpFmtpLine || ""}`,
                );
              }
            }
          }
        })
        .catch((error) => {
          if (disposed || pc !== peerConnectionRef.current || isDisconnectingRef.current) return;
          if (error === policyRevision) return;
          voiceLog.fail(
            "SFU-WS",
            "7d",
            "Error processing offer/answer exchange",
            error,
          );
        })
        .finally(() => {
          offerProcessingInProgress = false;

          if (!isCurrentConnection()) {
            pendingOffer = null;
            return;
          }
          if (pendingOffer) {
            voiceLog.info("SFU-WS", "Processing queued offer…");
            const next = pendingOffer;
            pendingOffer = null;
            processOffer(next);
          }
        });
    };

    ws.onopen = () => {
      voiceLog.ok("SFU-WS", "7a", "WebSocket TCP connection open");

      if (!isCurrentConnection()) {
        voiceLog.warn(
          "SFU-WS",
          "Retired connection — closing newly opened WebSocket",
        );
        cleanup();
        ws.close();
        if (!isResolved) {
          isResolved = true;
          reject(new Error("SFU connection retired before opening"));
        }
        return;
      }

      reconnectAttempt = 0;

      const joinMessage = {
        event: "client_join",
        data: JSON.stringify(joinToken),
      };

      try {
        voiceLog.step("SFU-WS", "7b", "Sending client_join to SFU", {
          room_id: (joinToken as Record<string, unknown>).room_id,
        });

        ws.send(JSON.stringify(joinMessage));
      } catch (error) {
        voiceLog.fail(
          "SFU-WS",
          "7b",
          "Failed to send client_join message",
          error,
        );

        if (!isResolved) {
          clearTimeout(timeout);
          isResolved = true;
          cleanup();
          reject(new Error("Failed to send join message"));
        }
      }
    };

    ws.onmessage = (event) => {
      if (!isCurrentConnection()) return;

      try {
        const message = JSON.parse(event.data);

        switch (message.event) {
          case "room_joined": {
            const joined = parseRoomJoined(message.data);
            voiceLog.ok("SFU-WS", "7c", "SFU confirmed room_joined", joined);
            options.onRoomJoined?.(joined);

            if (!isResolved) {
              clearTimeout(timeout);
              isResolved = true;
              startConnectionMonitor();
              resolve(ws);
            }

            break;
          }

          case "video_wanted": {
            const wanted = parseVideoWanted(message.data);
            if (wanted) options.onVideoWanted?.(wanted);
            break;
          }

          case "voice:room:error": {
            voiceLog.fail(
              "SFU-WS",
              "7c",
              "SFU returned room error",
              message.data,
            );

            if (!isResolved) {
              clearTimeout(timeout);
              isResolved = true;
              cleanup();
              reject(new Error(`SFU room error: ${message.data}`));
            }

            break;
          }

          case "offer": {
            voiceLog.step("SFU-WS", "7d", "Received SFU offer");

            const offer = JSON.parse(message.data);

            if (offerProcessingInProgress) {
              voiceLog.info(
                "SFU-WS",
                "Offer queued (previous still processing)",
              );
              pendingOffer = offer;
              break;
            }

            processOffer(offer);
            break;
          }

          case "candidate": {
            const candidate = JSON.parse(message.data);

            voiceLog.info(
              "SFU-WS",
              `Remote ICE candidate: ${candidate.candidate?.substring(0, 60)}…`,
            );

            const pc = ownedPeerConnection;
            if (
              !pc ||
              pc.connectionState === "closed" ||
              pc.connectionState === "failed"
            ) {
              break;
            }

            // No remote description yet, so adding it now would reject it and lose it.
            if (!pc.remoteDescription) {
              if (heldFor !== pc) {
                heldCandidates = [];
                heldFor = pc;
              }
              heldCandidates.push(candidate);
              voiceLog.info(
                "SFU-WS",
                `Holding the candidate until the SFU's offer is applied (${heldCandidates.length} held)`,
              );
              break;
            }

            addRemoteCandidate(pc, candidate);
            break;
          }

          default:
            voiceLog.info("SFU-WS", `Unhandled SFU message: ${message.event}`);
        }
      } catch (error) {
        voiceLog.fail("SFU-WS", "MSG", "Error parsing SFU message", error);
      }
    };

    ws.onclose = (event) => {
      if (disposed) return;
      voiceLog.warn(
        "SFU-WS",
        `WebSocket closed: code=${event.code} reason="${event.reason || "(none)"}" wasClean=${event.wasClean}`,
      );

      cleanup();

      if (!isResolved) {
        voiceLog.fail("SFU-WS", "7a", "WebSocket closed before room_joined");
        clearTimeout(timeout);
        isResolved = true;
        reject(new Error(`SFU WebSocket closed: ${event.code}`));
        return;
      }

      handleAbnormalClose(event);
    };

    ws.onerror = (event) => {
      if (disposed) return;
      voiceLog.fail("SFU-WS", "7a", "WebSocket connection error", event);

      cleanup();

      if (!isResolved) {
        clearTimeout(timeout);
        isResolved = true;
        reject(new Error("SFU WebSocket connection failed"));
      }
    };
  });
}

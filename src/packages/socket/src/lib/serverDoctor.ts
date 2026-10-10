import { i18n as socketI18n } from "@/i18n";
/** The checks run in the order the connection does, so the first failure is the
    one to act on and anything after it is reported as untested. */

export type CheckId =
  | "server-http"
  | "server-socket"
  | "sfu-http"
  | "sfu-ws"
  | "media"
  | "call";

export type CheckStatus = "pending" | "running" | "pass" | "fail" | "warn" | "skipped";

export interface CheckResult {
  id: CheckId;
  label: string;
  status: CheckStatus;
  /** One line saying what happened. Shown whether it passed or not. */
  detail?: string;
  /** Per-address findings, for the checks that try more than one. */
  addresses?: { address: string; ok: boolean; latencyMs?: number; error?: string }[];
  /** Anchor in the troubleshooting guide that covers this failure. */
  help?: { label: string; href: string };
}

const DOCS = "https://docs.gryt.chat/docs/use/troubleshooting";

const HELP = {
  server: {
    get label() { return socketI18n.t("ui.serverUnreachable"); },
    href: `${DOCS}#websocket-connection-fails`,
  },
  sfu: {
    get label() { return socketI18n.t("socketFull.serverDoctor_d0490c5ac7"); },
    href: `${DOCS}#sfu-connection-fails`,
  },
  media: {
    get label() { return socketI18n.t("socketFull.serverDoctor_07272d9f30"); },
    href: `${DOCS}#people-connect-and-chat-but-nobody-can-hear-anyone`,
  },
} as const;

const PROBE_TIMEOUT_MS = 4000;
const ICE_TIMEOUT_MS = 10000;
const CALL_TIMEOUT_MS = 15000;

/**
 * Whether this client is allowed to speak plain ws/http at all. The rule is the
 * browser's: the desktop app serves from 127.0.0.1 and is exempt, app.gryt.chat is not.
 */
function isHttpsPage(): boolean {
  try {
    return typeof window !== "undefined" && window.location?.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * One advertised address, as a WebSocket URL this client could use. Not the voice
 * engine's version, which caches and falls back — the behaviour being diagnosed.
 */
function sfuWsUrl(raw: string): string {
  const hasScheme = raw.startsWith("ws://") || raw.startsWith("wss://");

  try {
    const url = new URL(hasScheme ? raw : `ws://${raw}`);
    url.protocol = isHttpsPage() ? "wss:" : "ws:";
    return url.toString();
  } catch {
    return hasScheme ? raw : `ws://${raw}`;
  }
}

function healthUrlFor(wsUrl: string): string {
  return wsUrl
    .replace(/^wss:\/\//, "https://")
    .replace(/^ws:\/\//, "http://")
    .replace(/\/?$/, "/health");
}

function httpBase(host: string): string {
  if (host.startsWith("http://") || host.startsWith("https://")) return host;
  return `http://${host}`;
}

/** A fetch that gives up rather than hanging, and reports how long it took. */
async function probe(
  url: string,
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    await fetch(url, { method: "GET", signal: controller.signal, cache: "no-store" });
    return { ok: true, latencyMs: Math.round(performance.now() - started) };
  } catch (err) {
    // An abort and a refused connection are different problems to the reader: a
    // firewall swallowing packets, or nothing listening.
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - started),
      get error() { return aborted ? socketI18n.t("socketFull.serverDoctor_7f11519f02", { p0: (PROBE_TIMEOUT_MS / 1000) }) : socketI18n.t("socketFull.serverDoctor_bab74bd395"); },
    };
  } finally {
    clearTimeout(timer);
  }
}

export function initialChecks(): CheckResult[] {
  return [
    { id: "server-http", get label() { return socketI18n.t("socketFull.serverDoctor_6369fe7b77"); }, status: "pending" },
    { id: "server-socket", get label() { return socketI18n.t("socketFull.serverDoctor_cc1b53c044"); }, status: "pending" },
    { id: "sfu-http", get label() { return socketI18n.t("socketFull.serverDoctor_0e853dcdb2"); }, status: "pending" },
    { id: "sfu-ws", get label() { return socketI18n.t("socketFull.serverDoctor_0d64e8f433"); }, status: "pending" },
    { id: "media", get label() { return socketI18n.t("socketFull.serverDoctor_4bc04fb5db"); }, status: "pending" },
    { id: "call", get label() { return socketI18n.t("socketFull.serverDoctor_8fe61f78a5"); }, status: "pending" },
  ];
}

async function checkServerHttp(host: string): Promise<CheckResult> {
  const result = await probe(`${httpBase(host)}/health`);

  if (result.ok) {
    return {
      id: "server-http",
      get label() { return socketI18n.t("socketFull.serverDoctor_6369fe7b77"); },
      status: "pass",
      get detail() { return socketI18n.t("socketFull.serverDoctor_8cb429dde0", { p0: (host), p1: (result.latencyMs) }); },
    };
  }

  return {
    id: "server-http",
    get label() { return socketI18n.t("socketFull.serverDoctor_6369fe7b77"); },
    status: "fail",
    get detail() { return socketI18n.t("socketFull.serverDoctor_640ec6fb00", { p0: (host), p1: (result.error) }); },
    help: HELP.server,
  };
}

/**
 * Every advertised SFU address, tried separately. `server:details` hands over a
 * list and the client picks the fastest, so one bad address reads as broken voice.
 */
async function checkSfuHttp(sfuHosts: string[]): Promise<CheckResult> {
  if (sfuHosts.length === 0) {
    return {
      id: "sfu-http",
      get label() { return socketI18n.t("socketFull.serverDoctor_0e853dcdb2"); },
      status: "fail",
      get detail() { return socketI18n.t("socketFull.serverDoctor_01975860d6"); },
      help: HELP.sfu,
    };
  }

  const addresses = await Promise.all(
    sfuHosts.map(async (raw) => {
      const result = await probe(healthUrlFor(sfuWsUrl(raw)));
      return {
        address: raw,
        ok: result.ok,
        latencyMs: result.latencyMs,
        get error() { return result.error; },
      };
    }),
  );

  const reachable = addresses.filter((a) => a.ok);

  if (reachable.length === 0 && isHttpsPage()) {
    return {
      id: "sfu-http",
      get label() { return socketI18n.t("socketFull.serverDoctor_0e853dcdb2"); },
      status: "fail",
      get detail() { return socketI18n.t("socketFull.serverDoctor_173f8cca5f"); },
      addresses,
      help: HELP.sfu,
    };
  }

  if (reachable.length === 0) {
    return {
      id: "sfu-http",
      get label() { return socketI18n.t("socketFull.serverDoctor_0e853dcdb2"); },
      status: "fail",
      get detail() { return addresses.length === 1
          ? socketI18n.t("socketFull.serverDoctor_0cf2062aeb")
          : socketI18n.t("socketFull.serverDoctor_f9a342ea89", { p0: (addresses.length) }); },
      addresses,
      help: HELP.sfu,
    };
  }

  // Some reachable and some not is normal: a server advertises a LAN address and
  // a public one, and any given person is on one side or the other.
  return {
    id: "sfu-http",
    get label() { return socketI18n.t("socketFull.serverDoctor_0e853dcdb2"); },
    status: reachable.length === addresses.length ? "pass" : "warn",
    get detail() { return reachable.length !== addresses.length
        ? socketI18n.t("socketFull.serverDoctor_59d901def9", { p0: (reachable.length), p1: (addresses.length) })
        : addresses.length === 1
          ? socketI18n.t("socketFull.serverDoctor_153bd3321b")
          : socketI18n.t("socketFull.serverDoctor_3574f69c16", { p0: (addresses.length) }); },
    addresses,
  };
}

/** The upgrade, which can fail on its own even when /health answers. */
function checkSfuWebSocket(url: string): Promise<CheckResult> {
  return new Promise((resolve) => {
    const label = () => socketI18n.t("socketFull.serverDoctor_0d64e8f433");
    let settled = false;

    const finish = (result: CheckResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      finish({
        id: "sfu-ws",
        get label() { return label(); },
        status: "fail",
        get detail() { return socketI18n.t("socketFull.serverDoctor_613361b7bf", { p0: (url) }); },
        help: HELP.sfu,
      });
      return;
    }

    const timer = setTimeout(() => {
      ws.close();
      finish({
        id: "sfu-ws",
        get label() { return label(); },
        status: "fail",
        get detail() { return socketI18n.t("socketFull.serverDoctor_51cb99d61e", { p0: (url) }); },
        help: HELP.sfu,
      });
    }, PROBE_TIMEOUT_MS);

    ws.onopen = () => {
      clearTimeout(timer);
      ws.close();
      finish({ id: "sfu-ws", get label() { return label(); }, status: "pass", get detail() { return socketI18n.t("socketFull.serverDoctor_be1b794f87", { p0: (url) }); } });
    };

    ws.onerror = () => {
      clearTimeout(timer);
      finish({
        id: "sfu-ws",
        get label() { return label(); },
        status: "fail",
        get detail() { return socketI18n.t("socketFull.serverDoctor_49f90e2713", { p0: (url) }); },
        help: HELP.sfu,
      });
    };
  });
}

/**
 * Whether UDP leaves this machine. A renderer cannot send raw UDP, so this gathers
 * ICE candidates instead. It does not prove the SFU's own port is open.
 */
function checkMedia(stunHosts: string[]): Promise<CheckResult> {
  return new Promise((resolve) => {
    const label = () => socketI18n.t("socketFull.serverDoctor_4bc04fb5db");

    if (typeof RTCPeerConnection === "undefined") {
      resolve({
        id: "media",
        get label() { return label(); },
        status: "skipped",
        get detail() { return socketI18n.t("socketFull.serverDoctor_a0bd284d8a"); },
      });
      return;
    }

    const iceServers = stunHosts.length > 0 ? [{ urls: stunHosts }] : [];
    const pc = new RTCPeerConnection({ iceServers });

    let host = 0;
    let srflx = 0;
    let settled = false;

    const finish = (result: CheckResult) => {
      if (settled) return;
      settled = true;
      pc.close();
      resolve(result);
    };

    const verdict = () => {
      const found = { host, srflx };
      if (srflx > 0) {
        finish({
          id: "media",
          get label() { return label(); },
          status: "pass",
          get detail() { return socketI18n.t("socketFull.serverDoctor_6e27d91656", { p0: found.host, p1: found.srflx, count: found.srflx }); },
        });
        return;
      }

      if (host > 0) {
        finish({
          id: "media",
          get label() { return label(); },
          status: "warn",
          get detail() { return socketI18n.t("socketFull.serverDoctor_722103c8e7", { p0: found.host, count: found.host }); },
          help: HELP.media,
        });
        return;
      }

      finish({
        id: "media",
        get label() { return label(); },
        status: "fail",
        get detail() { return socketI18n.t("socketFull.serverDoctor_86e60f438e"); },
        help: HELP.media,
      });
    };

    pc.onicecandidate = (event) => {
      if (!event.candidate) {
        verdict();
        return;
      }
      if (event.candidate.type === "srflx") srflx += 1;
      if (event.candidate.type === "host") host += 1;
    };

    setTimeout(verdict, ICE_TIMEOUT_MS);

    pc.createDataChannel("gryt-doctor");
    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .catch(() =>
        finish({
          id: "media",
          get label() { return label(); },
          status: "fail",
          get detail() { return socketI18n.t("socketFull.serverDoctor_08441ed064"); },
          help: HELP.media,
        }),
      );
  });
}

/**
 * The route media took. **Found through `selectedCandidatePairId`, not `nominated`**
 * — Chrome reports `nominated: false` on every pair, including the one it uses.
 */
function describeSelectedPair(stats: RTCStatsReport): string {
  const generic = socketI18n.t("socketFull.serverDoctor_0e6a555b81");

  let selectedId: string | undefined;
  let succeeded: RTCIceCandidatePairStats | undefined;

  stats.forEach((report) => {
    if (report.type === "transport" && report.selectedCandidatePairId) {
      selectedId = report.selectedCandidatePairId as string;
    }
    if (report.type === "candidate-pair" && report.state === "succeeded") {
      succeeded = report as RTCIceCandidatePairStats;
    }
  });

  const pair =
    (selectedId ? (stats.get(selectedId) as RTCIceCandidatePairStats | undefined) : undefined) ??
    succeeded;
  if (!pair) return generic;

  const local = stats.get(pair.localCandidateId ?? "");
  const remote = stats.get(pair.remoteCandidateId ?? "");
  if (!local || !remote) return generic;

  return socketI18n.t("socketFull.serverDoctor_84e2062695", { p0: (local.candidateType), p1: (remote.candidateType), p2: (remote.address), p3: (remote.port), p4: (String(remote.protocol ?? "udp").toUpperCase()) });
}

/**
 * `join_token` is not a token. It is the whole join payload the SFU expects, and it
 * goes across unchanged — a tidier object built from its parts is refused.
 */
export interface DoctorRoomGrant {
  room_id: string;
  join_token: {
    room_id: string;
    server_id: string;
    server_password: string;
    user_token: string;
    user_id: string;
  };
  sfu_urls?: string[];
  sfu_url?: string;
}

/**
 * Ask the SFU for a real connection into an empty room. This proves media gets
 * through, which a firewall passing TCP 5005 and dropping UDP 3478 does not.
 */
async function checkCall(
  grant: DoctorRoomGrant,
  stunHosts: string[],
): Promise<CheckResult> {
  const label = () => socketI18n.t("socketFull.serverDoctor_8fe61f78a5");

  if (typeof RTCPeerConnection === "undefined") {
    return { id: "call", get label() { return label(); }, status: "skipped", get detail() { return socketI18n.t("socketFull.serverDoctor_a0bd284d8a"); } };
  }

  const url = sfuWsUrl(grant.sfu_urls?.[0] ?? grant.sfu_url ?? "");
  const pc = new RTCPeerConnection({
    iceServers: stunHosts.length > 0 ? [{ urls: stunHosts }] : [],
  });
  const ws = new WebSocket(url);

  // A data channel rather than a microphone: this must not ask for a device, and a
  // permission prompt inside a diagnostic would be its own bug report.
  pc.createDataChannel("gryt-doctor");

  const cleanUp = () => {
    pc.close();
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
  };

  return new Promise<CheckResult>((resolve) => {
    let settled = false;

    const finish = (result: CheckResult) => {
      if (settled) return;
      settled = true;
      cleanUp();
      resolve(result);
    };

    const timer = setTimeout(
      () =>
        finish({
          id: "call",
          get label() { return label(); },
          status: "fail",
          get detail() { return socketI18n.t("socketFull.serverDoctor_ef9239f41a", { p0: (CALL_TIMEOUT_MS / 1000) }); },
          help: HELP.media,
        }),
      CALL_TIMEOUT_MS,
    );

    ws.onerror = () =>
      finish({
        id: "call",
        get label() { return label(); },
        status: "fail",
        get detail() { return socketI18n.t("socketFull.serverDoctor_613361b7bf", { p0: (url) }); },
        help: HELP.sfu,
      });

    ws.onopen = () => {
      // The grant's join_token verbatim. See DoctorRoomGrant: it is the
      // payload, not a credential to wrap in one.
      ws.send(
        JSON.stringify({
          event: "client_join",
          data: JSON.stringify(grant.join_token),
        }),
      );
    };

    ws.onmessage = (event) => {
      let message: { event?: string; data?: string };
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }

      if (message.event === "error") {
        finish({
          id: "call",
          get label() { return label(); },
          status: "fail",
          get detail() { return socketI18n.t("socketFull.serverDoctor_3f7b66646a", { p0: (message.data ?? socketI18n.t("socketFull.serverDoctor_e81ba6962f")) }); },
          help: HELP.sfu,
        });
        return;
      }

      // Offer and candidates are the engine's protocol, and repeating it here would
      // be a second copy to keep in step. ICE state is enough for a yes or no.
      if (message.event === "offer" && message.data) {
        void (async () => {
          try {
            await pc.setRemoteDescription(JSON.parse(message.data as string));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            ws.send(JSON.stringify({ event: "answer", data: JSON.stringify(answer) }));
          } catch {
            finish({
              id: "call",
              get label() { return label(); },
              status: "fail",
              get detail() { return socketI18n.t("socketFull.serverDoctor_41dd8a5cbe"); },
              help: HELP.media,
            });
          }
        })();
      }

      if (message.event === "candidate" && message.data) {
        try {
          void pc.addIceCandidate(JSON.parse(message.data as string));
        } catch {
          // A candidate that will not parse is not on its own a failure: ICE
          // needs one working pair, not every pair.
        }
      }
    };

    pc.onicecandidate = (event) => {
      if (!event.candidate || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ event: "candidate", data: JSON.stringify(event.candidate) }));
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed") {
        clearTimeout(timer);
        finish({
          id: "call",
          get label() { return label(); },
          status: "fail",
          get detail() { return socketI18n.t("socketFull.serverDoctor_aeb79ce6dd"); },
          help: HELP.media,
        });
        return;
      }

      if (pc.iceConnectionState !== "connected" && pc.iceConnectionState !== "completed") {
        return;
      }

      clearTimeout(timer);

      void pc
        .getStats()
        .then((stats) => {
          finish({
            id: "call",
            get label() { return label(); },
            status: "pass",
            get detail() { return describeSelectedPair(stats); },
          });
        })
        .catch(() =>
          finish({
            id: "call",
            get label() { return label(); },
            status: "pass",
            get detail() { return socketI18n.t("socketFull.serverDoctor_0e6a555b81"); },
          }),
        );
    };
  });
}

export interface DoctorInput {
  /** The address the person typed to add this server. */
  host: string;
  /** Whether the socket to that server is up right now. */
  socketConnected: boolean;
  sfuHosts: string[];
  stunHosts: string[];
  /**
   * Asks the server for a throwaway room, or null when the caller does not want a
   * real call attempted. Left out, the Doctor stops at "the SFU is reachable".
   */
  requestDoctorRoom?: () => Promise<DoctorRoomGrant>;
}

/**
 * Run the checks in connection order, reporting each as it lands, so the modal
 * fills in — the SFU probes alone take four seconds against a dropped address.
 */
export async function runDoctor(
  input: DoctorInput,
  onUpdate: (results: CheckResult[]) => void,
): Promise<CheckResult[]> {
  const results = initialChecks();

  const set = (id: CheckId, patch: Partial<CheckResult>) => {
    const index = results.findIndex((r) => r.id === id);
    if (index >= 0) {
      // Preserve lazy display fields while the diagnostic data stays unchanged.
      results[index] = Object.defineProperties({}, {
        ...Object.getOwnPropertyDescriptors(results[index]),
        ...Object.getOwnPropertyDescriptors(patch),
      }) as CheckResult;
    }
    onUpdate([...results]);
  };

  set("server-http", { status: "running" });
  const serverHttp = await checkServerHttp(input.host);
  set("server-http", serverHttp);

  set("server-socket", {
    status: input.socketConnected ? "pass" : "fail",
    get detail() { return input.socketConnected
      ? socketI18n.t("socketFull.serverDoctor_b0acdf4332")
      : socketI18n.t("socketFull.serverDoctor_3bb80b4337"); },
    help: input.socketConnected ? undefined : HELP.server,
  });

  // A server that cannot be reached has not told this client where its SFU is,
  // so the remaining checks would be testing a list that does not exist.
  if (serverHttp.status === "fail") {
    for (const id of ["sfu-http", "sfu-ws", "media"] as CheckId[]) {
      set(id, {
        status: "skipped",
        get detail() { return socketI18n.t("socketFull.serverDoctor_c4ce07c303"); },
      });
    }
    return results;
  }

  set("sfu-http", { status: "running" });
  const sfuHttp = await checkSfuHttp(input.sfuHosts);
  set("sfu-http", sfuHttp);

  const firstReachable = sfuHttp.addresses?.find((a) => a.ok)?.address;

  if (!firstReachable) {
    set("sfu-ws", {
      status: "skipped",
      get detail() { return socketI18n.t("socketFull.serverDoctor_ed9bfaabd8"); },
    });
  } else {
    set("sfu-ws", { status: "running" });
    set("sfu-ws", await checkSfuWebSocket(sfuWsUrl(firstReachable)));
  }

  set("media", { status: "running" });
  const media = await checkMedia(input.stunHosts);
  set("media", media);

  if (!input.requestDoctorRoom) {
    set("call", {
      status: "skipped",
      get detail() { return socketI18n.t("socketFull.serverDoctor_e1efa9c3fc"); },
    });
    return results;
  }

  if (!firstReachable) {
    set("call", {
      status: "skipped",
      get detail() { return socketI18n.t("socketFull.serverDoctor_ed9bfaabd8"); },
    });
    return results;
  }

  set("call", { status: "running" });

  // The grant and the call are separate failures and used to share a message. A
  // WebSocket this client could not construct read as the server refusing a room.
  let grant: DoctorRoomGrant;
  try {
    grant = await input.requestDoctorRoom();
  } catch (err) {
    set("call", {
      status: "fail",
      get detail() { return err instanceof Error
          ? socketI18n.t("socketFull.serverDoctor_12967fd7af", { p0: (err.message) })
          : socketI18n.t("socketFull.serverDoctor_bbe713d494"); },
      help: HELP.sfu,
    });
    return results;
  }

  try {
    set("call", await checkCall(grant, input.stunHosts));
  } catch (err) {
    set("call", {
      status: "fail",
      get detail() { return err instanceof Error
          ? socketI18n.t("socketFull.serverDoctor_8f5582344c", { p0: (err.message) })
          : socketI18n.t("socketFull.serverDoctor_84b7983539"); },
      help: HELP.media,
    });
  }

  return results;
}

/** The one thing to do next, or null when everything passed. */
export function summarise(results: CheckResult[]): CheckResult | null {
  return results.find((r) => r.status === "fail") ?? results.find((r) => r.status === "warn") ?? null;
}

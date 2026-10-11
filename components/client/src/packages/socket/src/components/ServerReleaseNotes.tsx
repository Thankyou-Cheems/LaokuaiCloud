import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { i18n as socketI18n, useTranslation as useSocketTranslation } from "@/i18n";
import { useEmbeddedServer } from "@/settings/src/hooks/useEmbeddedServer";
import { hostedServerAt } from "@/settings/src/hostedServers";

import { type Release, releasesAhead } from "../../../../components/whatsNewSince";
import { getChangelog, loadChangelog, subscribeChangelog } from "../../../../lib/changelogFeed";
import { PiArrowsClockwiseFill } from "../../../../lib/icons";
import { WhatsNewDialog } from "./WhatsNewDialog";

/** The server surface of a copy of the changelog, or null when it has none. */
const serverLines = (feed: Record<string, unknown> | null): Release[] | null =>
  feed && Array.isArray(feed.server) ? (feed.server as Release[]) : null;

/**
 * How to update, for each way a server is run. The server doesn't say which, so all
 * three are listed unless this app is the one hosting it.
 */
function UpdateSteps({ hostedHere }: { hostedHere: boolean }) {
  useSocketTranslation();
  return (
    <section className="whats-new-update" data-server-update-steps>
      <h3 className="whats-new-area">
        <PiArrowsClockwiseFill className="whats-new-area-icon" size={15} />
        <span className="whats-new-area-name">{socketI18n.t("socketFull.serverReleaseNotes_2ccc5f1576")}</span>
      </h3>
      {hostedHere ? (
        <p className="whats-new-line">{socketI18n.t("socketFull.serverReleaseNotes_bd50e91ed8")}</p>
      ) : (
        <>
          <p className="whats-new-line">{socketI18n.t("socketFull.serverReleaseNotes_79d45f7abb")}</p>
          <ul className="whats-new-routes">
            <li>
              <h4>Gryt CLI</h4>
              <code className="whats-new-command">gryt pull &lt;server&gt;</code>
              <p>
                <code>gryt list</code>{" "}{socketI18n.t("socketFull.serverReleaseNotes_a776e03c72")}</p>
            </li>
            <li>
              <h4>Docker Compose</h4>
              <p>{socketI18n.t("socketFull.serverReleaseNotes_87eaa4c4c9")}</p>
              <code className="whats-new-command">
                docker compose pull
                <br />
                docker compose up -d
              </code>
            </li>
            <li>
              <h4>{socketI18n.t("socketFull.serverReleaseNotes_523f15a5a9")}</h4>
              <p>{socketI18n.t("socketFull.serverReleaseNotes_f38ce359d6")}</p>
            </li>
          </ul>
        </>
      )}
    </section>
  );
}

/**
 * The server lines between the version a server runs and the newest, opened from
 * the version chip in Server settings. Asked for, never shown on its own (GRYT-1413).
 */
export function ServerReleaseNotes({
  host,
  running,
  latest,
  beta,
  onClose,
}: {
  host: string;
  running: string;
  latest: string;
  beta: boolean;
  onClose: () => void;
}) {
  useSocketTranslation();
  const feed = useSyncExternalStore(subscribeChangelog, getChangelog, getChangelog);
  /* What was there on opening. A copy fetched since is the one that can say "none yet". */
  const [opened] = useState(feed);
  const [gaveUp, setGaveUp] = useState(false);
  const { servers: hosted } = useEmbeddedServer();

  /* A copy from launch will do unless the server's newest release came out since. */
  useEffect(() => {
    const abort = new AbortController();
    void loadChangelog(abort.signal, {
      accept: (data) => !!serverLines(data)?.some((r) => r?.version === latest),
      maxAgeMs: Infinity,
    }).then((found) => {
      if (!found && !abort.signal.aborted) setGaveUp(true);
    });
    return () => abort.abort();
  }, [latest]);

  const lines = serverLines(feed);
  const picked = useMemo(
    () => (lines ? releasesAhead(lines, running, latest, beta) : { releases: [], capped: false }),
    [lines, running, latest, beta],
  );

  const empty =
    lines && (feed !== opened || gaveUp)
      ? socketI18n.t("socketFull.serverReleaseNotes_9f3b5ce452")
      : gaveUp
        ? socketI18n.t("socketFull.serverReleaseNotes_8338ec785b")
        : socketI18n.t("socketFull.serverReleaseNotes_87cb2e8a47");

  return (
    <WhatsNewDialog
      releases={picked.releases}
      since={null}
      capped={picked.capped}
      onClose={onClose}
      ahead={{ running, latest, empty }}
      changelogHref="https://gryt.chat/changelog?surface=server"
    >
      <UpdateSteps hostedHere={!!hostedServerAt(host, hosted)} />
    </WhatsNewDialog>
  );
}

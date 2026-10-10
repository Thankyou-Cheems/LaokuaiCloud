import { Button, IconButton } from "@gryt/ui";
import { Trans } from "react-i18next";

import {
  dismissServerNotice,
  type ServerNotice,
  useServerNotice,
} from "@/common";
import { i18n as socketI18n, useTranslation as useSocketTranslation } from "@/i18n";

import { PiWarningFill, PiX } from "../../../../lib/icons";

/**
 * Where the installer comes from. Not GitHub Releases: this resolves the current
 * build for the platform in the query and starts the download on arrival.
 */
const INSTALLER_URL = "https://gryt.chat/download?os=windows";
const INSTRUCTIONS_URL = "https://docs.gryt.chat/docs/use/updates";

/**
 * Every word a notice can put on screen. The server sends `{ kind, version }`,
 * so no bytes it sends can put a sentence — or a link — in front of somebody.
 */
function copyFor(notice: ServerNotice) {
  switch (notice.kind) {
    case "outdated_client":
      return {
        title: socketI18n.t("socketFull.serverNoticePanel_85abed7d76"),
        body: socketI18n.t("socketFull.serverNoticePanel_127e4c02dc", { p0: (notice.version) }),
        detail:
          socketI18n.t("socketFull.serverNoticePanel_f3bb62417d"),
        action: { label: socketI18n.t("socketFull.serverNoticePanel_9fd4923de7"), href: INSTALLER_URL },
        more: { label: socketI18n.t("socketFull.serverNoticePanel_4ad2a098fc"), href: INSTRUCTIONS_URL },
      };
  }
}

/**
 * A notice from the server, for the person it is about. Below the channel header
 * so it sits in the server's area rather than in Gryt's own chrome.
 */
export function ServerNoticePanel({
  host,
  serverName,
}: {
  host: string | undefined;
  serverName: string;
}) {
  useSocketTranslation();
  const notice = useServerNotice(host);
  if (!notice || !host) return null;

  const copy = copyFor(notice);

  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-(--gryt-radius-md) px-4 py-3 mx-3 mt-2"
      style={{
        border: "1px solid var(--gryt-border)",
        borderLeft: "3px solid var(--gryt-warning-11)",
        /* The warning tint, not the plain surface. On `neutral-3` it reads as
           another panel, and this one is the thing asking for something. */
        background: "var(--gryt-warning-3)",
      }}
    >
      <span
        className="shrink-0"
        style={{ color: "var(--gryt-warning-11)", marginTop: 2 }}
      >
        <PiWarningFill size={16} />
      </span>

      <div className="flex flex-col" style={{ minWidth: 0, flex: 1 }}>
        <span className="text-xs" style={{ color: "var(--gryt-neutral-11)" }}><Trans i18n={socketI18n} i18nKey="socketFull.serverNoticeSource" values={{ name: serverName }} components={{ server: <b style={{ color: "var(--gryt-text)" }} /> }} /></span>
        <span className="text-sm font-bold" style={{ marginTop: 2 }}>
          {copy.title}
        </span>
        <span className="text-sm" style={{ marginTop: 2 }}>
          {copy.body}
        </span>
        <span className="text-xs" style={{ color: "var(--gryt-neutral-11)", marginTop: 4 }}>
          {copy.detail}
        </span>

        <div className="flex flex-wrap items-center gap-2" style={{ marginTop: 10 }}>
          <Button
            size="xsmall"
            onClick={() => window.open(copy.action.href, "_blank", "noopener,noreferrer")}
          >
            {copy.action.label}
          </Button>
          <a
            href={copy.more.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs underline"
            style={{ color: "var(--gryt-neutral-11)" }}
          >
            {copy.more.label}
          </a>
        </div>
      </div>

      {/* Dismissal is per device and permanent, and the server is not told. A
          server learning which of its notices somebody has silenced is the
          beginning of working around it. */}
      <IconButton
        size="xsmall"
        aria-label={socketI18n.t("shellFull.serviceStatusBanner_tsx_70afe9eff3")}
        className="shrink-0"
        onClick={() => dismissServerNotice(host, notice.kind)}
      >
        <PiX size={14} />
      </IconButton>
    </div>
  );
}

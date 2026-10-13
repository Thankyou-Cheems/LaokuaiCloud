import { Button, Chip } from "@gryt/ui";

import { Wordmark } from "@/common";
import { i18n, useTranslation } from "@/i18n";

import { FaGithub } from "../../../../lib/brandIcons";
import { PiBugFill, PiChatCircleDotsFill } from "../../../../lib/icons";
import { useReportForm } from "../../../../lib/reports/useReportForm";
import { SettingsContainer } from "./settingsComponents";

const GITHUB_URL = "https://github.com/Thankyou-Cheems/LaokuaiCloud";

/* Both stores want these reachable from inside the app rather than only from the
   listing, and the desktop build has no listing at all (GRYT-829). */
const TERMS_URL = "https://gryt.chat/terms";
const PRIVACY_URL = "https://gryt.chat/privacy";

export function AboutSettings() {
  useTranslation();
  const { open: openReport } = useReportForm();

  return (
    <SettingsContainer>
      <h2>{i18n.t("ui.about")}</h2>

      <div className="flex flex-col gap-1">
        <Wordmark size="5" />
        <span className="text-gryt-muted" style={{ fontFamily: "var(--code-font-family)" }}>
          v{__APP_VERSION__}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-gryt-muted">&copy; 2022–2026 Sivert Gullberg Hansen</span>
        <span className="text-gryt-muted">{i18n.t("settingsFull.m4e9a67b3cb")}{" "}
          <a
            className="gryt-link"
            href={`${GITHUB_URL}/blob/HEAD/components/client/LICENSE`}
            target="_blank"
            rel="noopener noreferrer"
          >
            AGPL-3.0-or-later
          </a>
        </span>
        {/* Beside the licence rather than as buttons below. These are the same
            kind of thing — the terms you are already under — and neither is
            something somebody came to this panel to do. */}
        <span className="text-gryt-muted">
          <a
            className="gryt-link"
            href={TERMS_URL}
            target="_blank"
            rel="noopener noreferrer"
          >{i18n.t("settingsFull.m8a069ed1c6")}</a>
          {" · "}
          <a
            className="gryt-link"
            href={PRIVACY_URL}
            target="_blank"
            rel="noopener noreferrer"
          >{i18n.t("settingsFull.m7ceacdcaab")}</a>
        </span>
      </div>

      <div className="flex gap-3 flex-wrap">
        <Button size="small"
          tone="neutral"
          render={
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" />
          }
        >
          <FaGithub size={16} />
          GitHub
        </Button>
        {/* In the app rather than out to a browser. It used to open the Fider
            board, which asks for a sign-in before it will take a sentence —
            and Fider is for public feature requests people vote on, which is
            not what most of what arrived there was. */}
        <Button size="small" tone="neutral" onClick={() => openReport("feedback")}>
          <PiChatCircleDotsFill size={16} />{i18n.t("ui.giveFeedback")}</Button>
        <Button size="small" tone="neutral" onClick={() => openReport("bug")}>
          <PiBugFill size={16} />{i18n.t("ui.reportABug")}</Button>
      </div>

    </SettingsContainer>
  );
}

/** Private builds have no update service. Keep a useful version destination. */
export function UpdatesSettings() {
  const { t } = useTranslation();
  return (
    <SettingsContainer>
      <h2>{t("pureVoice.versionInfo")}</h2>
      <div className="flex flex-col gap-3" data-gryt="private-version-info">
        <Chip tone="neutral">v{__APP_VERSION__}</Chip>
        <p>{t("pureVoice.privateUpdateInfo")}</p>
        <p className="text-gryt-muted">{t("pureVoice.privateUpdateSafety")}</p>
          <p>{t("pureVoice.localMediaBoundary")}</p>
          <p className="text-gryt-muted">{t("pureVoice.serverFeaturesBoundary")}</p>
      </div>
    </SettingsContainer>
  );
}

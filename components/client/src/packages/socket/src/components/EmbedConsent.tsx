import { Button } from "@gryt/ui";
import { Trans } from "react-i18next";

import { i18n as socketI18n, useTranslation as useSocketTranslation } from "@/i18n";

import { PiPlayFill } from "../../../../lib/icons";
import { DismissButton } from "./EmbedRenderers";

/* An embed is another company's page, and it loaded before anybody asked.
   A button rather than a sandbox: sandboxing costs full-track Spotify. */
export interface EmbedProvider {
  /** What the reader is being asked to load, in their words. */
  name: string;
  /** The host it loads from, shown so the claim is checkable. */
  host: string;
}

export function EmbedConsent({
  provider,
  onLoad,
  onTrust,
  onDismiss,
}: {
  provider: EmbedProvider;
  onLoad: () => void;
  /** Load this one and every later one from the same site, on this device. */
  onTrust: () => void;
  onDismiss: () => void;
}) {
  useSocketTranslation();
  return (
    <div className="link-embed-container">
      <DismissButton onDismiss={onDismiss} />

      <div className="embed-consent">
        <PiPlayFill size={20} aria-hidden="true" className="embed-consent-icon" />

        <div className="embed-consent-text">
          <span className="embed-consent-title">{provider.name}</span>
          <span className="embed-consent-host"><Trans i18n={socketI18n} i18nKey="socketFull.embedSourceDisclosure" values={{ host: provider.host }} /></span>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="small" tone="neutral" onClick={onLoad}>{socketI18n.t("socketFull.embedConsent_e074a9c249")}</Button>
          <Button size="small" tone="ghost" onClick={onTrust}>{socketI18n.t("socketFull.embedConsent_680598c823")}{" "}{provider.host}
          </Button>
        </div>
      </div>
    </div>
  );
}

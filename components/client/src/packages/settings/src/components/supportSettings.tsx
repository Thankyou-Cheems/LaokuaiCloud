import { Button, Surface } from "@gryt/ui";

import { i18n, useTranslation } from "@/i18n";

import { FaGithub, SiKofi } from "../../../../lib/brandIcons";
import { PiArrowSquareOutFill, PiHeartFill } from "../../../../lib/icons";
import { IS_LAOKUAI } from "../../../../lib/productVariant";
import { SettingsContainer } from "./settingsComponents";

const GITHUB_URL = "https://github.com/Gryt-chat/gryt";
const SPONSORS_URL = "https://github.com/sponsors/Gryt-chat";
const SPONSORS_PAGE_URL = "https://gryt.chat/sponsors";
const KOFI_URL = "https://ko-fi.com/sivert";

export function SupportSettings() {
  useTranslation();
  if (IS_LAOKUAI) return null;
  return (
    <SettingsContainer>
      <h2 className="text-lg">{i18n.t("ui.supportGryt")}</h2>

      <span className="text-sm text-gryt-muted">{i18n.t("settingsFull.m7929b93c35")}</span>

      <Surface className="p-4">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <FaGithub size={18} />
            <span className="text-base font-medium">{i18n.t("settingsFull.m9becc508c5")}</span>
          </div>
          <span className="text-sm text-gryt-muted">{i18n.t("settingsFull.m8da37a7bb2")}</span>
          <Button size="small"
            tone="neutral"
            render={
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" />
            }
          >
            <FaGithub size={16} />{i18n.t("settingsFull.m9becc508c5")}<PiArrowSquareOutFill size={14} />
          </Button>
        </div>
      </Surface>

      <Surface className="p-4">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <PiHeartFill size={18} />
            <span className="text-base font-medium">{i18n.t("settingsFull.mf22fdf3f11")}</span>
          </div>
          <span className="text-sm text-gryt-muted">{i18n.t("settingsFull.mab56ffbe7a")}</span>
          <div className="flex flex-wrap gap-2">
            <Button size="small"
              render={
                <a href={SPONSORS_URL} target="_blank" rel="noopener noreferrer" />
              }
            >
              <PiHeartFill size={16} />{i18n.t("settingsFull.m9131883df2")}<PiArrowSquareOutFill size={14} />
            </Button>
            <Button size="small"
              tone="neutral"
              render={
                <a href={SPONSORS_PAGE_URL} target="_blank" rel="noopener noreferrer" />
              }
            >{i18n.t("settingsFull.m6e3f859e7d")}<PiArrowSquareOutFill size={14} />
            </Button>
          </div>
        </div>
      </Surface>

      <Surface className="p-4">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <SiKofi size={18} />
            <span className="text-base font-medium">{i18n.t("settingsFull.mfa68766f16")}</span>
          </div>
          <span className="text-sm text-gryt-muted">{i18n.t("settingsFull.m684698e1e9")}</span>
          <Button size="small"
            tone="neutral"
            render={
              <a href={KOFI_URL} target="_blank" rel="noopener noreferrer" />
            }
          >
            <SiKofi size={16} />{i18n.t("settingsFull.mfa68766f16")}<PiArrowSquareOutFill size={14} />
          </Button>
        </div>
      </Surface>
    </SettingsContainer>
  );
}

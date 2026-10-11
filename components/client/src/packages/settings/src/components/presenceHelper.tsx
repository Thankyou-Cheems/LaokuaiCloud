import { Button } from "@gryt/ui";

import { i18n, useTranslation } from "@/i18n";

import type { usePresenceHelper } from "../hooks/usePresenceHelper";
import { HowItWorks } from "./howItWorks";
import { helperCopy, helperStateLine } from "./presenceHelperCopy";
import { settingsMessage } from "./settingsMessage";

/** Off until somebody turns it on here. Nothing else registers it (GRYT-1605). */
export function PresenceHelperSettings({ helper }: { helper: ReturnType<typeof usePresenceHelper> }) {
  useTranslation();
  if (!helper.offered) return null;
  const line = helperStateLine({ ...helper, error: helper.error ? settingsMessage(helper.error) : helper.error }, (key, values) => i18n.t(key, values));

  return (
    <div id="gryt-helper" className="flex flex-col gap-1 rounded-md px-2 py-2" style={{ background: "var(--gryt-neutral-3)" }}>
      <span className="text-sm font-medium">{i18n.t("settingsFull.mfd29f6356e", { defaultValue: helperCopy.title })}</span>
      <HowItWorks>
        <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.m6662c2e95c", { defaultValue: helperCopy.about })}</span>
        <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.mf4855f1024", { defaultValue: helperCopy.cost })}</span>
      </HowItWorks>
      {line && (
        <span
          className="text-xs"
          role={line.warn ? "status" : undefined}
          style={line.warn ? { color: "var(--gryt-warning-11)" } : undefined}
        >
          {line.text}
        </span>
      )}
      <div className="flex items-center gap-2" style={{ marginTop: 4 }}>
        {helper.enabledAt ? (
          <>
            <Button size="xsmall" tone="neutral" disabled={helper.busy} onClick={() => void helper.set(false)}>
              {i18n.t("settingsFull.m4bfbde856e", { defaultValue: helperCopy.turnOff })}
            </Button>
            <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.m45eb0c2747", { defaultValue: helperCopy.offNote })}</span>
          </>
        ) : (
          <Button id="gryt-helper-on" size="xsmall" disabled={helper.busy} onClick={() => void helper.set(true)}>
            {i18n.t("settingsFull.m4df5a435c2", { defaultValue: helperCopy.turnOn })}
          </Button>
        )}
      </div>
    </div>
  );
}

import type { ReactNode } from "react";

import { i18n, useTranslation } from "@/i18n";

/** Explanations stay one click away, so a settings page shows its controls first. */
export function HowItWorks({ children, label = i18n.t("settingsFull.mb895a8c34e") }: { children: ReactNode; label?: string }) {
  useTranslation();
  return (
    <details className="flex flex-col gap-1">
      <summary className="text-xs text-gryt-muted" style={{ cursor: "pointer", width: "fit-content" }}>
        {label}
      </summary>
      <div className="flex flex-col gap-1" style={{ marginTop: 4 }}>
        {children}
      </div>
    </details>
  );
}

import { Button, Chip, Switch } from "@gryt/ui";
import { useEffect, useState } from "react";

import type { AddonManifest, AddonUpdate } from "@/addons";
import {
  addonRisk,
  CAPABILITY_LABELS,
  CAPABILITY_RISK,
  declaredCapabilities,
  grantedCapabilities,
  RISK_LABELS,
  setGrantedCapabilities,
} from "@/addons";
import { useAddons } from "@/addons";
import { i18n, useTranslation } from "@/i18n";

import { getElectronAPI, isElectron } from "../../../../lib/electron";
import { PiFolderFill } from "../../../../lib/icons";
import { SettingsContainer } from "./settingsComponents";

function useAddonAssetUrl(
  addonId: string,
  relativePath?: string
): string | null {
  const [url, setUrl] = useState<string | null>(
    relativePath ? `/addons/${addonId}/${relativePath}` : null
  );

  useEffect(() => {
    let cancelled = false;

    if (!relativePath) {
      setUrl(null);
      return;
    }

    if (!isElectron()) {
      setUrl(`/addons/${addonId}/${relativePath}`);
      return;
    }

    const api = getElectronAPI();
    if (!api) {
      setUrl(null);
      return;
    }

    api
      .resolveAddonAsset(addonId, relativePath)
      .then((resolved) => {
        if (!cancelled) {
          setUrl(resolved);
        }
      })
      .catch((err) => {
        console.error(
          `[AddonsSettings] Failed to resolve asset ${addonId}/${relativePath}:`,
          err
        );
        if (!cancelled) {
          setUrl(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [addonId, relativePath]);

  return url;
}

/**
 * What each addon's repository says is newer, keyed by addon id. Checked when
 * this screen opens rather than on a timer, so it cannot spend a rate limit.
 */
function useAddonUpdates(): Record<string, AddonUpdate> {
  const [updates, setUpdates] = useState<Record<string, AddonUpdate>>({});

  useEffect(() => {
    if (!isElectron()) return;

    const api = getElectronAPI();
    // Absent on a build older than this feature, and the page still works.
    if (!api?.checkAddonUpdates) return;

    let cancelled = false;

    api
      .checkAddonUpdates()
      .then((found) => {
        if (cancelled) return;
        setUpdates(
          Object.fromEntries(found.map((update) => [update.addonId, update])),
        );
      })
      .catch(() => {
        // Offline, or GitHub is having a day. The page is still the page.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return updates;
}

function AddonCard({
  addon,
  enabled,
  onToggle,
  update,
}: {
  addon: AddonManifest;
  enabled: boolean;
  onToggle: () => void;
  update?: AddonUpdate;
}) {
  useTranslation();
  const isTheme = addon.type === "theme";
  const bannerUrl = useAddonAssetUrl(addon.id, addon.banner);

  return (
    <div style={{
        borderRadius: "var(--gryt-radius-md)",
        border: "1px solid var(--gryt-neutral-5)",
        overflow: "hidden",
        background: "var(--gryt-neutral-2)",
      }}>
      <div style={{
          height: 120,
          background: bannerUrl
            ? undefined
            : isTheme
            ? "linear-gradient(135deg, var(--gryt-accent-9), var(--gryt-accent-9))"
            : "linear-gradient(135deg, var(--gryt-secondary-9), var(--gryt-secondary-9))",
          backgroundImage: bannerUrl ? `url(${bannerUrl})` : undefined,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }} />

      <div className="flex flex-col gap-2 p-3">
        <div className="flex justify-between items-start">
          <div className="flex flex-col gap-1" style={{ minWidth: 0, flex: 1 }}>
            <div className="flex items-center gap-2 flex-wrap">
              <Chip tone="neutral"
                color={isTheme ? "purple" : "blue"}
              >
                {isTheme ? i18n.t("ui.theme") : i18n.t("settingsFull.m8dc208f8eb")}
              </Chip>
              <span className="text-xs text-gryt-muted">
                v{addon.version}
              </span>
              {update && (
                <Chip tone="neutral" color="green">{i18n.t("settingsFull.m689b784687", { version: update.latest })}</Chip>
              )}
              {!isTheme && addon.requiresReloadOnDisable && (
                <Chip tone="warning" label={i18n.t("settingsFull.m32b6cc8f2f")} />
              )}
            </div>
            <span className="font-bold text-base truncate">
              {addon.name}
            </span>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={onToggle}
            style={{ flexShrink: 0 }}
          />
        </div>

        {addon.description && (
          <span className="text-sm text-gryt-muted" style={{
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}>
            {addon.description}
          </span>
        )}

        {addon.author && (
          <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.m7e144e1015", { author: addon.author })}</span>
        )}

        <AddonCapabilities addon={addon} />

        {/* Opens the release rather than installing it. Replacing an addon's
            files means running whatever the repository publishes next, so the
            step where somebody looks at it first is the point, not a gap. */}
        {update && (
          <Button tone="neutral" size="small"
            onClick={() => getElectronAPI()?.openExternal(update.releaseUrl)}
          >{i18n.t("settingsFull.mc7872a2d6b", { version: update.latest })}</Button>
        )}
      </div>
    </div>
  );
}

const RISK_TONES = {
  low: { bg: "var(--gryt-success-3)", fg: "var(--gryt-success-11)" },
  medium: { bg: "var(--gryt-warning-3)", fg: "var(--gryt-warning-11)" },
  high: { bg: "var(--gryt-danger-3)", fg: "var(--gryt-danger-11)" },
} as const;

/** How much an addon could do, going by the riskiest thing it asks for. */
function RiskBadge({ risk }: { risk: ReturnType<typeof addonRisk> }) {
  useTranslation();
  if (!risk) return null;
  const tone = RISK_TONES[risk];
  return (
    <span className="self-start rounded-md px-2 py-0.5 text-xs font-bold" style={{ background: tone.bg, color: tone.fg }}>{i18n.t("settingsFull.m89429d8a2f", { risk: i18n.t("settingsFull.riskDescription." + risk, { defaultValue: RISK_LABELS[risk] }) })}</span>
  );
}

/**
 * What a plugin asked for, and whether it may have it. Drawn only for a plugin
 * that asks for something; most do not (GRYT-928).
 */
function AddonCapabilities({ addon }: { addon: AddonManifest }) {
  useTranslation();
  const declared = declaredCapabilities(addon.capabilities);
  const [granted, setGranted] = useState(() => grantedCapabilities(addon.id));

  if (declared.length === 0) return null;

  const toggle = (capability: (typeof declared)[number]) => {
    const next = granted.includes(capability)
      ? granted.filter((c) => c !== capability)
      : [...granted, capability];
    setGranted(next);
    setGrantedCapabilities(addon.id, next);
  };

  return (
    <div className="flex flex-col gap-1" style={{ marginTop: 4 }}>
      <RiskBadge risk={addonRisk(declared)} />
      <span className="text-xs font-bold text-gryt-muted">{i18n.t("settingsFull.m55714af060")}</span>
      {declared.map((capability) => (
        <label key={capability} className="flex items-center justify-between gap-2 text-sm">
          <span>
            {i18n.t("settingsFull.capability." + capability, { defaultValue: CAPABILITY_LABELS[capability] })}{" "}
            <span className="text-xs text-gryt-muted">({i18n.t("settingsFull.risk." + CAPABILITY_RISK[capability])})</span>
          </span>
          <Switch
            checked={granted.includes(capability)}
            onCheckedChange={() => toggle(capability)}
            style={{ flexShrink: 0 }}
          />
        </label>
      ))}
      <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.md7b2bf0ddd")}</span>
    </div>
  );
}

export function AddonsSettings() {
  useTranslation();
  const { addons, enabledIds, toggleAddon, openAddonsFolder } = useAddons();
  const updates = useAddonUpdates();
  const inElectron = isElectron();

  return (
    <SettingsContainer>
      <div className="flex justify-between items-center">
        <h2 className="text-lg">{i18n.t("ui.addons")}</h2>
        {inElectron && (
          <Button tone="neutral" size="small"
            onClick={openAddonsFolder}
          >
            <PiFolderFill size={16} />{i18n.t("settingsFull.m2db01c2f80")}</Button>
        )}
      </div>

      {addons.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12" style={{ color: "var(--gryt-neutral-9)" }}>
          <span className="text-sm text-gryt-muted">{i18n.t("settingsFull.m1309f0aa75")}</span>
          {/*
            Every other empty state in the app offers somewhere to go. This one
            described a file format and stopped, which reads as an error to
            anyone who has not written an addon before.
          */}
          <span className="text-xs text-gryt-muted text-center" style={{ maxWidth: 380 }}>
            {inElectron
              ? i18n.t("settingsFull.m2b361ab2cb")
              : i18n.t("settingsFull.mfb0d730fd8")}
          </span>
          <a className="gryt-link"
            href="https://docs.gryt.chat/docs"
            target="_blank"
            rel="noreferrer"
          >{i18n.t("settingsFull.m61c84c89ac")}</a>
        </div>
      ) : (
        <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
            gap: "12px",
          }}>
          {addons.map((addon) => (
            <AddonCard
              key={addon.id}
              addon={addon}
              enabled={enabledIds.has(addon.id)}
              onToggle={() => toggleAddon(addon.id)}
              update={updates[addon.id]}
            />
          ))}
        </div>
      )}
    </SettingsContainer>
  );
}

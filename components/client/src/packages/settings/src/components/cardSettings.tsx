import { Button, CardIcon, Checkbox, CopyCardLink, createGrytTheme, Dialog, GrytProvider, grytTheme, grytThemeToOptions, MemberCardEditor, seedFromId, TextField, Toggle, ToggleGroup } from "@gryt/ui";
import { UserCircle } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";

import {
  generatedAvatarColor,
  getOwnServerUserId,
  getServerAccessToken,
  getServerHttpBase,
  getStoredWorn,
  getUploadsFileUrl,
  resolveAvatarSrc,
  useCustomThemes,
  useTheme,
} from "@/common";
import { i18n, useTranslation } from "@/i18n";
import { useSettings } from "@/settings";
import { useServerManagement, useSockets } from "@/socket";

import type { RichActivity } from "../../../../lib/richActivity";
import { takeSharedLook, useSharedLook } from "../../../../lib/sharedLook";
import { useCardEmojiGroups } from "../../../socket/src/components/memberCard/cardEmojiGroups";
import { MemberCardView } from "../../../socket/src/components/memberCard/MemberCardView";
import { type CardPreset, forgetCardPreset, saveCardPreset, useCardPresets } from "../../../socket/src/lib/memberCard/cardPresets";
import {
  cardUpdatePayload,
  EMPTY_CARD,
  isDefaultCard,
  setStoredCard,
  useStoredCard,
} from "../../../socket/src/lib/memberCard/cardStore";
import {
  BIO_MAX,
  type CardProfile,
  cardText,
  decodeCardStyle,
  PRONOUNS_MAX,
  STATUS_LINE_MAX,
} from "../../../socket/src/lib/memberCard/cardStyle";
import { isStillPicture } from "./bannerCrop";
import { BannerCropDialog } from "./BannerCropDialog";
import { CardPresetTile } from "./CardPresetTile";
import { SettingGroup, SettingsContainer } from "./settingsComponents";

/** A game for the preview when you are not playing one, so the band can be seen. */
const SAMPLE_GAME: RichActivity = {
  type: "playing",
  name: "Minecraft",
  appId: "1402418491272986635",
  details: "Harbourtown SMP",
  get state() { return i18n.t("settingsFull.mfe88ea8d5f"); },
  party: { size: 2, max: 8 },
  startedAt: Date.now() - (23 * 60 + 41) * 1000,
};


async function sendBanner(host: string, file: File | null): Promise<void> {
  const token = getServerAccessToken(host);
  if (!token) throw new Error(i18n.t("settingsFull.m15039ae0b1"));
  const form = new FormData();
  if (file) form.append("file", file, file.name || "banner");
  const r = await fetch(`${getServerHttpBase(host)}/api/uploads/banner`, {
    method: file ? "POST" : "DELETE",
    headers: { Authorization: `Bearer ${token}` },
    body: file ? form : undefined,
  });
  if (r.status === 404) throw new Error(i18n.t("settingsFull.md1abbcd7bc"));
  if (!r.ok) throw new Error((await r.text().catch(() => "")) || `HTTP ${r.status}`);
}

export function CardSettings() {
  useTranslation();
  const stored = useStoredCard();
  const { sockets, serverProfiles, serverDetailsList, memberLists } = useSockets();
  const { servers } = useServerManagement();
  const { nickname, avatarDataUrl, gameCard } = useSettings();
  const { activeTheme } = useCustomThemes();
  const { resolvedAppearance } = useTheme();
  const emojiGroups = useCardEmojiGroups();

  const hosts = Object.keys(servers);
  const connected = hosts.filter((h) => sockets[h]?.connected);

  /* What you have: this device's copy, or what a server holds for you on a new device. */
  const fromServer = hosts.map((h) => serverProfiles[h]?.card).find((c) => c && !isDefaultCard(c));
  const saved = stored ?? fromServer ?? EMPTY_CARD;
  const [draft, setDraft] = useState<CardProfile>(saved);
  const [playing, setPlaying] = useState(true);
  const [stage, setStage] = useState<"light" | "dark">(resolvedAppearance);
  const [refusals, setRefusals] = useState<Record<string, string>>({});

  /* Refusals come back per server, so they are shown per server rather than as a toast. */
  useEffect(() => {
    const off = connected.map((host) => {
      const socket = sockets[host];
      const onError = (message: unknown) => {
        if (typeof message === "string") setRefusals((prev) => ({ ...prev, [host]: message }));
      };
      socket?.on("profile:error", onError);
      return () => socket?.off("profile:error", onError);
    });
    return () => off.forEach((fn) => fn());
  }, [connected.join(" "), sockets]); // eslint-disable-line react-hooks/exhaustive-deps

  /*
   * The one setting with a Save button: every change was an update to each server, and a
   * few quick picks ran into the server's limit of ten card updates in ten seconds.
   */
  const commit = (next: CardProfile) => setDraft(next);
  const cardDirty = JSON.stringify(cardUpdatePayload(draft)) !== JSON.stringify(cardUpdatePayload(saved));

  /** `banner` is what this Save sent: a file, null for removed, undefined for untouched. */
  const saveCard = (banner: Blob | null | undefined) => {
    setStoredCard(draft);
    void saveCardPreset(draft.cardStyle, banner);
    setRefusals({});
    const payload = cardUpdatePayload(draft);
    for (const host of Object.keys(sockets)) {
      if (sockets[host]?.connected) sockets[host]?.emit("profile:update", payload);
    }
  };

  const style = draft.cardStyle;
  const presets = useCardPresets();

  /* A link from somebody, or from the card builder: shown in the editor, and only kept on Save. */
  const showShared = (text: string): boolean => {
    const next = decodeCardStyle(text);
    if (!next) return false;
    setDraft((d) => ({ ...d, cardStyle: next }));
    setEditing(true);
    return true;
  };
  const pasteLink = () => {
    void navigator.clipboard.readText().then(
      (text) => {
        if (!showShared(text)) toast.error(i18n.t("settingsFull.mbb7c179a8c"));
      },
      () => toast.error(i18n.t("settingsFull.m63d97252e2")),
    );
  };
  const shared = useSharedLook().card;
  useEffect(() => {
    if (!shared) return;
    const text = takeSharedLook("card");
    if (text && !showShared(text)) toast.error(i18n.t("settingsFull.mba7a69dccb"));
  }, [shared]);

  const text = (key: "bio" | "pronouns" | "statusLine", max: number) => ({
    value: draft[key] ?? "",
    maxLength: max,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, [key]: e.target.value }),
    onBlur: () => setDraft({ ...draft, [key]: cardText(draft[key], max) }),
  });

  /* Only where you hold `upload_banner_image`; a server that doesn't say is left out. */
  const mayUpload = (host: string) => {
    const info = serverDetailsList[host]?.server_info;
    const permissions = info?.permissions;
    if (!Array.isArray(permissions)) return false;
    if (permissions.includes("upload_banner_image")) return true;
    return !info?.permission_catalogue?.includes("upload_banner_image") && permissions.includes("upload_avatar_image");
  };
  const bannerHosts = connected.filter(mayUpload);
  const videoBannerHosts = bannerHosts.filter((h) => serverDetailsList[h]?.server_info?.video_profiles === true);
  const [bannerPreview, setBannerPreview] = useState<string | null>();
  const [pendingBanner, setPendingBanner] = useState<File | null>();
  const [editing, setEditing] = useState(false);
  const [bannerBusy, setBannerBusy] = useState(false);
  const [cropping, setCropping] = useState<File | null>(null);
  const bannerInput = useRef<HTMLInputElement>(null);
  const serverBanner = useMemo(() => {
    for (const host of connected) {
      const me = memberLists[host]?.find((m) => m.serverUserId === getOwnServerUserId(host));
      if (me?.bannerFileId) return getUploadsFileUrl(host, me.bannerFileId);
    }
    return null;
  }, [connected.join(" "), memberLists]); // eslint-disable-line react-hooks/exhaustive-deps
  const serverBannerIsVideo = useMemo(() => {
    for (const host of connected) {
      const me = memberLists[host]?.find((m) => m.serverUserId === getOwnServerUserId(host));
      if (me?.bannerFileId) return !!me.bannerVideo;
    }
    return false;
  }, [connected.join(" "), memberLists]); // eslint-disable-line react-hooks/exhaustive-deps
  const bannerUrl = bannerPreview === undefined ? serverBanner : bannerPreview;
  // A picked file says its own type; the server's says it in the member list.
  const bannerType: "image" | "video" = bannerPreview === undefined
    ? (serverBannerIsVideo ? "video" : "image")
    : pendingBanner?.type.startsWith("video/") ? "video" : "image";
  const dirty = cardDirty || pendingBanner !== undefined;

  const changeBanner = (file: File | null) => {
    if (bannerPreview?.startsWith("blob:")) URL.revokeObjectURL(bannerPreview);
    setBannerPreview(file ? URL.createObjectURL(file) : null);
    setPendingBanner(file);
  };

  /* A preset kept from before banners were saved leaves the banner as it is. */
  const pickPreset = (preset: CardPreset) => {
    setDraft({ ...draft, cardStyle: preset.style });
    if (preset.banner) changeBanner(new File([preset.banner], "banner", { type: preset.banner.type }));
    else if (preset.banner === null && bannerUrl) changeBanner(null);
  };

  const save = async () => {
    const sent = pendingBanner;
    setBannerBusy(true);
    const results = pendingBanner === undefined
      ? []
      // A video only goes where it is taken; the other servers keep the banner they have.
      : await Promise.allSettled(
        (pendingBanner?.type.startsWith("video/") ? videoBannerHosts : bannerHosts).map((h) => sendBanner(h, pendingBanner)),
      );
    setBannerBusy(false);
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    if (results.length > 0 && failed.length === results.length) {
      toast.error(i18n.t("settingsFull.m166f717d8f", { action: pendingBanner ? i18n.t("settingsFull.mbb73aaafa1") : i18n.t("settingsFull.mdb99845855"), reason: failed[0]?.reason?.message ?? i18n.t("settingsFull.mb19f2a5e86") }));
      return;
    }
    if (pendingBanner !== undefined) {
      setPendingBanner(undefined);
      for (const h of bannerHosts) sockets[h]?.emit("avatar:updated");
    }
    saveCard(sent);
    toast.success(failed.length ? i18n.t("settingsFull.m2860406885", { count: failed.length }) : i18n.t("settingsFull.mcdb2004afb"));
  };

  const worn = getStoredWorn();
  const owlHex = generatedAvatarColor(nickname, worn) ?? "#7c5cff";
  // Your id on the first server you're on seeds a scatter pattern, as it does on your card there.
  const seedKey = (connected[0] && getOwnServerUserId(connected[0])) || nickname;
  const seed = seedFromId(seedKey);
  const preview = (appearance: "light" | "dark") => (
    <GrytProvider
      className="flex flex-col gap-2 bg-gryt-bg p-4 text-gryt-muted"
      theme={createGrytTheme(grytThemeToOptions(activeTheme ?? grytTheme, appearance))}
    >
            <MemberCardView
        name={nickname}
        avatarSrc={resolveAvatarSrc(avatarDataUrl, nickname, worn)}
        status="online"
        profile={draft}
        owlHex={owlHex}
        bannerUrl={bannerUrl}
        bannerType={bannerType}
        game={playing ? gameCard ?? SAMPLE_GAME : null}
        appearance={appearance}
        seedKey={seedKey}
        worn={worn}
      >
        {/* What other people get, drawn but not pressable: this card is yours. */}
        <div className="gmc-acts" aria-hidden="true">
          <span className="gmc-ib"><CardIcon.chat /></span>
          <span className="gmc-ib"><CardIcon.friend /></span>
          <span className="gmc-ib quiet"><CardIcon.at /></span>
          {worn && <span className="gmc-ib quiet"><CardIcon.copy /></span>}
          <span className="sp" />
          <span className="gmc-ib danger"><CardIcon.flag /></span>
          <span className="gmc-ib quiet"><CardIcon.more /></span>
        </div>
        <details className="gmc-who" aria-hidden="true">
          <summary tabIndex={-1} onClick={(e) => e.preventDefault()}>{i18n.t("settingsFull.m26d829a218")}<CardIcon.caret />
          </summary>
        </details>
      </MemberCardView>
    </GrytProvider>
  );

  const refused = Object.entries(refusals);

  const about = (
    <>
      <SettingGroup anchorId="pronouns" title={i18n.t("settingsFull.m8a2abafdb9")} description={i18n.t("settingsFull.m24e578667e")}>
        <TextField placeholder="she/her, they/them…" {...text("pronouns", PRONOUNS_MAX)} />
      </SettingGroup>

      <SettingGroup anchorId="bio" title={i18n.t("settingsFull.mb31fc969b4")} description={i18n.t("settingsFull.m6829e06138", { value0: BIO_MAX })}>
        <TextField multiline minRows={2} placeholder={i18n.t("settingsFull.m533f8ce52b")} {...text("bio", BIO_MAX)} />
      </SettingGroup>

      <SettingGroup anchorId="status-line" title={i18n.t("settingsFull.m79f8bb09cc")} description={i18n.t("settingsFull.m210f3a4218")}>
        <TextField placeholder={i18n.t("settingsFull.mcf07a594c7")} {...text("statusLine", STATUS_LINE_MAX)} />
      </SettingGroup>

      {bannerHosts.length > 0 && (
        <SettingGroup
          anchorId="banner"
          title={i18n.t("settingsFull.mc8af83fb4c")}
          description={
            bannerHosts.length === connected.length
              ? i18n.t("settingsFull.m9d6b4abd3f")
              : i18n.t("settingsFull.m9db7af763a", { value0: bannerHosts.length })
          }
        >
          <span className="text-xs text-gryt-muted">
            {videoBannerHosts.length === 0
              ? i18n.t("settingsFull.mb66b3ab6cd")
              : videoBannerHosts.length < bannerHosts.length
                ? i18n.t("settingsFull.m5bec937dd5", { value0: videoBannerHosts.length })
                : i18n.t("settingsFull.m2ee2332ffe")}
          </span>
          <div className="flex flex-wrap gap-2">
            <Button size="small" disabled={bannerBusy} onClick={() => bannerInput.current?.click()}>
              {bannerUrl ? i18n.t("settingsFull.m0ad38169fc") : i18n.t("settingsFull.me8a47c0701")}
            </Button>
            {bannerUrl && (
            <Button size="small" tone="neutral" disabled={bannerBusy} onClick={() => changeBanner(null)}>{i18n.t("settingsFull.mc8da6e814a")}</Button>
            )}
          </div>
          <input
            ref={bannerInput}
            type="file"
            accept={videoBannerHosts.length > 0 ? "image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm" : "image/png,image/jpeg,image/webp,image/gif"}
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              void isStillPicture(file).then((still) => (still ? setCropping(file) : changeBanner(file)));
            }}
          />
          <BannerCropDialog
            file={cropping}
            onDone={(cropped) => {
              setCropping(null);
              if (cropped) changeBanner(cropped);
            }}
          />
        </SettingGroup>
      )}
    </>
  );

  return (
    <SettingsContainer>
      <div className="flex flex-col gap-1">
        <h2 className="text-lg">{i18n.t("ui.editMyCard")}</h2>
        <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.m9770333e80")}</span>
      </div>

      <div className="flex flex-wrap items-start gap-6">
        <div className="overflow-hidden rounded-(--gryt-radius-lg) border border-gryt-border" style={{ flex: "0 1 352px", maxWidth: "100%" }}>
          {preview(stage)}
        </div>
        <div className="flex flex-col gap-2" style={{ flex: "1 1 200px" }}>
          <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.m7d2b2f1680")}</span>
          <div>
            <Button size="small" onClick={() => setEditing(true)}>{i18n.t("settingsFull.m295dd35435")}</Button>
          </div>
        </div>
      </div>

      <Dialog.Root open={editing} onOpenChange={(open) => setEditing(open)}>
        <Dialog.Portal>
          <Dialog.Backdrop />
          {/* Laid out like the owl designer: panes on the left, the card on the right, nothing long to scroll. */}
          <Dialog.Popup className="flex h-[min(46rem,calc(100dvh-2rem))] w-[64rem] max-w-[calc(100vw-2rem)] flex-col overflow-x-hidden p-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gryt-border px-4 py-3">
              <Dialog.Title className="text-lg">{i18n.t("ui.editMyCard")}</Dialog.Title>
              <div className="flex flex-wrap items-center gap-2">
                {dirty && <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.m0a1dc843df")}</span>}
                <CopyCardLink style={style} link={(code) => `https://ui.gryt.chat/card${code ? `?${code}` : ""}`} />
                <Button size="small" tone="neutral" onClick={pasteLink}>{i18n.t("settingsFull.m03592260b9")}</Button>
                <Button size="small" tone="neutral" disabled={!dirty} onClick={() => {
                  setDraft(saved);
                  if (bannerPreview?.startsWith("blob:")) URL.revokeObjectURL(bannerPreview);
                  setBannerPreview(undefined);
                  setPendingBanner(undefined);
                }}>{i18n.t("settingsFull.m6f5e3125e1")}</Button>
                <Button size="small" disabled={!dirty || bannerBusy} onClick={() => void save()}>{i18n.t("settingsFull.mefc007a393")}</Button>
                <Dialog.Close render={<Button size="small" tone="neutral" />}>{i18n.t("ui.close")}</Dialog.Close>
              </div>
            </div>
            <div className="@container flex min-h-0 flex-1 flex-col overflow-y-auto">
              <div className="flex min-h-0 flex-1 @max-3xl:flex-col">
                <MemberCardEditor
                  value={style}
                  onChange={(next) => commit({ ...draft, cardStyle: next })}
                  owlHex={owlHex}
                  nickname={nickname}
                  worn={worn}
                  seed={seed}
                  appearance={stage}
                  bannerUrl={bannerUrl}
                  emojiGroups={emojiGroups}
                  panes={[{ value: "about", label: i18n.t("settingsFull.m5c4698b6e0"), icon: <UserCircle weight="fill" size={16} />, content: about }]}
                />
                <figure className="m-0 flex shrink-0 flex-col gap-3 border-gryt-border bg-gryt-surface p-4 @max-3xl:border-t @3xl:w-[24rem] @3xl:border-l">
                  <figcaption className="flex flex-wrap items-center justify-between gap-3 text-xs font-bold text-gryt-muted">
                    <ToggleGroup
                      value={[stage]}
                      onValueChange={(v) => setStage(v[0] === "light" ? "light" : v[0] === "dark" ? "dark" : stage)}
                      aria-label={i18n.t("settingsFull.m60840bec92")}
                    >
                      <Toggle value="light" size="small">{i18n.t("settingsFull.m23595da679")}</Toggle>
                      <Toggle value="dark" size="small">{i18n.t("settingsFull.m250691a6e2")}</Toggle>
                    </ToggleGroup>
                    <label className="flex items-center gap-2 font-normal text-gryt-text">
                      <Checkbox checked={playing} onCheckedChange={(on) => setPlaying(on === true)} />
                      {gameCard ? i18n.t("settingsFull.mbf88d20937") : i18n.t("settingsFull.m0b002cee04")}
                    </label>
                  </figcaption>
                  <div className="overflow-hidden rounded-(--gryt-radius-lg) border border-gryt-border">{preview(stage)}</div>
                  {presets.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[0.65rem] font-semibold tracking-wider text-gryt-muted uppercase">{i18n.t("settingsFull.mc503a9e25e")}</span>
                      <div className="flex flex-wrap gap-2">
                        {presets.map((preset) => (
                          <CardPresetTile key={preset.id} preset={preset} onPick={() => pickPreset(preset)} onForget={() => void forgetCardPreset(preset.id)} />
                        ))}
                      </div>
                    </div>
                  )}
                  {refused.length > 0 && (
                    <div className="flex flex-col gap-1 text-xs text-gryt-danger">
                      {refused.map(([host, message]) => (
                        <span key={host}>
                          {servers[host]?.name || host}: {message}
                        </span>
                      ))}
                    </div>
                  )}
                </figure>
              </div>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </SettingsContainer>
  );
}

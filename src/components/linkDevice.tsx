/* Hallmark · component: dialog · genre: modern-minimal · theme: @gryt/ui (design.md)
 * states carried by @gryt/ui Button, Spinner and Alert; the QR is the one new element. */
import type { HistoryProgress, NewDeviceState } from "@gryt/core";
import { Alert, Button, Dialog, IconButton, Progress } from "@gryt/ui";
import { useMemo } from "react";
import { encode } from "uqr";

import { i18n, LocalizedText, useTranslation } from "@/i18n";

import { PiX } from "../lib/icons";
import { historyLines, newDeviceEndText } from "../lib/pairing/newDeviceWords";
import { useLinkDevice } from "../lib/pairing/useLinkDevice";
import { useSecondsLeft } from "../lib/pairing/useSecondsLeft";
import { EmojiRow, Waiting } from "./pairingParts";

/** Black on white whatever the theme: phone cameras read a light-on-dark code badly. */
function QrCode({ text }: { text: string }) {
  useTranslation();
  const path = useMemo(() => {
    const { data } = encode(text, { ecc: "M", border: 0 });
    let d = "";
    data.forEach((row, y) => row.forEach((dark, x) => { if (dark) d += `M${x} ${y}h1v1h-1z`; }));
    return { d, size: data.length };
  }, [text]);

  return (
    <svg
      role="img"
      aria-label={i18n.t("shellFull.linkDevice_tsx_9a75a6128d")}
      viewBox={`-3 -3 ${path.size + 6} ${path.size + 6}`}
      className="h-52 w-52 rounded-[var(--gryt-radius-md)]"
      shapeRendering="crispEdges"
    >
      <rect x={-3} y={-3} width={path.size + 6} height={path.size + 6} fill="#fff" />
      <path d={path.d} fill="#000" />
    </svg>
  );
}

function History({ progress }: { progress: HistoryProgress | null }) {
  useTranslation();
  const lines = historyLines(progress, i18n);
  if (!progress || !lines.length) return null;
  const share = progress.total ? Math.min(progress.messages, progress.total) / progress.total : null;
  return (
    <div className="flex flex-col gap-2" role="status">
      {lines.map((line) => (
        <span key={line} className="text-sm">{line}</span>
      ))}
      {!progress.complete && <Progress value={share === null ? null : share * 100} aria-label={i18n.t("shellFull.linkDevice_tsx_1c787de664")} />}
    </div>
  );
}

function Body({ state, replaces, history }: { state: NewDeviceState | null; replaces: number; history: HistoryProgress | null }) {
  useTranslation();
  const { start, close, mismatch } = useLinkDevice();
  const secondsLeft = useSecondsLeft(state?.phase === "comparing" ? state.deadline : null);

  if (!state) {
    return (
      <div className="flex flex-col gap-3">
        <Alert severity="warning">{<LocalizedText translationKey="shellFull.linkDevice_tsx_f22f8cee12" />}</Alert>
        <div className="flex flex-wrap gap-2">
          <Button size="small" onClick={start}>{<LocalizedText translationKey="shellFull.linkDevice_tsx_93309d0fbd" />}</Button>
          <Button size="small" tone="neutral" onClick={close}>{<LocalizedText translationKey="shellFull.linkDevice_tsx_77dfd2135f" />}</Button>
        </div>
      </div>
    );
  }

  switch (state.phase) {
    case "idle":
    case "opening":
      return <Waiting>{<LocalizedText translationKey="shellFull.linkDevice_tsx_b5ffe4bb68" />}</Waiting>;

    case "showing":
      return (
        <div className="flex flex-col items-center gap-4">
          <Dialog.Description className="m-0 self-stretch">{<LocalizedText translationKey="shellFull.linkDevice_tsx_acc4d209ca" />}</Dialog.Description>
          <QrCode text={state.qr} />
          <code className="font-mono text-2xl tracking-[0.2em] text-gryt-text select-all" aria-label={i18n.t("shellFull.linkDevice_tsx_5c210ffd57")}>
            {state.code}
          </code>
          {state.renewed === "timed_out" && (
            <span className="text-xs text-gryt-muted">{<LocalizedText translationKey="shellFull.linkDevice_tsx_2c07b7d8bb" />}</span>
          )}
          <Waiting>{<LocalizedText translationKey="shellFull.linkDevice_tsx_f29a407c9a" />}</Waiting>
        </div>
      );

    case "comparing":
      return (
        <div className="flex flex-col gap-4">
          <Dialog.Description className="m-0">{<LocalizedText translationKey="shellFull.linkDevice_tsx_3ff8c8d4c5" />}</Dialog.Description>
          <EmojiRow emoji={state.emoji} />
          <span className="text-xs text-gryt-muted" aria-live="off">
            {secondsLeft > 0 ? i18n.t("shellSecond.approveSeconds", { count: secondsLeft }) : i18n.t("shellSecond.approvalExpired")}
          </span>
          <div className="flex flex-wrap gap-2">
            <Button size="small" tone="danger" onClick={mismatch}>{<LocalizedText translationKey="shellFull.linkDevice_tsx_33bd49b26c" />}</Button>
            <Button size="small" tone="neutral" onClick={close}>{<LocalizedText translationKey="shellFull.linkDevice_tsx_77dfd2135f" />}</Button>
          </div>
        </div>
      );

    case "signing_in":
      return <Waiting>{i18n.t("shellFull.signingInAs", { name: state.username })}</Waiting>;

    case "joining":
      return (
        <Waiting>
          {i18n.t("shellFull.joiningServers", { count: state.servers.length })}
        </Waiting>
      );

    case "linked":
    case "done":
      return (
        <div className="flex flex-col gap-3">
          <Dialog.Description className="m-0">
            {i18n.t("shellFull.linkedFrom", { from: state.from })}
            {state.phase === "linked" && i18n.t("shellFull.addingInBackground")}
          </Dialog.Description>
          <History progress={history} />
          <div className="flex flex-wrap gap-2">
            {replaces > 0 ? (
              // A restart now would leave the rest of the history behind.
              <Button size="small" disabled={state.phase === "linked"} onClick={() => window.location.reload()}>{<LocalizedText translationKey="shellFull.linkDevice_tsx_fd3f5d7b77" />}</Button>
            ) : (
              <Button size="small" onClick={close}>{<LocalizedText translationKey="shellFull.linkDevice_tsx_e9b450d14b" />}</Button>
            )}
          </div>
        </div>
      );

    case "ended":
      return (
        <div className="flex flex-col gap-3">
          <Alert severity={state.reason === "mismatch" || state.reason === "tampered" ? "error" : "info"}>
            {newDeviceEndText(state.reason, i18n)}
          </Alert>
          <div className="flex flex-wrap gap-2">
            {state.reason === "history_failed" ? (
              replaces > 0 && <Button size="small" onClick={() => window.location.reload()}>{<LocalizedText translationKey="shellFull.linkDevice_tsx_fd3f5d7b77" />}</Button>
            ) : (
              <Button size="small" onClick={start}>{<LocalizedText translationKey="shellFull.linkDevice_tsx_042c862e44" />}</Button>
            )}
            <Button size="small" tone="neutral" onClick={close}>{<LocalizedText translationKey="shellFull.linkDevice_tsx_bbfa773e5a" />}</Button>
          </div>
        </div>
      );
  }
}

/** Link this device to one already signed in (GRYT-1484), from the new device's side. */
export function LinkDeviceDialog() {
  useTranslation();
  const { isOpen, state, replaces, history, close } = useLinkDevice();
  const title = state?.phase === "comparing" ? i18n.t("shellFull.linkDevice_tsx_2272fa28dc") : i18n.t("shellFull.linkDevice_tsx_bf5e5ccbdc");

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open) close(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup className="w-[26rem] max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <Dialog.Close className="absolute top-3 right-3" render={<IconButton size="small" aria-label={i18n.t("shellFull.linkDevice_tsx_bbfa773e5a")} />}>
            <PiX size={16} />
          </Dialog.Close>
          <Dialog.Title className="pr-10">{title}</Dialog.Title>
          <div className="mt-3">
            <Body state={state} replaces={replaces} history={history} />
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

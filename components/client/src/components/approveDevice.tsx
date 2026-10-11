/* Hallmark · component: dialog · genre: modern-minimal · theme: @gryt/ui (design.md)
 * states carried by @gryt/ui Button, TextField, Progress and Alert; nothing new drawn here. */
import type { ApproverState } from "@gryt/core";
import { parsePairingCode } from "@gryt/crypto";
import { Alert, Button, Dialog, IconButton, Progress, TextField } from "@gryt/ui";
import { useState } from "react";

import { useAccount } from "@/common";
import { i18n, LocalizedText, useTranslation } from "@/i18n";

import { PiX } from "../lib/icons";
import { approverEndText, sendingHistoryText, sentHistoryText } from "../lib/pairing/approverWords";
import { deviceCapLine } from "../lib/pairing/deviceCap";
import { pairingFailureText } from "../lib/pairing/failureText";
import { useApproveDevice } from "../lib/pairing/useApproveDevice";
import { useSecondsLeft } from "../lib/pairing/useSecondsLeft";
import { openUserSettings } from "../packages/socket/src/components/dmKeyWarningToast";
import { EmojiRow, Waiting } from "./pairingParts";

function CodeEntry() {
  useTranslation();
  const { claim, close } = useApproveDevice();
  const [code, setCode] = useState("");
  const [wrong, setWrong] = useState(false);

  const submit = () => {
    if (!parsePairingCode(code)) return setWrong(true);
    claim(code);
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Dialog.Description className="m-0">{<LocalizedText translationKey="shellFull.approveDevice_tsx_d7945b6757" />}</Dialog.Description>
      <TextField
        label={i18n.t("shellFull.approveDevice_tsx_adac69379a")}
        placeholder="XXXX-XXXX"
        autoComplete="off"
        spellCheck={false}
        autoFocus
        value={code}
        error={wrong}
        helperText={wrong ? i18n.t("shellFull.approveDevice_tsx_ba345d029a") : undefined}
        onChange={(e) => {
          setCode(e.target.value);
          setWrong(false);
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button size="small" type="submit" disabled={!code.trim()}>{<LocalizedText translationKey="shellFull.approveDevice_tsx_2e02623966" />}</Button>
        <Button size="small" tone="neutral" onClick={close}>{<LocalizedText translationKey="shellFull.approveDevice_tsx_77dfd2135f" />}</Button>
      </div>
    </form>
  );
}

function Confirm({ state }: { state: Extract<ApproverState, { phase: "confirming" }> }) {
  useTranslation();
  const { approve, deny, mismatch, fullServers, close } = useApproveDevice();
  const { isSignedIn } = useAccount();
  const secondsLeft = useSecondsLeft(state.deadline);
  const { device } = state;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-sm">
          <strong>{device.name || i18n.t("shellFull.approveDevice_tsx_4d60af7c11")}</strong>
          {device.app && `, ${device.app}`}
          {device.platform && i18n.t("shellFull.approveDevice_tsx_d57bcba7ee", { value0: device.platform })}
        </span>
        <span className="text-xs text-gryt-muted">
          {state.location ? i18n.t("shellFull.approveDevice_tsx_6196bceb0c", { value0: state.location }) : i18n.t("shellFull.approveDevice_tsx_016afd794d")}
          {state.yourLocation && i18n.t("shellFull.approveDevice_tsx_b501bf1648", { value0: state.yourLocation })}
        </span>
      </div>
      <EmojiRow emoji={state.emoji} />
      {fullServers.length > 0 && (
        <Alert severity="info">
          <div className="flex flex-col gap-2">
            {fullServers.map((s) => (
              <span key={s.host}>{deviceCapLine(s.name, i18n)}</span>
            ))}
            <Button
              size="xsmall"
              tone="neutral"
              style={{ alignSelf: "flex-start" }}
              onClick={() => {
                close();
                openUserSettings("security");
              }}
            >{<LocalizedText translationKey="shellFull.approveDevice_tsx_33c455a097" />}</Button>
          </div>
        </Alert>
      )}
      <Alert severity="warning">
        {isSignedIn ? i18n.t("shellFull.approveAccountDisclosure") : i18n.t("shellFull.approveGuestDisclosure")}
      </Alert>
      <div className="flex flex-wrap gap-2">
        <Button size="small" onClick={approve} disabled={secondsLeft === 0}>
          {secondsLeft > 0 ? i18n.t("shellFull.approveDevice_tsx_3894338da6", { value0: secondsLeft }) : i18n.t("shellFull.approveDevice_tsx_a06072cecc")}
        </Button>
        <Button size="small" tone="neutral" onClick={() => void deny()}>{<LocalizedText translationKey="shellFull.approveDevice_tsx_53577bb5df" />}</Button>
        <Button size="small" tone="ghost" onClick={() => void mismatch()}>{<LocalizedText translationKey="shellFull.approveDevice_tsx_33bd49b26c" />}</Button>
      </div>
    </div>
  );
}

function Body() {
  useTranslation();
  const { state, failure, history, open, close } = useApproveDevice();

  if (failure) {
    return (
      <div className="flex flex-col gap-3">
        <Alert severity="error">{<LocalizedText translationKey="shellFull.approveDevice_tsx_f6305b7b15" />}{" "}{pairingFailureText(failure, (key) => i18n.t(key))}</Alert>
        <Button size="small" tone="neutral" style={{ alignSelf: "flex-start" }} onClick={close}>{<LocalizedText translationKey="shellFull.approveDevice_tsx_bbfa773e5a" />}</Button>
      </div>
    );
  }
  if (!state || state.phase === "idle") return <CodeEntry />;

  switch (state.phase) {
    case "claiming":
      return <Waiting>{<LocalizedText translationKey="shellFull.approveDevice_tsx_df989c1ced" />}</Waiting>;
    case "waiting":
      return <Waiting>{<LocalizedText translationKey="shellFull.approveDevice_tsx_c2ea7bdbd8" />}</Waiting>;
    case "confirming":
      return <Confirm state={state} />;
    case "signing_in":
      return <Waiting>{i18n.t("shellFull.approvingSignIn", { name: state.device.name })}</Waiting>;
    case "browser":
      return (
        <div className="flex flex-col gap-3">
          <Dialog.Description className="m-0">{<LocalizedText translationKey="shellFull.approveDevice_tsx_9d503713c7" />}</Dialog.Description>
          <Waiting>{i18n.t("shellFull.waitingSignIn", { name: state.device.name })}</Waiting>
        </div>
      );
    case "waiting_ready":
      return <Waiting>{i18n.t("shellFull.waitingServers", { name: state.device.name })}</Waiting>;
    case "adding":
      return (
        <div className="flex flex-col gap-2" role="status">
          <span className="text-sm">
            {i18n.t("shellFull.addingConversations", { name: state.device.name, done: state.done, total: state.total })}
          </span>
          <Progress value={state.total ? (state.done / state.total) * 100 : null} aria-label={i18n.t("shellFull.approveDevice_tsx_3b03a0c86f")} />
        </div>
      );
    case "sending":
      return (
        <div className="flex flex-col gap-2" role="status">
          <span className="text-sm">{sendingHistoryText(history, i18n)}</span>
          <Progress
            value={history?.total ? (Math.min(history.messages, history.total) / history.total) * 100 : null}
            aria-label={i18n.t("shellFull.approveDevice_tsx_30e2f65060")}
          />
        </div>
      );
    case "done": {
      const failed = Object.values(state.added).flat().filter((a) => a.outcome === "failed").length;
      const sent = sentHistoryText(history, i18n);
      return (
        <div className="flex flex-col gap-3">
          <Dialog.Description className="m-0">
            {i18n.t("shellFull.deviceLinked", { name: state.device.name })}
            {sent && ` ${sent}`}
            {failed > 0 &&
              i18n.t("shellFull.missingConversations", { count: failed })}
          </Dialog.Description>
          <Button size="small" style={{ alignSelf: "flex-start" }} onClick={close}>{<LocalizedText translationKey="shellFull.approveDevice_tsx_e9b450d14b" />}</Button>
        </div>
      );
    }
    case "ended":
      return (
        <div className="flex flex-col gap-3">
          <Alert severity={state.reason === "mismatch" || state.reason === "tampered" ? "error" : "info"}>
            {approverEndText(state.reason, i18n)}
          </Alert>
          <div className="flex flex-wrap gap-2">
            <Button size="small" onClick={open}>{<LocalizedText translationKey="shellFull.approveDevice_tsx_042c862e44" />}</Button>
            <Button size="small" tone="neutral" onClick={close}>{<LocalizedText translationKey="shellFull.approveDevice_tsx_bbfa773e5a" />}</Button>
          </div>
        </div>
      );
  }
}

/** Link a new device to this one (GRYT-1484), from the side that's already signed in. */
export function ApproveDeviceDialog() {
  useTranslation();
  const { isOpen, state, close } = useApproveDevice();
  const title = state?.phase === "confirming" ? i18n.t("shellFull.approveDevice_tsx_9ad7ea193a") : i18n.t("shellFull.approveDevice_tsx_377ef34f56");

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open) close(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup className="w-[28rem] max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <Dialog.Close className="absolute top-3 right-3" render={<IconButton size="small" aria-label={i18n.t("shellFull.approveDevice_tsx_bbfa773e5a")} />}>
            <PiX size={16} />
          </Dialog.Close>
          <Dialog.Title className="pr-10">{title}</Dialog.Title>
          <div className="mt-3">
            <Body />
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

import {useTranslation} from "@/i18n";

/** A retry rechecks authority; it never opens transmission by itself. */
export function VoiceMoveRecoveryNotice({onRetry}:{onRetry:()=>void}) {
  const {t}=useTranslation();
  return <div role="status" style={{minWidth:0,overflowWrap:"anywhere"}}>
    <p>{t("pureVoice.moveRecoveryPending")}</p>
    <button type="button" className="mt-2 underline" onClick={onRetry}>{t("pureVoice.moveRecoveryRetry")}</button>
  </div>;
}

import {useTranslation} from "@/i18n";

/** A retry rechecks authority; it never opens transmission by itself. */
export function VoiceMoveRecoveryNotice({onRetry,phase="destination"}:{onRetry:()=>void;phase?:"source"|"destination"}) {
  const {t}=useTranslation();
  return <div role="status" style={{minWidth:0,overflowWrap:"anywhere"}}>
    <p>{t(phase==="source" ? "pureVoice.movePromotionPending" : "pureVoice.moveRecoveryPending")}</p>
    <button type="button" className="mt-2 underline" onClick={onRetry}>{t("pureVoice.moveRecoveryRetry")}</button>
  </div>;
}

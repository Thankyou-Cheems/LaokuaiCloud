import { Tooltip } from "@gryt/ui/tooltip";

import { useTranslation } from "@/i18n";
import { useMemberVoiceQuality } from "@/webRTC/src/adapters/VoiceQualityBridge";

import type { VoicePacketSample } from "../../../../lib/voiceQualityStats";

export function MemberVoiceQuality({host,member}:{host?:string;member?:string}) {
  const {t}=useTranslation();const reading=useMemberVoiceQuality(host,member);
  const unknown=t("pureVoice.qualityUnknown");
  const time=(ms:number|null|undefined)=>ms==null ? unknown : `${ms.toFixed(0)} ms`;
  const packets=(sample:VoicePacketSample|null|undefined)=>!sample || sample.packetsReceived+sample.packetsLost<1 ? unknown :
    `${sample.packetsLost}/${sample.packetsReceived+sample.packetsLost} (${(100*sample.packetsLost/(sample.packetsReceived+sample.packetsLost)).toFixed(1)}%, ${(sample.windowMs/1000).toFixed(1)} s)`;
  const hasMetrics=reading && (reading.iceRttMs!==null || reading.uplink?.rttMs!=null || reading.receive?.jitterMaxMs!=null ||
    (reading.uplink?.sample && reading.uplink.sample.packetsReceived+reading.uplink.sample.packetsLost>0) ||
    (reading.receive?.sample && reading.receive.sample.packetsReceived+reading.receive.sample.packetsLost>0));
  const details=[t("pureVoice.qualityBoundary"),`${t("pureVoice.qualityIce")}: ${time(reading?.iceRttMs)}`,
    `${t("pureVoice.qualityUplinkRtt")}: ${time(reading?.uplink?.rttMs)}`,
    `${t("pureVoice.qualityUplinkLoss")}: ${packets(reading?.uplink?.sample)}`,
    `${t("pureVoice.qualityReceiveJitter")}: ${time(reading?.receive?.jitterMaxMs)}`,
    `${t("pureVoice.qualityReceiveLoss")}: ${packets(reading?.receive?.sample)}`].join("; ");
  return <Tooltip title={details}><span data-gryt="member-quality" aria-label={details} tabIndex={0}
    className="text-[10px] text-gryt-muted shrink-0 tabular-nums cursor-help" style={{width:12,textAlign:"center"}}>
    {hasMetrics ? "↔" : "?"}</span></Tooltip>;
}

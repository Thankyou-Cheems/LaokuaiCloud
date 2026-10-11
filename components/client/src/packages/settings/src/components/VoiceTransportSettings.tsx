import { useSFU } from "@gryt/voice";

import { useTranslation } from "@/i18n";
import { useSettings } from "@/settings";

import { sharedVoicePreset } from "../../../../lib/voiceTransportPreset";
import { SettingGroup, SliderSetting, ToggleSetting } from "./settingsComponents";

export function VoiceTransportSettings() {
  const { t: tr } = useTranslation();
  const { voiceTransportPreset: preset, setVoiceTransportPreset: setPreset } = useSettings();
  const { microphoneCodecState: codec } = useSFU();
  return <div className="flex flex-col gap-4">
    <SettingGroup title={tr("transport.title")} description={tr("transport.description")} anchorId="voice-transport">
      <select aria-label={tr("transport.title")} value={preset.selection}
        onChange={event=>setPreset(event.target.value === "shared-20" ? sharedVoicePreset() : { ...preset,selection:"custom" })}>
        <option value="shared-20">{tr("transport.shared")}</option>
        <option value="custom">{tr("transport.custom")}</option>
      </select>
      <p>{tr("transport.reconnect")}</p>
      <div aria-live="polite">
        <p>{tr("transport.configuration")}: {tr(`transport.status.${codec.status}`)}</p>
        {codec.requested && <p>{tr("transport.requested", { value: codec.requested.maxBitrateBps / 1000 })}</p>}
        {typeof codec.effectiveMaxBitrateBps === "number" && <p>{tr("transport.effective", { value: codec.effectiveMaxBitrateBps / 1000 })}</p>}
        {typeof codec.senderMaxBitrateBps === "number" && <p>{tr("transport.readback", { value: codec.senderMaxBitrateBps / 1000 })}</p>}
        {codec.reason && <p><code>{codec.reason}</code></p>}
        <p>{tr("transport.configurationBoundary")}</p>
      </div>
    </SettingGroup>
    <>
      <SliderSetting title={tr("transport.bitrateTitle")} anchorId="voice-transport-bitrate"
        description={tr("transport.bitrateDescription")} min={6} max={128} step={1}
        value={preset.maxBitrateBps/1000} onChange={value=>setPreset({...preset,selection:"custom",maxBitrateBps:value*1000})} />
      <SettingGroup title={tr("transport.packetTime")} description={tr("transport.packetTimeDescription")} anchorId="voice-transport-packet-time">
        <select aria-label={tr("transport.packetTime")} value={preset.packetTimeMs}
          onChange={event=>{const value=Number(event.target.value);if(value===10||value===20||value===40)setPreset({...preset,selection:"custom",packetTimeMs:value});}}>
          <option value={10}>10 ms</option><option value={20}>20 ms</option><option value={40}>40 ms</option>
        </select>
      </SettingGroup>
      <ToggleSetting title={tr("transport.dtx")} anchorId="voice-transport-dtx" description={tr("transport.dtxDescription")}
        checked={preset.requestDtx} onCheckedChange={value=>setPreset({...preset,selection:"custom",requestDtx:value})} />
      <ToggleSetting title={tr("transport.fec")} anchorId="voice-transport-fec" description={tr("transport.fecDescription")}
        checked={preset.requestInbandFec} onCheckedChange={value=>setPreset({...preset,selection:"custom",requestInbandFec:value})} />
    </>
  </div>;
}

import { i18n, LocalizedText, useTranslation } from "@/i18n";

import { PiGlobeSimpleFill } from "../lib/icons";
import { DebugOverlay } from "./debugOverlay";

interface NetworkDebugOverlayProps {
  isVisible: boolean;
}

export function NetworkDebugOverlay({ isVisible }: NetworkDebugOverlayProps) {
  useTranslation();
  // This is just an example of how easy it is to create new debug overlays
  // In a real implementation, you would add network-specific state and logic here
  
  return (
    <DebugOverlay
      isVisible={isVisible}
      title={i18n.t("shellFull.networkDebugOverlay_tsx_9801353919")}
      icon={<PiGlobeSimpleFill size={16} />}
      status={{
        active: true, // This would be determined by actual network status
        label: i18n.t("shellFull.networkDebugOverlay_tsx_c2f9b7b489")
      }}
      initialPosition={{ x: window.innerWidth - 340, y: 120 }} // Offset for multiple overlays
    >
      {/* Network-specific content would go here */}
      <div style={{ marginBottom: "8px" }}>
        <div style={{ color: "var(--gryt-secondary-11)", fontWeight: "bold" }}>{<LocalizedText translationKey="shellFull.networkDebugOverlay_tsx_eeb4784e26" />}</div>
        <div style={{ marginLeft: "8px", fontSize: "11px" }}>
          <div>{<LocalizedText translationKey="shellFull.networkDebugOverlay_tsx_bd2054f6fe" />}</div>
          <div>{<LocalizedText translationKey="shellFull.networkDebugOverlay_tsx_eb7d7e659f" />}</div>
          <div>{<LocalizedText translationKey="shellFull.networkDebugOverlay_tsx_9e015e982d" />}</div>
        </div>
      </div>

      <div style={{ marginBottom: "8px" }}>
        <div style={{ color: "var(--gryt-secondary-11)", fontWeight: "bold" }}>{<LocalizedText translationKey="shellFull.networkDebugOverlay_tsx_7326771694" />}</div>
        <div style={{ marginLeft: "8px", fontSize: "11px" }}>
          <div>{<LocalizedText translationKey="shellFull.networkDebugOverlay_tsx_8ee211b337" />}</div>
          <div>{<LocalizedText translationKey="shellFull.networkDebugOverlay_tsx_de959284ed" />}</div>
        </div>
      </div>
    </DebugOverlay>
  );
}

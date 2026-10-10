import "../src/style.css";

import type { ScreenShareQuality } from "@gryt/voice";
import { useState } from "react";
import { createRoot } from "react-dom/client";

import { ScreenSharePickerModal } from "../src/packages/webRTC/src/components/ScreenSharePickerModal";

export function Harness() {
  const [open,setOpen]=useState(false);
  const [quality,setQuality]=useState<ScreenShareQuality>((new URLSearchParams(location.search).get("quality")??"720p") as ScreenShareQuality);
  const [fps,setFps]=useState(30),[gaming,setGaming]=useState(false),[starts,setStarts]=useState<unknown[]>([]);
  return <div className="gryt-app p-4"><button onClick={()=>setOpen(true)}>Open picker</button>
    <output data-testid="quality">{quality}</output><output data-testid="starts">{JSON.stringify(starts)}</output>
    <ScreenSharePickerModal open={open} onOpenChange={setOpen} quality={quality} onQualityChange={setQuality} fps={fps} onFpsChange={setFps}
      experimentalScreenShare={false} gamingMode={gaming} onGamingModeChange={setGaming} codec="auto" onCodecChange={()=>{}}
      maxBitrate={0} onMaxBitrateChange={()=>{}} scalabilityMode="L1T3" onScalabilityModeChange={()=>{}}
      onStart={value=>setStarts(previous=>[...previous,value])}/>
  </div>;
}
createRoot(document.getElementById("root")!).render(<Harness/>);

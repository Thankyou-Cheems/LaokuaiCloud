import { Button, Slider } from "@gryt/ui";
import { useId } from "react";

import { useTranslation } from "@/i18n";
import { MAX_VOLUME_PERCENT } from "@/lib/audioVolume";
import { useSettings } from "@/settings";

/** Shared lightweight controls: no microphone or device initialization here. */
export function ReceiveVolumeSetting({ anchorId }: { anchorId?: string }) {
  const { t: tr } = useTranslation();
  const { outputVolume, setOutputVolume, isDeafened, isServerDeafened } = useSettings();
  const descriptionId = useId();

  return (
    <div id={anchorId} data-setting={anchorId} className="flex flex-col gap-2" data-gryt="receive-volume-setting">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{tr("receiveVolume.title")}</span>
        <span className="tabular-nums">{outputVolume}%</span>
      </div>
      <p id={descriptionId} className="text-sm text-gryt-muted">
        {tr("receiveVolume.description")}
      </p>
      <Slider
        aria-label={tr("receiveVolume.button", { value: outputVolume })}
        aria-describedby={descriptionId}
        value={outputVolume}
        onValueChange={(next) => setOutputVolume(Number(next))}
        min={0}
        max={MAX_VOLUME_PERCENT}
        step={1}
      />
      {(isDeafened || isServerDeafened) && (
        <p role="status" className="text-sm text-gryt-muted">{tr("receiveVolume.deafened")}</p>
      )}
      <Button type="button" tone="neutral" onClick={() => setOutputVolume(100)}>
        {tr("receiveVolume.reset")}
      </Button>
    </div>
  );
}

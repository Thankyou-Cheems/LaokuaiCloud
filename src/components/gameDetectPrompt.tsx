import { Button } from "@gryt/ui";
import { useEffect } from "react";
import toast from "react-hot-toast";

import { i18n, LocalizedText, useTranslation } from "@/i18n";

import { useReportForm } from "../lib/reports/useReportForm";
import { useGameDetection } from "../packages/settings/src/hooks/useGameDetection";
import { GameIcon } from "../packages/socket/src/components/GameIcon";

const toastId = (appId: string) => `game-detect-${appId}`;

/**
 * One toast per game Gryt spotted and hasn't asked about. It stays until answered,
 * even after the game closes, and nothing shows on the card before a yes.
 */
export function GameDetectPrompt() {
  useTranslation();
  const { pending, answer } = useGameDetection();
  const { open: openReport } = useReportForm();

  useEffect(() => {
    for (const game of pending) {
      const name = game.name ?? i18n.t("shellFull.gameDetectPrompt_tsx_fe4955ec6b");
      toast(
        () => (
          <div className="flex flex-col gap-2" style={{ minWidth: 0 }}>
            <span className="flex items-center gap-2 text-sm font-medium">
              <GameIcon appId={game.id} name={name} size={20} />
              <LocalizedText translationKey="shellFull.showGame" values={{ name }} />
            </span>
            <span className="text-xs text-gryt-muted" style={{ lineHeight: 1.5 }}>{<LocalizedText translationKey="shellFull.gameDetectPrompt_tsx_a43652a938" />}</span>
            <div className="flex gap-2 justify-end">
              {/* Hidden, since it's wrong, and the feedback form opens saying what was spotted (GRYT-1661). */}
              <Button
                tone="ghost"
                size="xsmall"
                onClick={() => {
                  void answer(game.id, "hide");
                  openReport("feedback", i18n.t("shellFull.gameDetectPrompt_tsx_de0b8fd322", { value0: name, value1: game.id }));
                }}
              >{<LocalizedText translationKey="shellFull.gameDetectPrompt_tsx_eadb2aa8bf" />}</Button>
              <Button tone="ghost" size="xsmall" onClick={() => void answer(game.id, "hide")}>{<LocalizedText translationKey="shellFull.gameDetectPrompt_tsx_febeb00ded" />}</Button>
              <Button size="xsmall" onClick={() => void answer(game.id, "show")}>{<LocalizedText translationKey="shellFull.gameDetectPrompt_tsx_2ce0388fd0" />}</Button>
            </div>
          </div>
        ),
        { id: toastId(game.id), duration: Infinity },
      );
    }
    return () => {
      for (const game of pending) toast.dismiss(toastId(game.id));
    };
  }, [pending, answer, openReport]);

  return null;
}

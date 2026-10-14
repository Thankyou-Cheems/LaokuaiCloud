/* eslint-disable react-refresh/only-export-components -- offline UI fixture */
import "../../src/style.css";

import { createGrytTheme, grytDraft, grytThemeToOptions } from "@gryt/ui";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { kirilieThemeVariables } from "../../src/lib/kirilieTheme";
import { RECEIVE_CORRECTION_LABELS_EN, RECEIVE_CORRECTION_LABELS_ZH } from "../../src/lib/receiveCorrection";
import { ReceiveCorrectionRing, type ReceiveCorrectionRingProps } from "../../src/packages/socket/src/components/ReceiveCorrectionRing";

declare global {
  interface Window {
    __receiveCorrectionFixture: { setTheme(theme: "kirilie" | "light" | "dark"): void; setEnglish(english: boolean): void };
  }
}

const samples: [string, ReceiveCorrectionRingProps][] = [
  ["增大", { learnedAutoGainDb: 6, appliedAutoGainDb: 6, state: "stable" }],
  ["减小", { learnedAutoGainDb: -4, appliedAutoGainDb: -4, state: "stable" }],
  ["无需补偿", { learnedAutoGainDb: 0, appliedAutoGainDb: 0, state: "stable" }],
  ["初次学习", { state: "learning" }],
  ["已有学习", { learnedAutoGainDb: 2, appliedAutoGainDb: 1, state: "learning" }],
  ["噪声受限", { learnedAutoGainDb: 2, appliedAutoGainDb: 2, state: "limited", diagnostic: "背景噪声限制增大补偿" }],
  ["停说等待", { learnedAutoGainDb: 6, appliedAutoGainDb: 0, state: "stable", waitingForSpeech: true }],
  ["暂无测量", {}],
  ["自动停用", { state: "unknown", disabled: true, diagnostic: "自动补偿已关闭" }],
];

function Fixture() {
  const [theme, setTheme] = useState<"kirilie" | "light" | "dark">("kirilie");
  const [english, setEnglish] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const appearance = theme === "dark" ? "dark" : "light";
    root.className = appearance;
    root.dataset.themeStyle = theme === "kirilie" ? "kirilie" : "original";
    const variables = theme === "kirilie" ? kirilieThemeVariables()
      : createGrytTheme(grytThemeToOptions(grytDraft, appearance)) as Record<string, string>;
    for (const [name, value] of Object.entries(variables)) root.style.setProperty(name, value);
    window.__receiveCorrectionFixture = { setTheme, setEnglish };
    return () => { for (const name of Object.keys(variables)) root.style.removeProperty(name); };
  }, [theme]);
  return <main className="gryt-app p-4" style={{ background: "var(--gryt-bg)", color: "var(--gryt-text)", minHeight: "100vh" }}>
    <h1 className="mb-3 text-lg">TEST · 离线响度补偿展示 · {theme}</h1>
    <p className="mb-3 text-xs">Synthetic telemetry only. No app/account/network/media bootstrap.</p>
    <div className="flex flex-wrap gap-6">
      <section style={{ width: 210 }}>
        <h2 className="mb-2">210px 边栏紧凑态</h2>
        {samples.map(([name, props]) => <div key={name} className="mb-1 flex items-center gap-2 rounded p-2" style={{ background: "var(--gryt-surface)", height: 44 }} data-fixture-row="compact">
          <span className="shrink-0 text-xs">●</span>
          <span className="min-w-0 flex-1 truncate text-xs">{name}的成员</span>
          <ReceiveCorrectionRing {...props} compact labels={english ? RECEIVE_CORRECTION_LABELS_EN : RECEIVE_CORRECTION_LABELS_ZH} />
        </div>)}
      </section>
      <section style={{ width: 240 }}>
        <h2 className="mb-2">成员卡完整态</h2>
        {samples.map(([name, props]) => <div key={name} className="mb-1 flex items-center justify-between rounded p-2" style={{ background: "var(--gryt-surface)", height: 44 }} data-fixture-row="full">
          <span className="text-xs">{name}</span>
          <ReceiveCorrectionRing {...props} labels={english ? RECEIVE_CORRECTION_LABELS_EN : RECEIVE_CORRECTION_LABELS_ZH} />
        </div>)}
      </section>
    </div>
  </main>;
}

createRoot(document.getElementById("root")!).render(<Fixture />);

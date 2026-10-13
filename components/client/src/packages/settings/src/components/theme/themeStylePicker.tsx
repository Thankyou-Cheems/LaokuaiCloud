import type { ThemeStyle } from "../../../../../lib/kirilieTheme";

export function ThemeStylePicker({ value, onChange }: {
  value: ThemeStyle;
  onChange: (style: ThemeStyle) => void;
}) {
  return <div className="laokuai-theme-picker" role="group" aria-label="界面风格"
    id={value === "kirilie" ? "theme" : undefined} data-setting={value === "kirilie" ? "theme" : undefined}>
    <button type="button" className="laokuai-theme-choice" data-look="kirilie"
      aria-pressed={value === "kirilie"} onClick={() => onChange("kirilie")}>
      <span className="laokuai-theme-swatch" aria-hidden="true"><span /><span /><span /></span>
      <span className="font-semibold">手绘奇丽叶</span>
      <span className="text-xs">奶油纸页 · 嫩绿蜡笔 · 小花星星</span>
      <span className="text-xs font-medium">{value === "kirilie" ? "正在使用" : "切换到奇丽叶"}</span>
    </button>
    <button type="button" className="laokuai-theme-choice" data-look="original"
      aria-pressed={value === "original"} onClick={() => onChange("original")}>
      <span className="laokuai-theme-swatch" aria-hidden="true"><span /><span /><span /></span>
      <span className="font-semibold">原主题</span>
      <span className="text-xs">保留原来的深浅、配色与自定义主题</span>
      <span className="text-xs font-medium">{value === "original" ? "正在使用" : "切回原主题"}</span>
    </button>
  </div>;
}

/* eslint-disable react-refresh/only-export-components -- offline component fixture, no HMR */
import "../../src/style.css";

import { Avatar, Button, Dialog, Menu, Select, Switch, TextField, Tooltip } from "@gryt/ui";
import { createGrytTheme, grytThemeToOptions } from "@gryt/ui";
import { GrytUiI18nProvider, grytUiZhCN } from "@gryt/ui/i18n";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { kirilieThemeVariables, resolveDisplayedTheme, type ThemeStyle } from "../../src/lib/kirilieTheme";
import { registrations } from "../../src/packages/common/src/hooks/singletonHook";
import { useTheme } from "../../src/packages/common/src/hooks/useTheme";
import { ThemeStylePicker } from "../../src/packages/settings/src/components/theme/themeStylePicker";

declare global {
  interface Window {
    __kirilieFixture: {
      setStyle(style: ThemeStyle): void;
      setAppearance(appearance: "light" | "dark"): void;
      openMenu(open: boolean): void;
      openDialog(open: boolean): void;
      snapshot(): object;
    };
  }
}

// Fresh fixture profile only. These are synthetic preferences, never product data.
localStorage.setItem("theme.appearancePreference", "dark");
localStorage.setItem("theme.accentColor", "violet");
localStorage.setItem("theme.grayColor", "slate");
localStorage.setItem("theme.custom.active", "fixture-preserved-custom-theme");

function Fixture() {
  const settings = useTheme();
  const [menu, setMenu] = useState(false);
  const [dialog, setDialog] = useState(false);
  const displayed = resolveDisplayedTheme(settings.themeStyle, settings.resolvedAppearance, null, null);
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("light", displayed.appearance === "light");
    root.classList.toggle("dark", displayed.appearance === "dark");
    root.dataset.themeStyle = displayed.handDrawn ? "kirilie" : "original";
    root.style.colorScheme = displayed.appearance;
    const variables = displayed.handDrawn ? kirilieThemeVariables() : displayed.theme
      ? createGrytTheme(grytThemeToOptions(displayed.theme, displayed.appearance)) as Record<string, string>
      : {};
    for (const [name, value] of Object.entries(variables)) root.style.setProperty(name, value);
    return () => { for (const name of Object.keys(variables)) root.style.removeProperty(name); };
  }, [displayed.appearance, displayed.handDrawn, displayed.theme]);

  useEffect(() => {
    window.__kirilieFixture = {
      setStyle: settings.setThemeStyle,
      setAppearance: settings.setAppearancePreference,
      openMenu: setMenu, openDialog: setDialog,
      snapshot: () => {
        const rect = (node: Element) => {
          const r = node.getBoundingClientRect(), css = getComputedStyle(node);
          return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom,
            background: css.backgroundColor, image: css.backgroundImage, color: css.color,
            radius: css.borderRadius, border: css.borderColor, outline: css.outlineColor,
            portaled: !document.querySelector(".gryt-app")?.contains(node) };
        };
        const find = (selector: string) => {
          const n = document.querySelector(selector);
          return n ? { ...rect(n), text: n.textContent } : null;
        };
        return {
          testOnly: true, authenticatedApp: false, themeStyle: settings.themeStyle,
          appearance: displayed.appearance, savedAppearance: localStorage.getItem("theme.appearancePreference"),
          savedAccent: localStorage.getItem("theme.accentColor"), savedGray: localStorage.getItem("theme.grayColor"),
          savedCustom: localStorage.getItem("theme.custom.active"),
          viewport: { width: innerWidth, height: innerHeight }, documentWidth: document.documentElement.scrollWidth,
          menu: find(".gryt-menu"), dialog: find(".gryt-dialog"), tooltip: find(".gryt-tooltip"),
          picker: find(".laokuai-theme-picker"), input: find("input"),
          danger: find('[data-fixture="danger"]'), disabled: find('[data-fixture="disabled"]'),
          rootStyle: document.documentElement.dataset.themeStyle,
        };
      },
    };
  }, [settings, displayed.appearance]);

  return <GrytUiI18nProvider locale="zh-CN" labels={grytUiZhCN}>
    <div className="gryt-app fixture-app flex h-full min-h-0 flex-col" style={{ color: "var(--gryt-text)" }}>
      <header data-gryt="titlebar" className="flex shrink-0 items-center gap-3 px-4 py-2">
        <b>唠蒯云 · 主题组件验收</b><span className="text-xs text-gryt-muted">离线合成社区，真实账号 / 联机 / 音频未启动</span>
      </header>
      <div className="fixture-body flex min-h-0 flex-1 gap-3 p-3">
        <nav data-gryt="sidebar" className="flex shrink-0 flex-col items-center gap-4 p-2">
          <Button size="small">云</Button><Button tone="neutral" size="small">叶</Button>
          <Tooltip title="奇丽叶纸页上的工具提示"><Button size="small" tone="ghost" data-fixture="tooltip-trigger">?</Button></Tooltip>
        </nav>
        <nav data-gryt="channels-sidebar" className="fixture-channels min-w-0 shrink-0">
          <div className="flex h-full min-w-0 flex-col gap-3 p-3">
            <b>TEST · 小花社区</b><span className="text-xs text-gryt-muted">频道</span>
            <Button size="small" tone="neutral"># 欢迎来到小花园</Button>
            <Button size="small">♫ 晚风语音房</Button>
            <span className="text-xs text-gryt-muted">社区认证正常 · 联机准备中</span>
          </div>
        </nav>
        <main data-gryt="conversation-pane" className="min-w-0 flex-1 overflow-y-auto p-4">
          <h2 className="mb-3 text-lg font-semibold">手绘风格与设置</h2>
          <ThemeStylePicker value={settings.themeStyle} onChange={settings.setThemeStyle} />
          <div className="my-3 flex flex-wrap gap-2">
            <Button size="small" tone="neutral" onClick={() => settings.setAppearancePreference("light")}>原主题浅色</Button>
            <Button size="small" tone="neutral" onClick={() => settings.setAppearancePreference("dark")}>原主题深色</Button>
          </div>
          <div className="flex flex-col gap-3" data-gryt="settings">
            <TextField label="社区地址" defaultValue="voice.ruikang.wang" helperText="输入保持清晰，焦点轮廓使用深绿铅笔。" />
            <TextField label="输入错误" error defaultValue="TEST 无效地址" helperText="这是错误状态的合成示例" />
            <Select label="频道排序" defaultValue="default" options={[{ value: "default", label: "默认排序" }, { value: "name", label: "按名称" }, { value: "disabled", label: "不可选示例", disabled: true }]} />
            <label className="flex items-center gap-2 text-sm"><Switch defaultChecked /> 显示频道与成员</label>
            <div className="flex flex-wrap gap-2">
              <Menu.Root open={menu} onOpenChange={setMenu}>
                <Menu.Trigger render={<Button size="small" tone="neutral" data-fixture="menu-trigger" />}>成员菜单</Menu.Trigger>
                <Menu.Portal><Menu.Positioner><Menu.Popup>
                  <Menu.Group><Menu.GroupLabel>花叶成员 · TEST</Menu.GroupLabel>
                  <Menu.Item>复制成员地址</Menu.Item><Menu.Item>查看连接详情</Menu.Item>
                  <Menu.Item disabled>暂不可用的操作</Menu.Item><Menu.Separator />
                  <Menu.Item className="text-gryt-danger-11">移出社区（测试）</Menu.Item>
                  </Menu.Group>
                </Menu.Popup></Menu.Positioner></Menu.Portal>
              </Menu.Root>
              <Button size="small" tone="neutral" data-fixture="dialog-trigger" onClick={() => setDialog(true)}>打开对话框</Button>
              <Button size="small" tone="danger" data-fixture="danger">危险操作</Button>
              <Button size="small" disabled data-fixture="disabled">不可用</Button>
            </div>
          </div>
          <section className="mt-4 flex flex-col gap-2" aria-label="合成成员与 DNS">
            {["小花", "星星"].map((name, i) => <div key={name} className="member-row flex min-w-0 items-center gap-3 p-2" data-gryt="voice-member">
              <Avatar fallback={name} size="small" /><div className="min-w-0 flex-1"><b>{name} · TEST</b><p className="m-0 text-xs text-gryt-muted">{i ? "空闲" : "在线"} · SFU 路径示例</p></div>
              <span data-gryt="member-lan-dns" className="text-xs text-gryt-accent-11" style={{ overflowWrap: "anywhere" }}>{i ? "xingxing" : "xiaohua"}.TEST</span>
            </div>)}
          </section>
        </main>
      </div>
      <Dialog.Root open={dialog} onOpenChange={setDialog}>
        <Dialog.Portal><Dialog.Backdrop /><Dialog.Popup style={{ width: 460 }}>
          <Dialog.Title>小花社区 · 测试对话框</Dialog.Title>
          <Dialog.Description>此对话框使用真实 @gryt/ui Portal。主题切换后，纸页、文本和危险状态应保持清楚可读。</Dialog.Description>
          <TextField label="成员备注" defaultValue="花叶成员 TEST" />
          <Dialog.Footer><Button tone="danger" data-fixture="dialog-danger">危险操作示例</Button><Button onClick={() => setDialog(false)}>关闭</Button></Dialog.Footer>
        </Dialog.Popup></Dialog.Portal>
      </Dialog.Root>
    </div>
  </GrytUiI18nProvider>;
}

createRoot(document.getElementById("root")!).render(<>
  {registrations.map(registration => registration.render())}<Fixture />
</>);

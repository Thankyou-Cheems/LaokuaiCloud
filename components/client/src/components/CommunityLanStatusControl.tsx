import { IconButton, Menu, Tooltip } from "@gryt/ui";

import type { CommunityLanAction } from "../lib/easyTierCommunitySubscriptions";
import { PiLinkSimpleBold } from "../lib/icons";

export interface CommunityLanStatusControlProps {
  action: CommunityLanAction;
  enabled: boolean;
  preparing: boolean;
  communityLabel: string;
  channelsReceived: boolean;
  onToggle(): void;
  onPrepare(): void;
  onRetry(): void;
}

/** Compact normal-flow entry; full status/actions appear only after an explicit open. */
export function CommunityLanStatusControl({ action, enabled, preparing, communityLabel, channelsReceived, onToggle, onPrepare, onRetry }: CommunityLanStatusControlProps) {
  const dot = action.kind === "error" ? "bg-gryt-danger" : action.kind === "connected" ? "bg-gryt-accent" : "bg-gryt-muted";
  return <div className="shrink-0" data-gryt="community-lan-control" data-state={action.kind}>
    <Menu.Root modal={false}>
      <Tooltip title={`社区联机：${action.label}`} side="right">
        <Menu.Trigger render={<IconButton size="xsmall" tone="ghost" aria-label={`社区联机：${action.label}。查看联机详情`} />}>
          <span className="relative inline-flex h-5 w-5 items-center justify-center" aria-hidden="true">
            <PiLinkSimpleBold size={18} />
            <span className={`absolute bottom-0 right-0 h-1.5 w-1.5 rounded-full ${dot}`} />
          </span>
        </Menu.Trigger>
      </Tooltip>
      <Menu.Portal>
        <Menu.Positioner side="right" align="start" sideOffset={8}>
          <Menu.Popup aria-label="社区联机详情" style={{ width: 288, maxWidth: "calc(100vw - 24px)", maxHeight: "calc(100dvh - 24px)", overflowY: "auto" }}>
            <div className="px-3 py-2 text-xs leading-relaxed" style={{ overflowWrap: "anywhere", whiteSpace: "normal" }}>
              <strong className="block text-sm">社区联机 · {action.label}</strong>
              <p className="mt-1 text-gryt-muted">{communityLabel} · {channelsReceived ? "频道信息已收到" : "频道信息未收到"}</p>
              <p role="status" className="mt-1 text-gryt-muted">{action.message}</p>
            </div>
            <Menu.Separator />
            <Menu.Item onClick={onToggle}>{enabled ? "关闭联机" : "开启联机"}</Menu.Item>
            {enabled && action.prepare && <Menu.Item disabled={preparing} onClick={onPrepare}>准备组件</Menu.Item>}
            {(enabled || action.label === "退出异常") && action.retry && !action.prepare && <Menu.Item disabled={preparing} onClick={onRetry}>{action.retryLabel}</Menu.Item>}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  </div>;
}

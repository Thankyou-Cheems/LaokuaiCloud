import { Avatar, Button, IconButton, Select, Surface, TextField, Tooltip } from "@gryt/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

import { getServerAccessToken, getServerHttpBase, getUploadsFileUrl } from "@/common";
import { i18n as socketI18n, useTranslation as useSocketTranslation } from "@/i18n";

import { PiCopyFill, PiPlus, PiTrashFill } from "../../../../lib/icons";
import { socketDisplayText, socketHookToast } from "../utils/socketHookMessages";
import { uploadWebhookAvatar } from "../utils/uploadWebhookAvatar";

type WebhookItem = {
  webhook_id: string;
  token: string;
  channel_id: string;
  display_name: string;
  avatar_file_id: string | null;
  url?: string;
};

type ChannelOption = {
  id: string;
  name: string;
  type: string;
};

export function ServerWebhooksTab({
  host,
  channels,
}: {
  host: string;
  channels: ChannelOption[];
}) {
  useSocketTranslation();
  const [webhooks, setWebhooks] = useState<WebhookItem[]>([]);
  const [loading, setLoading] = useState(false);

  const textChannels = channels.filter((c) => c.type === "text");

  const apiBase = host ? `${getServerHttpBase(host)}/api/webhooks` : "";

  const authHeaders = useCallback((): Record<string, string> => {
    const token = getServerAccessToken(host);
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  }, [host]);

  const refresh = useCallback(async () => {
    if (!apiBase) return;
    setLoading(true);
    try {
      const res = await fetch(apiBase, { headers: authHeaders() });
      if (!res.ok) throw new Error(socketI18n.t("socketFull.serverWebhooksTab_e9eb54c767"));
      const data = await res.json() as { items: WebhookItem[] };
      setWebhooks(data.items ?? []);
    } catch {
      toast.error(socketI18n.t("socketFull.serverWebhooksTab_4b59c7b90a"));
    } finally {
      setLoading(false);
    }
  }, [apiBase, authHeaders]);

  useEffect(() => {
    if (host) refresh();
  }, [host, refresh]);

  const createWebhook = async () => {
    if (!apiBase) return;
    const channelId = textChannels[0]?.id ?? "";
    try {
      const res = await fetch(apiBase, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ channel_id: channelId, display_name: "New Webhook" }),
      });
      if (!res.ok) throw new Error(socketI18n.t("socketFull.serverWebhooksTab_96b722a7bb"));
      const created = await res.json() as WebhookItem;
      setWebhooks((prev) => [created, ...prev]);
      toast.success(socketI18n.t("socketFull.serverWebhooksTab_f73f1e1a4b"));
    } catch {
      toast.error(socketI18n.t("socketFull.serverWebhooksTab_96b722a7bb"));
    }
  };

  const deleteHook = async (id: string) => {
    try {
      const res = await fetch(`${apiBase}/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(socketI18n.t("socketFull.serverWebhooksTab_fe4de3c0a7"));
      setWebhooks((prev) => prev.filter((w) => w.webhook_id !== id));
      toast.success(socketI18n.t("socketFull.serverWebhooksTab_8bf4a6f959"));
    } catch {
      toast.error(socketI18n.t("socketFull.serverWebhooksTab_fe4de3c0a7"));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <span className="text-sm">{socketI18n.t("socketFull.serverWebhooksTab_e2bda24cb1")}</span>

      <div className="flex justify-between items-center gap-2 flex-wrap">
        <span className="text-base font-bold">{socketI18n.t("socketFull.webhooksTitle")}</span>
        <Button size="small" onClick={createWebhook} disabled={textChannels.length === 0}>
          <PiPlus size={16} />{socketI18n.t("socketFull.serverWebhooksTab_5c6ebb1c85")}</Button>
      </div>

      {textChannels.length === 0 && (
        <span className="text-sm">{socketI18n.t("socketFull.serverWebhooksTab_b024ba014e")}</span>
      )}

      {loading && webhooks.length === 0 && (
        <span className="text-sm">{socketI18n.t("shellFull.microphoneDebugOverlay_tsx_b04ba49f84")}</span>
      )}

      {!loading && webhooks.length === 0 && (
        <span className="text-sm">{socketI18n.t("socketFull.serverWebhooksTab_42b97cd928")}</span>
      )}

      <div className="flex flex-col gap-3">
        {webhooks.map((w) => (
          <WebhookCard
            key={w.webhook_id}
            webhook={w}
            host={host}
            apiBase={apiBase}
            authHeaders={authHeaders}
            textChannels={textChannels}
            onDelete={deleteHook}
            onUpdate={(updated) =>
              setWebhooks((prev) =>
                prev.map((x) =>
                  x.webhook_id === updated.webhook_id ? updated : x
                )
              )
            }
          />
        ))}
      </div>
    </div>
  );
}

function WebhookCard({
  webhook,
  host,
  apiBase,
  authHeaders,
  textChannels,
  onDelete,
  onUpdate,
}: {
  webhook: WebhookItem;
  host: string;
  apiBase: string;
  authHeaders: () => Record<string, string>;
  textChannels: { id: string; name: string }[];
  onDelete: (id: string) => void;
  onUpdate: (w: WebhookItem) => void;
}) {
  useSocketTranslation();
  const [name, setName] = useState(webhook.display_name);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const webhookUrl = webhook.url ?? `${getServerHttpBase(host)}/api/webhooks/${webhook.webhook_id}/${webhook.token}`;

  const save = useCallback(
    async (updates: Record<string, unknown>): Promise<boolean> => {
      try {
        const res = await fetch(`${apiBase}/${webhook.webhook_id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify(updates),
        });
        if (!res.ok) throw new Error(socketI18n.t("socketFull.serverWebhooksTab_747a31bb50"));
        const updated = await res.json() as WebhookItem;
        onUpdate({ ...webhook, ...updated });
        return true;
      } catch {
        toast.error(socketI18n.t("socketFull.serverWebhooksTab_141eaa1adc"));
        return false;
      }
    },
    [apiBase, webhook, authHeaders, onUpdate],
  );

  const handleNameChange = useCallback(
    (value: string) => {
      setName(value);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        const trimmed = value.trim();
        if (trimmed && trimmed !== webhook.display_name) {
          save({ display_name: trimmed });
        }
      }, 600);
    },
    [webhook.display_name, save],
  );

  const handleNameBlur = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const trimmed = name.trim();
    if (trimmed && trimmed !== webhook.display_name) {
      save({ display_name: trimmed });
    }
  }, [name, webhook.display_name, save]);

  const handleChannelChange = useCallback(
    (channelId: string) => {
      save({ channel_id: channelId });
    },
    [save],
  );

  const handleAvatarClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleAvatarUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const fileId = await uploadWebhookAvatar(getServerHttpBase(host), authHeaders(), file, file.name);
        if (await save({ avatar_file_id: fileId })) toast.success(socketI18n.t("ui.avatarUpdated"));
      } catch (error) {
        toast.error(socketHookToast(() => error instanceof Error ? socketDisplayText(error.message) : socketI18n.t("socketFull.serverWebhooksTab_a8169b3028")));
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [host, authHeaders, save],
  );

  const copyUrl = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      toast.success(socketI18n.t("socketFull.serverWebhooksTab_5480c58e8c"));
    } catch {
      toast.error(socketI18n.t("ui.failedToCopy"));
    }
  }, [webhookUrl]);

  const avatarUrl = webhook.avatar_file_id && host
    ? getUploadsFileUrl(host, webhook.avatar_file_id, { thumb: true })
    : undefined;

  return (
    <Surface>
      <div className="flex gap-3 items-start">
        <Tooltip title={socketI18n.t("ui.clickToChangeAvatar")}>
          <button
            onClick={handleAvatarClick}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              borderRadius: "var(--gryt-radius-full)",
              flexShrink: 0,
            }}
          >
            <Avatar size="large" fallback={name[0] || "W"} src={avatarUrl} />
          </button>
        </Tooltip>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          style={{ display: "none" }}
          onChange={handleAvatarUpload}
        />

        <div className="flex flex-col gap-2" style={{ flex: 1, minWidth: 0 }}>
          <div className="flex gap-2 items-end flex-wrap">
            <div className="flex flex-col gap-1" style={{ flex: 1, minWidth: 160 }}>
              <span className="text-xs font-medium">{socketI18n.t("settingsFull.m709a23220f")}</span>
              <TextField
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                onBlur={handleNameBlur}
                placeholder={socketI18n.t("socketFull.serverWebhooksTab_dce84efb1a")}
              />
            </div>

            <div className="flex flex-col gap-1" style={{ flex: 1, minWidth: 160, maxWidth: 320 }}>
              <span className="text-xs font-medium">{socketI18n.t("ui.channel")}</span>
              <Select
                value={webhook.channel_id}
                onValueChange={(v) => handleChannelChange(String(v))}
                placeholder={socketI18n.t("socketFull.serverWebhooksTab_b324ba8689")}
                options={textChannels.map((ch) => ({
                  label: `# ${ch.name}`,
                  value: ch.id,
                }))}
              />
            </div>

            <div className="flex gap-1" style={{ paddingBottom: 1 }}>
              <Tooltip title={socketI18n.t("socketFull.serverWebhooksTab_2d50843a65")}>
                <IconButton size="xsmall" onClick={copyUrl}>
                  <PiCopyFill size={16} />
                </IconButton>
              </Tooltip>
              <Tooltip title={socketI18n.t("socketFull.serverWebhooksTab_7ec794cd26")}>
                <IconButton size="xsmall" onClick={() => onDelete(webhook.webhook_id)}>
                  <PiTrashFill size={16} />
                </IconButton>
              </Tooltip>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs" style={{
              fontFamily: "var(--code-font-family)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
              opacity: 0.6,
            }}>
              {webhookUrl}
            </span>
          </div>
        </div>
      </div>
    </Surface>
  );
}

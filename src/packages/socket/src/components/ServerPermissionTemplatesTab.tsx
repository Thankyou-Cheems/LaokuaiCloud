import { Button, IconButton, Surface, TextField } from "@gryt/ui";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Trans } from "react-i18next";
import type { Socket } from "socket.io-client";

import { i18n as socketI18n, useTranslation as useSocketTranslation } from "@/i18n";
import type { ChannelRule } from "@/settings/src/channelPermissionRules";

import { PiPlusBold, PiTrashBold } from "../../../../lib/icons";
import { useSocketEvent } from "../hooks/useSocketEvent";
import { ChannelPermissionMatrix } from "./ChannelPermissionMatrix";

/**
 * Permission templates: the answer several channels share. Needs `manage_roles`
 * rather than `manage_channels` — a template is server-wide policy.
 */

interface Template {
  id: string;
  name: string | null;
  isSystem: boolean;
  channelCount: number;
  rules: ChannelRule[];
}

interface TemplatesPayload {
  permissions?: string[];
  templates?: Template[];
}

interface RolesPayload {
  roles?: { id: string; name: string; rank: number; permissions: string[] }[];
}

/** Marks a template that has not been saved yet, so it has no server id. */
const NEW_TEMPLATE = "__new__";

export function ServerPermissionTemplatesTab({
  socket,
  accessToken,
}: {
  host: string;
  socket?: Socket;
  accessToken: string | null;
}) {
  useSocketTranslation();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [roles, setRoles] = useState<{ id: string; name: string; rank: number; permissions: string[] }[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftRules, setDraftRules] = useState<ChannelRule[]>([]);
  const [saving, setSaving] = useState(false);

  const refresh = () => {
    if (!socket?.connected || !accessToken) return;
    socket.emit("server:permissions:templates:list", { accessToken });
    // The matrix needs the roles and what each already holds, so an inheriting
    // cell can show what it inherits. Both need `manage_roles` anyway.
    socket.emit("server:roles:definitions:list", { accessToken });
  };

  useSocketEvent<TemplatesPayload>(socket, "server:permissions:templates", (payload) => {
    if (!payload?.templates) return;
    setTemplates(payload.templates);
    if (payload.permissions?.length) setPermissions(payload.permissions);
    setSaving(false);

    // Somebody else saving while this is open replaces what is here rather than
    // merging: merging two matrices produces a policy neither person chose.
    setSelectedId((current) => {
      if (current === NEW_TEMPLATE) return current;
      const still = payload.templates?.find((t) => t.id === current);
      if (!still) return null;
      setDraftName(still.name ?? "");
      setDraftRules(still.rules);
      return current;
    });
  });

  useSocketEvent<RolesPayload>(socket, "server:roles:definitions", (payload) => {
    if (payload?.roles) setRoles(payload.roles);
  });

  // useEffect, not useMemo. Emitting is a side effect, and doing it during
  // render fires it twice under StrictMode and at times React does not promise.
  useEffect(refresh, [socket, accessToken]);

  const selected = templates.find((t) => t.id === selectedId) ?? null;
  const isNew = selectedId === NEW_TEMPLATE;

  const select = (template: Template) => {
    setSelectedId(template.id);
    setDraftName(template.name ?? "");
    setDraftRules(template.rules);
  };

  const startNew = () => {
    setSelectedId(NEW_TEMPLATE);
    setDraftName("");
    setDraftRules([]);
  };

  const save = () => {
    if (!socket?.connected || !accessToken) return toast.error(socketI18n.t("socketFull.serverPermissionTemplatesTab_213e89eca7"));
    const name = draftName.trim();
    if (!name) return toast.error(socketI18n.t("socketFull.serverPermissionTemplatesTab_ac1165a90f"));

    setSaving(true);
    socket.emit("server:permissions:template:save", {
      accessToken,
      // Absent for a new one, so the server mints the id. Sending NEW_TEMPLATE
      // would create a template literally called __new__ and reuse it.
      templateId: isNew ? undefined : selectedId,
      name,
      // The whole matrix, not a patch. A cell put back to inherit is a rule
      // absent from this list, and the server deletes what is not sent.
      rules: draftRules,
    });
    setTimeout(refresh, 400);
  };

  const remove = (template: Template) => {
    if (!socket?.connected || !accessToken) return;
    socket.emit("server:permissions:template:delete", { accessToken, templateId: template.id });
    if (selectedId === template.id) setSelectedId(null);
    setTimeout(refresh, 400);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">{socketI18n.t("socketFull.serverPermissionTemplatesTab_44557ed166")}</span>
          <span className="text-xs">{socketI18n.t("socketFull.serverPermissionTemplatesTab_b06af636b6")}</span>
        </div>
        <IconButton size="small" onClick={startNew} aria-label={socketI18n.t("socketFull.serverPermissionTemplatesTab_95b4494644")}>
          <PiPlusBold size={14} />
        </IconButton>
      </div>

      {templates.length === 0 && !isNew && (
        <span className="text-xs">{socketI18n.t("socketFull.serverPermissionTemplatesTab_b3be91a161")}</span>
      )}

      <div className="flex flex-col gap-1">
        {templates.map((template) => (
          <Surface
            key={template.id}
            className={`flex items-center justify-between gap-2 p-2 ${
              selectedId === template.id ? "ring-1" : ""
            }`}
          >
            <button
              type="button"
              className="flex flex-1 flex-col items-start text-left"
              onClick={() => select(template)}
            >
              <span className="text-sm">{template.name}</span>
              <span className="text-xs">
                {/* The number that decides whether an edit here is small or
                    frightening, so it sits on the row rather than behind a
                    click. */}
                {template.channelCount === 0
                  ? socketI18n.t("socketFull.serverPermissionTemplatesTab_55213a0b34")
                  : socketI18n.t("socketFull.serverPermissionTemplatesTab_f7d386c796", { p0: (template.channelCount), count: (template.channelCount) })}
              </span>
            </button>
            {!template.isSystem && (
              <IconButton
                size="xsmall"
                aria-label={socketI18n.t("socketFull.serverPermissionTemplatesTab_65bafae410", { p0: (template.name) })}
                onClick={() => remove(template)}
              >
                <PiTrashBold size={13} />
              </IconButton>
            )}
          </Surface>
        ))}
      </div>

      {(selected || isNew) && (
        <Surface className="flex flex-col gap-3 p-3">
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">{socketI18n.t("settingsFull.m709a23220f")}</span>
            <TextField
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder={socketI18n.t("socketFull.serverPermissionTemplatesTab_c5fd020bf3")}
            />
          </div>

          <ChannelPermissionMatrix
            roles={roles}
            permissions={permissions}
            rules={draftRules}
            disabled={saving}
            onChange={setDraftRules}
          />

          {/* Said before the save, not after. By the time it lands, anybody in
              a voice room they can no longer see has already been removed. */}
          {selected && selected.channelCount > 0 && (
            <span className="text-xs"><Trans i18n={socketI18n} i18nKey="socketFull.saveTemplateImpact" values={{ count: selected.channelCount }} count={selected.channelCount} /></span>
          )}

          <div className="flex gap-2">
            <Button size="small" disabled={saving} onClick={save}>
              {saving ? socketI18n.t("socketFull.serverPermissionTemplatesTab_a0f752322b") : isNew ? socketI18n.t("socketFull.serverPermissionTemplatesTab_00bcc5dbe2") : socketI18n.t("socketFull.serverPermissionTemplatesTab_81fad1a780")}
            </Button>
            <Button size="small" onClick={() => setSelectedId(null)}>{socketI18n.t("ui.cancel")}</Button>
          </div>
        </Surface>
      )}
    </div>
  );
}

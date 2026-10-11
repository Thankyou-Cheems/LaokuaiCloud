import { Button, Chip, TextField } from "@gryt/ui";
import { type ChangeEvent } from "react";

import { i18n as socketI18n, useTranslation as useSocketTranslation } from "@/i18n";

import { PiDownloadSimpleFill, PiMagnifyingGlassFill, PiX } from "../../../../lib/icons";
import { useEmoteImport } from "../hooks/useEmoteImport";
import { type TokenRefreshSocketLike } from "../utils/tokenManager";
import { EmoteRow } from "./EmoteRow";

export function EmoteImport({
  host,
  accessToken,
  socket,
  existingNames,
}: {
  host: string;
  accessToken: string | null;
  socket: TokenRefreshSocketLike | null;
  existingNames: Set<string>;
}) {
  useSocketTranslation();
  const {
    url,
    setUrl,
    fetching,
    importing,
    username,
    emotes,
    filterText,
    setFilterText,
    selectedEmotes,
    validSelectedCount,
    filteredEmotes,
    handleFetch,
    toggleSelect,
    toggleAll,
    updateName,
    handleImport,
    handleClear,
  } = useEmoteImport({ host, accessToken, socket, existingNames });

  return (
    <div className="flex flex-col gap-3 p-3" style={{
        border: "1px solid var(--gryt-neutral-a5)",
        borderRadius: "var(--gryt-radius-sm)",
      }}>
      <span className="text-sm font-medium">{socketI18n.t("socketFull.emoteImport_6e0969d785")}</span>
      <span className="text-xs text-gryt-muted" style={{ marginTop: -6 }}>{socketI18n.t("socketFull.emoteImport_da3db6f738")}</span>

      <div className="flex gap-2 items-center">
        <TextField
          size="small"
          placeholder={socketI18n.t("socketFull.emoteImport_50a5fc5e79")}
          value={url}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setUrl(e.target.value)}
          onKeyDown={(e: React.KeyboardEvent) => {
            if (e.key === "Enter") handleFetch();
          }}
          disabled={fetching || importing}
          className="flex-1"
        />
        <Button tone="neutral" size="xsmall"
          disabled={fetching || importing || !url.trim()}
          onClick={handleFetch}
        >
          {fetching ? socketI18n.t("socketFull.emoteImport_a3d5a94a11") : socketI18n.t("socketFull.emoteImport_3ec95e22f0")}
        </Button>
      </div>

      {emotes.length > 0 && (
        <>
          <div className="flex justify-between items-center gap-2">
            <div className="flex items-center gap-2">
              {username && (
                <span className="text-xs text-gryt-muted">
                  {username}
                </span>
              )}
              <Chip tone="neutral">
                {socketI18n.t("socketFull.emoteSelectionCount", { count: emotes.length })}
              </Chip>
              <Chip tone="success">
                {selectedEmotes.length}{" "}{socketI18n.t("socketFull.emoteImport_4071008825")}</Chip>
            </div>
            <div className="flex gap-2">
              <Button tone="ghost" size="xsmall"
                onClick={() => toggleAll(true)}
                disabled={importing}
              >{socketI18n.t("socketFull.emoteImport_5cc56d7662")}</Button>
              <Button tone="ghost" size="xsmall"
                onClick={() => toggleAll(false)}
                disabled={importing}
              >{socketI18n.t("socketFull.emoteImport_a3cbf0dae4")}</Button>
            </div>
          </div>

          {emotes.length > 10 && (
            <div className="relative">
              {/* Same trick as the settings search: the library's TextField is
                  a field rather than a container, so the icon sits over it. */}
              <PiMagnifyingGlassFill
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-gryt-muted"
                size={14}
              />
              <TextField
                className="pl-8"
                size="small"
                placeholder={socketI18n.t("socketFull.emoteImport_7c2bf97f0e")}
                value={filterText}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setFilterText(e.target.value)
                }
              />
            </div>
          )}

          <div className="flex flex-col gap-1" style={{ maxHeight: 400, overflowY: "auto" }}>
            {filteredEmotes.map((e) => (
              <EmoteRow
                key={e.id}
                emote={e}
                importing={importing}
                onToggleSelect={toggleSelect}
                onUpdateName={updateName}
              />
            ))}
          </div>

          <div className="flex justify-end gap-2">
            <Button tone="neutral" size="xsmall"
              disabled={importing}
              onClick={handleClear}
            >
              <PiX size={14} />{" "}{socketI18n.t("ui.clear")}</Button>
            <Button size="xsmall"
              disabled={importing || validSelectedCount === 0}
              onClick={handleImport}
            >
              <PiDownloadSimpleFill size={14} />
              {importing
                ? socketI18n.t("socketFull.emoteImport_1282255ef3")
                : socketI18n.t("socketFull.emoteImport_f2c00b22e6", { p0: (validSelectedCount), count: (validSelectedCount) })}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

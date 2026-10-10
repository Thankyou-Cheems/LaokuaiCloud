import { Chip } from "@gryt/ui";
import { useState } from "react";

import { i18n as socketI18n, useTranslation as useSocketTranslation } from "@/i18n";

export interface ForumTagDraft {
  id: string;
  name: string;
  emoji?: string | null;
  color?: string | null;
}

/**
 * A forum's tag palette, edited as chips. Shared by the create dialog and the
 * channel edit dialog, so tags can be set when a forum is made and changed after.
 */

function slugifyTag(name: string): string {
  return (
    name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) ||
    `tag-${Math.random().toString(36).slice(2, 8)}`
  );
}

export function ForumTagsField({
  tags,
  onChange,
}: {
  tags: ForumTagDraft[];
  onChange: (next: ForumTagDraft[]) => void;
}) {
  useSocketTranslation();
  const [draft, setDraft] = useState("");

  const add = () => {
    const name = draft.trim().slice(0, 40);
    if (!name) return;
    const id = slugifyTag(name);
    if (tags.some((t) => t.id === id) || tags.length >= 40) {
      setDraft("");
      return;
    }
    onChange([...tags, { id, name }]);
    setDraft("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div
        style={{
          display: "flex", flexWrap: "wrap", gap: 7, alignItems: "center",
          background: "var(--gryt-neutral-3)", border: "1px solid var(--gryt-neutral-6)",
          borderRadius: "var(--gryt-radius-sm)", padding: "8px 10px",
        }}
      >
        {/* Chip's own onDelete draws the remove button and labels it
            "Remove", which is what the span here was reimplementing by hand. */}
        {tags.map((t) => (
          <Chip
            key={t.id}
            label={t.name}
            className="px-2.5 py-0.5 text-xs"
            onDelete={() => onChange(tags.filter((x) => x.id !== t.id))}
          />
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            } else if (e.key === "Backspace" && !draft && tags.length > 0) {
              onChange(tags.slice(0, -1));
            }
          }}
          onBlur={add}
          placeholder={tags.length ? socketI18n.t("socketFull.forumTagsField_9814d85faf") : socketI18n.t("socketFull.forumTagsField_b2cd3d728b")}
          style={{ flex: 1, minWidth: 120, background: "transparent", border: "none", outline: "none", color: "var(--gryt-neutral-12)", fontSize: 14, fontFamily: "inherit" }}
        />
      </div>
      <span style={{ fontSize: 11.5, color: "var(--gryt-neutral-10)" }}>{socketI18n.t("socketFull.forumTagsField_c95b863f0b")}</span>
    </div>
  );
}

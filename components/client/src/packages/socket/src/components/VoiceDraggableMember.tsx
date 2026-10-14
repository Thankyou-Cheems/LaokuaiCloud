import type { ReactNode } from "react";

import type { useVoiceMemberDrag } from "./useVoiceMemberDrag";

export function VoiceDraggableMember({ drag, clientId, children }: {
  drag: ReturnType<typeof useVoiceMemberDrag>; clientId: string; children: ReactNode;
}) {
  const member = drag.memberProps(clientId);
  return <div {...member.props} data-voice-member-wrapper className="relative flex items-center">
    {member.canOffer && <button type="button" data-voice-drag-handle
      draggable={member.available} disabled={!member.available}
      aria-label={member.label} title={member.label}
      className="shrink-0 px-1 text-gryt-muted hover:text-gryt-text disabled:opacity-40"
      style={{ cursor: member.available ? "grab" : "not-allowed" }}
      onClick={event => { event.preventDefault(); event.stopPropagation(); }}>
      <span aria-hidden="true">⠿</span>
    </button>}
    <div className="min-w-0 flex-1">{children}</div>
  </div>;
}

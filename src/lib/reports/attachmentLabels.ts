/** Display adapter for @gryt/core 0.16.1 describeAttached. Unknown rows stay verbatim.
 * It never changes the Report object, logs, route, identifiers, or upload payload. */
export function localizeAttachmentLines(
  lines: readonly { label: string; value: string }[],
  translate: (key: string, values?: Record<string, unknown>) => string,
): { label: string; value: string }[] {
  const labels: Record<string, string> = {
    Channel: "channel", System: "system", Simulator: "simulator", Window: "window",
    Timezone: "timezone", "Where you were": "route", "Running for": "uptime",
    Server: "server", "In voice": "voice", "Own server": "ownServer", Log: "log", Install: "install",
  };
  return lines.map(({ label, value }) => {
    let shownValue = value;
    if (["Simulator", "In voice", "Own server"].includes(label) && value === "yes") {
      shownValue = translate("shellFull.reportAttachment.yes");
    } else if (label === "Log") {
      const match = /^last (\d+) lines$/.exec(value);
      if (match) shownValue = translate("shellFull.reportAttachment.logLines", { count: Number(match[1]) });
    } else if (label === "Running for") {
      const match = /^([\d.]+) (sec|min|h)$/.exec(value);
      if (match) shownValue = translate("shellFull.reportAttachment." + match[2], { amount: match[1] });
    }
    return { label: Object.prototype.hasOwnProperty.call(labels, label) ? translate("shellFull.reportAttachment." + labels[label]) : label, value: shownValue };
  });
}

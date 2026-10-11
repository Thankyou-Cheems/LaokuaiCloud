/** Display-only adapter for known report errors. Retryability and payload stay upstream. */
export function localizeReportError(message: string, translate: (key: string, values?: Record<string, unknown>) => string): string {
  const messages: Record<string, string> = {
  "That did not send. Check your connection and try again.": "shellSecond.reportConnection",
  "That is a lot of reports at once. Try again shortly.": "shellSecond.reportRate",
  "That is too long to send. Try trimming it down.": "shellSecond.reportLong",
  "Reports are not being accepted from this app.": "shellSecond.reportRefused",
  "That did not send. Something on our side.": "shellSecond.reportService"
};
  if (Object.prototype.hasOwnProperty.call(messages, message)) return translate(messages[message]);
  const retry = /^That is a lot of reports at once\. Try again in (\d+) (seconds|minutes)\.$/.exec(message);
  if (retry) return translate(retry[2] === "seconds" ? "shellSecond.reportWaitSeconds" : "shellSecond.reportWaitMinutes", { count: Number(retry[1]) });
  return message;
}

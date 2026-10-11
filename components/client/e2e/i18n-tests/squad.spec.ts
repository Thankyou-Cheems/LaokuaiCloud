import { expect, test } from "@playwright/test";

test.setTimeout(60_000);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { if (localStorage.getItem("gryt.ui.language") === null) localStorage.setItem("gryt.ui.language", "en"); });
  await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  await page.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { throw new Error("Real media forbidden"); }; });
  await page.goto("/e2e/squad-harness.html");
  await expect(page.getByTestId("ready")).toHaveText("true");
});
test("defaults on, off persists, other audio defaults unchanged", async ({ page }) => {
  await expect(page.getByTestId("config")).toContainText('"enabled":true');
  await expect(page.getByTestId("config")).toContainText('"processDetection":true');
  await expect(page.getByTestId("other-audio")).toHaveText('{"compressor":false,"amount":50,"rn":true,"agc":false,"mic":50,"gate":1,"esports":false}');
  await page.getByRole("switch").first().click();
  await expect(page.getByTestId("config")).toContainText('"enabled":false');
  await page.reload(); await expect(page.getByTestId("ready")).toHaveText("true");
  await expect(page.getByTestId("config")).toContainText('"enabled":false');
});
test("foreground switch warns, validated target persists, shortcut overlap rejected", async ({ page }) => {
  await page.getByRole("switch").nth(1).click();
  await expect(page.getByRole("alert")).toContainText("every application");
  await page.getByRole("textbox").fill("*.exe");
  await page.getByRole("button", { name: "Validate and apply" }).click();
  await expect(page.getByTestId("squad-error")).toContainText("without arguments");
  await page.getByRole("textbox").fill("MySquad.exe");
  await page.getByRole("button", { name: "Validate and apply" }).click();
  await expect(page.getByTestId("config")).toContainText("MySquad.exe");
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await page.keyboard.press("Control+KeyM");
  await expect(page.getByTestId("squad-error")).toContainText("overlaps");
  await expect(page.getByTestId("config")).toContainText("KeyB");
});
test("actual ACK only, recovery/error, orthogonal manual reason, language and unknown", async ({ page }) => {
  await page.getByRole("button", { name: "Request", exact: true }).click();
  await expect(page.getByTestId("squad-status")).toContainText("acknowledgement");
  await expect(page.getByTestId("voice-mode-icon")).toHaveAttribute("aria-label", /suppression acknowledgement/);
  await page.getByRole("button", { name: "ACK", exact: true }).click();
  await expect(page.getByTestId("voice-mode-icon")).toHaveAttribute("aria-label", /confirmed by audio boundary/);
  await page.getByRole("button", { name: "Manual mute", exact: true }).click();
  await expect(page.getByTestId("voice-mode-icon")).toHaveAttribute("aria-label", /Squad gate confirmed closed.*Manually muted/);
  await page.getByRole("button", { name: "Chinese", exact: true }).click();
  await expect(page.getByTestId("voice-mode-icon")).toHaveAttribute("aria-label", /手动静音/);
  await page.getByRole("button", { name: "Fresh recovery", exact: true }).click();
  await expect(page.getByTestId("squad-status")).toContainText("新麦克风音频");
  await page.getByRole("button", { name: "Failure", exact: true }).click();
  await expect(page.getByTestId("squad-status")).toContainText("失败");
  await page.getByRole("button", { name: "Old peer", exact: true }).click();
  await expect(page.getByTestId("voice-mode-icon")).toHaveAttribute("aria-label", /未知/);
});
test("narrow Chinese layout stays within viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Chinese", exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
test("IME composing Enter does not become a game shortcut", async ({ page }) => {
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "Enter", key: "Enter", isComposing: true, bubbles: true })));
  await expect(page.getByTestId("config")).toContainText("KeyB");
  await page.keyboard.press("KeyN");
  await expect(page.getByTestId("config")).toContainText("KeyN");
});

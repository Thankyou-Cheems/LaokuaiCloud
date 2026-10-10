import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  page.on("pageerror", error => console.log("PAGEERROR", error.stack));
  page.on("console", message => { if (message.type() === "error") console.log("BROWSERERROR", message.text()); });
  await page.route("**/*", route => new URL(route.request().url()).origin === "http://127.0.0.1:4777" ? route.continue() : route.abort());
  await page.addInitScript(() => {
    try { localStorage.setItem("gryt.ui.language", "zh-CN"); } catch { /* Opaque blocked frames have no preference store. */ }
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { throw new Error("synthetic only"); };
  });
  await page.goto("/e2e/integration-harness.html");
  await expect(page.getByTestId("ready")).toHaveText("true");
});

test("nickname draft, IME, explicit save, Esc, isolated scope and rejected save", async ({ page }) => {
  const input = page.getByPlaceholder("输入昵称");
  await input.fill("中文昵称 D");
  await page.getByRole("button", { name: "Chinese", exact: true }).click();
  await expect(page.getByTestId("names")).toHaveText('{"default":"Fixture D","a":"Fixture A"}');
  await input.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  await input.dispatchEvent("keydown", { key: "Enter", keyCode: 229 });
  await expect(page.getByTestId("names")).toContainText("Fixture D");
  await input.press("Escape");
  await expect(input).toHaveValue("Fixture D");
  await input.fill("新默认名");
  await page.getByRole("button", { name: "保存昵称", exact: true }).click();
  await expect(page.getByTestId("names")).toHaveText('{"default":"新默认名","a":"Fixture A"}');
  await input.fill("未保存默认草稿");
  await page.getByRole("button", { name: "Server A scope" }).click();
  await expect(input).toHaveValue("Fixture A");
  await input.fill("未被接受的昵称");
  await page.getByRole("button", { name: "保存昵称", exact: true }).click();
  await expect(input).toHaveValue("未被接受的昵称");
  await expect(page.getByTestId("names")).toHaveText('{"default":"新默认名","a":"Fixture A"}');
  await page.getByRole("button", { name: "Default scope" }).click();
  await expect(input).toHaveValue("新默认名");
});

test("actual state separated from switch, degradation message and dynamic language", async ({ page }) => {
  await page.getByRole("button", { name: "Degraded fixture" }).click();
  const row = page.getByTestId("row");
  await row.locator('[data-leveling-runtime="degraded"]').click();
  await expect(row.locator('[data-leveling-runtime="degraded"]')).toHaveAttribute("aria-pressed", "false");
  await row.getByRole("button", { name: "调节自动平衡队友音量", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("降低音量");
  await expect(page.getByText(/worklet-unavailable/)).toBeVisible();
  await page.evaluate(() => { localStorage.setItem("gryt.ui.language", "en"); window.dispatchEvent(new StorageEvent("storage", { key: "gryt.ui.language" })); });
  await expect(page.getByText(/worklet-unavailable/)).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("alert")).toContainText("attenuate");
});

test("real correction stays unknown, fixture learned ring survives current gain reset and only ACK closes icon", async ({ page }) => {
  await expect(page.getByTestId("real-correction").getByRole("img")).toHaveAttribute("aria-label", /尚未测量/);
  const ring = page.getByTestId("fixture-correction");
  const arc = await ring.locator('[data-correction-arc="boost"]').getAttribute("stroke-dashoffset");
  await expect(ring.getByRole("img")).toHaveAttribute("aria-label", /当前应用: \+3.2 dB/);
  await expect(page.locator('[data-squad-confirmed="true"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Gate ACK" }).click();
  await expect(page.locator('[data-squad-confirmed="true"]')).toHaveCount(1);
  await expect(ring.getByRole("img")).toHaveAttribute("aria-label", /当前应用: 0.0 dB/);
  expect(await ring.locator('[data-correction-arc="boost"]').getAttribute("stroke-dashoffset")).toBe(arc);
});

for (const width of [300, 390]) test(`volume popup at ${width}px, independent controls, keyboard and reduced motion`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const row = page.getByTestId("row");
  await row.getByRole("button", { name: "调节麦克风音量", exact: true }).click();
  const mic = page.getByRole("slider", { name: "麦克风音量", exact: true });
  await expect(mic).toBeVisible();
  expect(await page.getByRole("dialog").evaluate(el => getComputedStyle(el).transitionDuration)).toBe("0s");
  await mic.focus();
  await mic.press("Home");
  await expect(page.getByTestId("volumes")).toContainText('"mic":0');
  await mic.press("Escape");
  await expect(mic).not.toBeVisible();
  await row.getByRole("button", { name: "调节总接收音量", exact: true }).click();
  const output = page.getByRole("slider", { name: "总接收音量", exact: true });
  await output.focus();
  await output.press("End");
  await expect(page.getByTestId("volumes")).toContainText('"output":200');
  await expect(page.getByTestId("volumes")).toContainText('"mic":0');
  const bounds = await output.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
  await output.press("Escape");
  await page.getByTestId("capsule").getByRole("button", { name: "调节麦克风音量", exact: true }).click();
  await expect(page.getByRole("slider", { name: "麦克风音量", exact: true })).toHaveAttribute("aria-valuenow", "0");
  await page.screenshot({ path: `e2e/i18n-results/integration-${width}.png` });
});


test("hover crosses popup gap, dragging stays open, mute and deafen remain independent", async ({ page }) => {
  const row = page.getByTestId("row");
  const micAction = row.getByRole("button", { name: "麦克风静音", exact: true });
  await micAction.hover();
  const slider = page.getByRole("slider", { name: "麦克风音量", exact: true });
  await expect(slider).toBeVisible();
  const control = page.locator(".gryt-slider").first();
  await control.hover();
  const rect = await control.boundingBox();
  await page.mouse.move(rect!.x + rect!.width / 2, rect!.y + rect!.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect!.x + rect!.width * .75, rect!.y + rect!.height / 2, { steps: 5 });
  await expect(slider).toBeVisible();
  await page.mouse.up();
  await slider.press("Escape");
  await micAction.click();
  await expect(page.getByTestId("volumes")).toContainText('"muted":true');
  await expect(page.getByTestId("volumes")).toContainText('"deafened":false');
  await row.getByRole("button", { name: "耳机静音", exact: true }).click();
  await expect(page.getByTestId("volumes")).toContainText('"deafened":true');
  const previous = JSON.parse(await page.getByTestId("volumes").innerText());
  expect(previous.mic).not.toBe(50);
  await page.reload();
  await expect(page.getByTestId("ready")).toHaveText("true");
  await expect(page.getByTestId("volumes")).toContainText(`"mic":${previous.mic}`);
  await expect(page.getByTestId("volumes")).toContainText(`"output":${previous.output}`);
});

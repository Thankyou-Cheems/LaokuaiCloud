import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => new URL(route.request().url()).origin === "http://127.0.0.1:4777" ? route.continue() : route.abort());
  await page.addInitScript(() => {
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { throw new Error("synthetic only"); };
  });
});

test("member nickname keeps priority over auxiliary voice descriptions", async ({ page }) => {
  await page.goto("/e2e/room-layout-harness.html");
  const name = page.getByText("老蒯和队友的很长昵称", { exact: true });
  await expect(name).toBeVisible();
  const width = await name.evaluate(node => node.getBoundingClientRect().width);
  expect(width).toBeGreaterThanOrEqual(100);
  await expect(page.getByTestId("member-pane").getByTestId("voice-mode-icon").first()).toHaveAttribute("aria-label", /Squad/);
  expect(await page.getByTestId("member-pane").evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
});

test("announcements and another room do not reserve media, live replacement and final stop do", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto("/e2e/room-layout-harness.html");
  const panel = page.locator('[data-gryt="voice-view"]');
  const width = () => panel.evaluate(node => node.getBoundingClientRect().width);
  for (const action of ["failed", "other-room"]) {
    await page.getByRole("button", { name: action, exact: true }).click();
    await expect.poll(width).toBeLessThan(1);
  }
  for (const action of ["camera", "screen", "camera"]) {
    await page.getByRole("button", { name: action, exact: true }).click();
    await expect.poll(width).toBeGreaterThan(300);
    await expect(page.getByRole("toolbar", { name: "通话控制" })).toBeVisible();
  }
  await page.getByRole("button", { name: "stop-track", exact: true }).click();
  await expect.poll(width).toBeLessThan(1);
  await expect(page.locator('[data-gryt="room-call-bar"] [data-gryt="voice-audio-controls"]')).toBeVisible();
});

test("channel width supports pointer, keyboard, clamp and reload without viewport shrink overwriting it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto("/e2e/room-layout-harness.html");
  const handle = page.getByRole("separator", { name: "调整频道侧栏宽度" });
  await expect(handle).toHaveAttribute("aria-valuenow", "280");
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + 3, box.y + 100);
  await page.mouse.down(); await page.mouse.move(box.x + 103, box.y + 100); await page.mouse.up();
  await expect(handle).toHaveAttribute("aria-valuenow", "380");
  await page.reload(); await expect(handle).toHaveAttribute("aria-valuenow", "380");
  await handle.focus(); await handle.press("End");
  await expect(handle).toHaveAttribute("aria-valuenow", "480");
  await page.setViewportSize({ width: 700, height: 480 });
  await expect(handle).toHaveAttribute("aria-valuenow", "300");
  await page.setViewportSize({ width: 1440, height: 800 });
  await expect(handle).toHaveAttribute("aria-valuenow", "480");
  await handle.press("Home"); await expect(handle).toHaveAttribute("aria-valuenow", "220");
});

test("fullscreen includes the persistent bar, actions do not overlap or disconnect, last media leaves fullscreen", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto("/e2e/room-layout-harness.html");
  await page.getByRole("button", { name: "camera", exact: true }).click();
  const full = page.locator('[data-gryt="media-actions"] button').first();
  await expect(full).toBeVisible();
  const bar = page.locator('[data-gryt="room-call-bar"]');
  const leave = bar.locator('button').last();
  const a = (await full.boundingBox())!, b = (await leave.boundingBox())!;
  expect(a.y + a.height <= b.y || b.y + b.height <= a.y || a.x + a.width <= b.x || b.x + b.width <= a.x).toBe(true);
  await full.click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.getAttribute("data-gryt"))).toBe("server-view");
  await expect(bar).toBeVisible(); await expect(page.getByTestId("leave-count")).toHaveText("0");
  await full.click(); await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  await full.click();
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[data-testid="fixture-tools"] button:nth-child(5)')!.click());
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
});

for (const width of [300, 390, 800]) test(`narrow ${width}px keeps every call control when media opens, with no page overflow`, async ({ page }) => {
  await page.setViewportSize({ width, height: 480 });
  await page.goto("/e2e/room-layout-harness.html?narrow");
  const bar = page.locator('[data-gryt="room-call-bar"]');
  await expect(bar).toBeVisible();
  await page.getByRole("button", { name: "camera", exact: true }).click();
  await page.locator('[data-gryt="conversation-pane"] button').last().click();
  const media = page.locator('[data-gryt="narrow-media"]');
  await expect(media).toBeVisible(); await expect(bar).toBeVisible();
  const a = (await media.boundingBox())!, b = (await bar.boundingBox())!;
  expect(a.y + a.height).toBeLessThanOrEqual(b.y + 1);
  for (const button of await bar.locator('button').all()) {
    const box = (await button.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.y + box.height).toBeLessThanOrEqual(480);
  }
  await expect(page.getByRole("button", { name: "关闭媒体区域" })).toBeVisible();
  const full = media.locator('[data-gryt="media-actions"] button').first();
  await full.click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.getAttribute("data-gryt"))).toBe("server-view");
  await expect(bar).toBeVisible();
  await full.click();
  await page.getByRole("button", { name: "关闭媒体区域" }).click();
  await expect(media).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("a track added to an initially empty stream, then stopped without an event, updates visibility", async ({ page }) => {
  await page.goto("/e2e/room-layout-harness.html");
  const panel = page.locator('[data-gryt="voice-view"]');
  const width = () => panel.evaluate(node => node.getBoundingClientRect().width);
  await page.getByRole("button", { name: "empty-stream", exact: true }).click();
  await expect.poll(width).toBeLessThan(1);
  await page.getByRole("button", { name: "add-track", exact: true }).click();
  await expect.poll(width).toBeGreaterThan(100);
  await page.getByRole("button", { name: "stop-track", exact: true }).click();
  await expect.poll(width).toBeLessThan(1);
});

test("compact critical mute and speaking indicators stay visible, hover volumes remain reachable at zoom", async ({ page }) => {
  await page.setViewportSize({ width: 500, height: 480 });
  await page.goto("/e2e/room-layout-harness.html?narrow");
  await page.evaluate(() => {
    document.documentElement.style.zoom = "1.25";
    document.documentElement.style.setProperty("--gryt-ui-scale", "1.25");
  });
  await page.getByRole("button", { name: "suppressed-ack", exact: true }).click();
  const bar = page.locator('[data-gryt="room-call-bar"]');
  await expect(bar.locator('[data-squad-confirmed="true"]')).toHaveCount(1);
  await expect(bar.locator('[data-mic-closed="true"]')).toBeVisible();
  await expect(page.getByTestId("member-pane").getByText("短名", { exact: true })).toBeVisible();
  await bar.getByRole("button", { name: "调节麦克风音量", exact: true }).click();
  await expect(page.getByRole("slider", { name: "麦克风音量", exact: true })).toBeVisible();
  await page.getByRole("slider", { name: "麦克风音量", exact: true }).press("Escape");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "e2e/i18n-results/layout-narrow-zoom.png" });
});

test("layout still works with preference storage blocked", async ({ page }) => {
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
    Storage.prototype.getItem = function(key) { if (key === "gryt.layout.channelSidebarWidth.v1") throw new Error("blocked"); return get.call(this, key); };
    Storage.prototype.setItem = function(key, value) { if (key === "gryt.layout.channelSidebarWidth.v1") throw new Error("blocked"); return set.call(this, key, value); };
  });
  await page.setViewportSize({ width: 1440, height: 700 });
  await page.goto("/e2e/room-layout-harness.html");
  const handle = page.getByRole("separator", { name: "调整频道侧栏宽度" });
  await expect(handle).toHaveAttribute("aria-valuenow", "280");
  await handle.press("ArrowRight");
  await expect(handle).toHaveAttribute("aria-valuenow", "300");
  await page.screenshot({ path: "e2e/i18n-results/layout-no-media.png" });
  await page.getByRole("button", { name: "screen", exact: true }).click();
  await expect(page.locator('[data-gryt="media-actions"]')).toBeVisible();
  await page.screenshot({ path: "e2e/i18n-results/layout-screen.png" });
});

test("pure voice participants do not reserve a large media placeholder", async ({ page }) => {
  await page.goto("/e2e/room-layout-harness.html");
  const panel = page.locator('[data-gryt="voice-view"]');
  await expect(panel).toHaveCount(1);
  await expect.poll(() => panel.evaluate(node => node.getBoundingClientRect().width)).toBeLessThan(1);
});

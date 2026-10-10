import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1"
    ? route.continue() : route.abort());
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new Error("Real media forbidden"); };
  });
  await page.goto("/e2e/leveling-harness.html");
  await expect(page.getByTestId("ready")).toHaveText("true");
});

test("own default, persistent toggle, manual volume and live status translation", async ({ page }) => {
  await expect(page.getByTestId("enabled")).toHaveText("true");
  await expect(page.getByTestId("receive-leveling-status")).toContainText("Starting");
  await page.getByRole("button", { name: "Active", exact: true }).click();
  await expect(page.getByTestId("receive-leveling-status")).toContainText("6 ms");
  await page.getByRole("button", { name: "Chinese", exact: true }).click();
  await expect(page.getByTestId("receive-leveling-status")).toContainText("6 毫秒");
  await page.getByRole("button", { name: "Degraded", exact: true }).click();
  await expect(page.getByTestId("receive-leveling-status")).toContainText("保护已降级");
  await expect(page.getByTestId("receive-leveling-status")).toContainText("processorerror");
  await page.getByRole("switch").click();
  await expect(page.getByTestId("enabled")).toHaveText("false");
  await expect(page.getByTestId("receive-leveling-status")).toContainText("已关闭");
  await expect(page.getByTestId("manual-volume")).toHaveText("100");
  await page.reload();
  await expect(page.getByTestId("ready")).toHaveText("true");
  await expect(page.getByTestId("enabled")).toHaveText("false");
  await page.getByRole("switch").click();
  await page.getByRole("button", { name: "Suspended", exact: true }).click();
  await expect(page.getByTestId("receive-leveling-status")).toContainText("等待音频播放");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByTestId("receive-leveling-status")).toContainText("Waiting for audio playback");
});

test("narrow Chinese controls fit without a horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Chinese", exact: true }).click();
  await page.getByRole("button", { name: "Degraded", exact: true }).click();
  await expect(page.getByRole("switch")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

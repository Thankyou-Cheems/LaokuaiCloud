import { expect, test } from "@playwright/test";

test.setTimeout(60_000);
test.beforeEach(async ({ context, page }) => {
  await context.route("**/*", async route => {
    if (new URL(route.request().url()).origin === "http://127.0.0.1:4777") return route.continue();
    return route.fulfill({ json: {}, headers: { "access-control-allow-origin": "*" } });
  });
  await page.addInitScript(() => {
    localStorage.setItem("gryt.ui.language", "zh-CN");
    if (navigator.mediaDevices) {
      navigator.mediaDevices.getUserMedia = async () => { throw new DOMException("No real media", "NotAllowedError"); };
      navigator.mediaDevices.getDisplayMedia = async () => { throw new DOMException("No real media", "NotAllowedError"); };
      navigator.mediaDevices.enumerateDevices = async () => [];
    }
  });
});
async function assertDirectMain(page: import("@playwright/test").Page) {
  await expect(page.getByRole("button", { name: "设置与账号", exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("heading", { name: "欢迎使用老蒯聊" })).toHaveCount(0);
  await expect(page.locator('[data-gryt="tour"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "我自己看看" })).toHaveCount(0);
}
test("fresh profile initializes local ID and nickname, bypasses teaching across reload", async ({ page }) => {
  await page.goto("/"); await assertDirectMain(page);
  const stored = await page.evaluate(() => {
    const id = localStorage.getItem("gryt.deviceId");
    return { id, name: localStorage.getItem(`user:${id}:nickname`) };
  });
  expect(stored.id).toMatch(/^device:/); expect(JSON.parse(stored.name!)).not.toBe("Unknown");
  await page.reload(); await assertDirectMain(page);
  expect(await page.evaluate(() => localStorage.getItem("gryt.deviceId"))).toBe(stored.id);
  expect(await page.evaluate(id => localStorage.getItem(`user:${id}:nickname`), stored.id)).toBe(stored.name);
  await page.screenshot({ path: "e2e/i18n-results/startup-fresh-main.png" });
});
test("legacy tutorial flags and explicit preferences stay intact while teaching is bypassed", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("gryt.deviceId", "device:startup-fixture");
    for (const [key, value] of Object.entries({ nickname: "Existing nickname 测试", hasSeenWelcome: false,
      hasSeenTour: false, receiveLevelingEnabled: false, squadConfig: { enabled: false, processDetection: false, keys: ["KeyB"], target: "", releaseMs: 200 } })) {
      if (localStorage.getItem(`user:device:startup-fixture:${key}`) === null)
        localStorage.setItem(`user:device:startup-fixture:${key}`, JSON.stringify(value));
    }
  });
  await page.goto("/"); await assertDirectMain(page);
  const snapshot = () => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter(key => key.startsWith("user:device:startup-fixture:")).map(key => [key, localStorage.getItem(key)])));
  const before = await snapshot();
  expect(before["user:device:startup-fixture:nickname"]).toBe('"Existing nickname 测试"');
  expect(before["user:device:startup-fixture:hasSeenWelcome"]).toBe("false");
  expect(before["user:device:startup-fixture:hasSeenTour"]).toBe("false");
  expect(before["user:device:startup-fixture:receiveLevelingEnabled"]).toBe("false");
  await page.reload(); await assertDirectMain(page);
  expect(await snapshot()).toEqual(before);
});
test("desktop close-to-tray defaults on, explicit off survives reload, and can be reenabled", async ({ page }) => {
  await page.goto("/e2e/desktop-tray-harness.html");
  const toggle = page.locator('[data-setting="minimize-to-tray-on-close"]').getByRole("switch");
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("关闭窗口时最小化到托盘", { exact: true })).toBeVisible();
  await toggle.click(); await expect(toggle).toHaveAttribute("aria-checked", "false");
  expect(await page.evaluate(() => localStorage.getItem("fixture.closeToTray"))).toBe("false");
  await page.reload(); await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click(); await expect(toggle).toHaveAttribute("aria-checked", "true");
});

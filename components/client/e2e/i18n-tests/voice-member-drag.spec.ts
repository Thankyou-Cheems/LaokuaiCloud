import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

const screenshots = resolve(process.cwd(), "../../.local/voice-member-drag-ui");

test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => new URL(route.request().url()).origin === "http://127.0.0.1:4777" ? route.continue() : route.abort());
  await page.addInitScript(() => { if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { throw new Error("offline fixture only"); }; });
  await page.goto("/e2e/voice-member-drag-harness.html");
  await expect(page.getByTestId("fixture-a").locator("[data-voice-drag-member]")).toBeVisible();
});

test("native card drag sends one confirmed move, keeps roster and actor room pending", async ({ page }) => {
  const rooms = page.getByTestId("fixture-a");
  await mkdir(screenshots, { recursive: true });
  await rooms.screenshot({ path: resolve(screenshots, "member-card.png"), style: '[data-testid="volume-control"] {display:none !important}' });
  await rooms.locator("[data-voice-drag-member]").dragTo(rooms.locator('[data-voice-drop-channel="destination"]'));
  await expect(page.getByTestId("sent")).toContainText('"event":"voice:move:user"');
  await expect(rooms.locator('[data-voice-drop-channel="source"] [data-voice-move-pending]')).toHaveCount(1);
  await expect(rooms.locator('[data-voice-drop-channel="destination"] [data-voice-drag-member]')).toHaveCount(0);
  await expect(page.getByTestId("sorts")).toHaveText("0");
  await expect(page.getByTestId("clicks")).toHaveText("0");
  await expect(page.getByTestId("actor-room")).toHaveText("source");
  await page.getByRole("button", { name: "commit", exact: true }).click();
  await expect(rooms.locator('[data-voice-drop-channel="destination"] [data-voice-drag-member]')).toHaveCount(1);
  await expect(page.getByTestId("actor-room")).toHaveText("source");
  await expect(rooms.locator("[data-voice-move-pending]")).toHaveCount(0);
  await expect(page.getByTestId("sent")).not.toContainText("voice:channel:join");
});

test("failure leaves member in source, clears pending and keeps volume/context menu usable", async ({ page }) => {
  const rooms = page.getByTestId("fixture-a");
  await rooms.locator("[data-voice-drag-member]").dragTo(rooms.locator('[data-voice-drop-channel="destination"]'));
  await page.getByRole("button", { name: "fail", exact: true }).click();
  await expect(rooms.locator("[data-voice-move-pending]")).toHaveCount(0);
  await expect(rooms.locator('[data-voice-drop-channel="source"] [data-voice-drag-member]')).toHaveCount(1);
  await expect(rooms.getByRole("button", { name: /拖动/ })).toBeEnabled();
  await rooms.getByTestId("volume-control").click();
  await expect(page.getByTestId("clicks")).toHaveText("1");
  await rooms.locator('[data-gryt="voice-member"]').click({ button: "right" });
  await expect(page.getByRole("menu").last()).toBeVisible();
});

test("permission loss and unsupported server expose no active drag entry", async ({ page }) => {
  await page.getByRole("button", { name: "disable-server", exact: true }).click();
  await expect(page.getByTestId("fixture-a").getByRole("button", { name: /尚未支持/ })).toBeDisabled();
  await expect(page.getByTestId("fixture-a").locator("[data-voice-drag-member]")).toHaveAttribute("draggable", "false");
  await page.getByRole("button", { name: "ordinary-member", exact: true }).click();
  await expect(page.locator("[data-voice-drag-handle]")).toHaveCount(0);
  await expect(page.getByTestId("sent")).toHaveText("[]");
});

test("equal rank and ambiguous older second device cannot be dragged", async ({ page }) => {
  await page.getByRole("button", { name: "second-device", exact: true }).click();
  await expect(page.getByTestId("fixture-a").locator("[data-voice-drag-handle]")).toBeDisabled();
  await page.getByRole("button", { name: "equal-rank", exact: true }).click();
  await expect(page.locator("[data-voice-drag-handle]")).toHaveCount(0);
});

for (const destination of ["source", "text", "cross-community"]) {
  test(`rejects ${destination} drop without switching channel`, async ({ page }) => {
    const rooms = page.getByTestId("fixture-a");
    const target = destination === "cross-community" ? page.getByTestId("fixture-b").locator('[data-voice-drop-channel="destination"]') : rooms.locator(`[data-voice-drop-channel="${destination}"]`);
    await rooms.locator("[data-voice-drag-member]").dragTo(target);
    await expect(page.getByTestId("sent")).toHaveText("[]");
    await expect(page.getByTestId("clicks")).toHaveText("0");
    await expect(page.getByTestId("sorts")).toHaveText("0");
    await expect(page.locator("[data-voice-drop-active]")).toHaveCount(0);
  });
}

for (const invalidation of ["remove-destination", "text-destination", "server-moved", "replace-socket", "ordinary-member", "disable-server", "second-device"]) {
  test(`revalidates latest state after ${invalidation}`, async ({ page }) => {
    const rooms = page.getByTestId("fixture-a");
    const transfer = await page.evaluateHandle(() => new DataTransfer());
    await rooms.locator("[data-voice-drag-member]").dispatchEvent("dragstart", { dataTransfer: transfer });
    await rooms.locator('[data-voice-drop-channel="destination"]').dispatchEvent("dragover", { dataTransfer: transfer });
    await expect(rooms.locator("[data-voice-drop-active]")).toHaveCount(1);
    await page.getByRole("button", { name: invalidation, exact: true }).click();
    // A stale retained DOM event must also fail if the server removed/retyped its destination.
    const target = rooms.locator('[data-voice-drop-channel="destination"]');
    if (await target.count()) await target.dispatchEvent("drop", { dataTransfer: transfer });
    await expect(page.getByTestId("sent")).toHaveText("[]");
    await expect(page.locator("[data-voice-drop-active]")).toHaveCount(0);
    await transfer.dispose();
  });
}

test("Escape clears target feedback and refuses a later stale drop", async ({ page }) => {
  const rooms = page.getByTestId("fixture-a");
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await rooms.locator("[data-voice-drag-member]").dispatchEvent("dragstart", { dataTransfer: transfer });
  await rooms.locator('[data-voice-drop-channel="destination"]').dispatchEvent("dragover", { dataTransfer: transfer });
  await expect(rooms.getByRole("status")).toContainText("目标房间");
  await mkdir(screenshots, { recursive: true });
  await rooms.screenshot({ path: resolve(screenshots, "target-highlight.png"), style: '[data-testid="volume-control"] {display:none !important}' });
  await page.keyboard.press("Escape");
  await expect(rooms.locator("[data-voice-drop-active]")).toHaveCount(0);
  await rooms.locator('[data-voice-drop-channel="destination"]').dispatchEvent("drop", { dataTransfer: transfer });
  await expect(page.getByTestId("sent")).toHaveText("[]");
});

test("disconnect rejects pending operation and removes result listeners", async ({ page }) => {
  const rooms = page.getByTestId("fixture-a");
  await rooms.locator("[data-voice-drag-member]").dragTo(rooms.locator('[data-voice-drop-channel="destination"]'));
  await page.getByRole("button", { name: "disconnect", exact: true }).click();
  await expect(rooms.locator("[data-voice-move-pending]")).toHaveCount(0);
  await expect(page.getByTestId("listeners")).toHaveText("0");
  await expect(rooms.locator('[data-voice-drop-channel="source"] [data-voice-drag-member]')).toHaveCount(1);
});

test("volume control pointer cannot start a card drag or reorder", async ({ page }) => {
  const rooms = page.getByTestId("fixture-a");
  await rooms.getByTestId("volume-control").dragTo(rooms.locator('[data-voice-drop-channel="destination"]'));
  await expect(page.getByTestId("sent")).toHaveText("[]");
  await expect(page.getByTestId("sorts")).toHaveText("0");
});

test("wrong result generation never confirms or moves the roster", async ({ page }) => {
  const rooms = page.getByTestId("fixture-a");
  await rooms.locator("[data-voice-drag-handle]").dragTo(rooms.locator('[data-voice-drop-channel="destination"]'));
  await page.getByRole("button", { name: "wrong-generation", exact: true }).click();
  await expect(rooms.locator("[data-voice-move-pending]")).toHaveCount(0);
  await expect(rooms.locator('[data-voice-drop-channel="source"] [data-voice-drag-member]')).toHaveCount(1);
  await expect(page.getByTestId("listeners")).toHaveText("0");
});

test("unmount during pending request keeps protocol alive until confirmation and removes listeners", async ({ page }) => {
  const rooms = page.getByTestId("fixture-a");
  await rooms.locator("[data-voice-drag-member]").dragTo(rooms.locator('[data-voice-drop-channel="destination"]'));
  await page.getByRole("button", { name: "unmount", exact: true }).click();
  await expect(rooms).toHaveCount(0);
  await page.getByRole("button", { name: "fail", exact: true }).click();
  await expect(page.getByTestId("listeners")).toHaveText("0");
});

test("a foreign drag payload cannot substitute for the active card", async ({ page }) => {
  const rooms = page.getByTestId("fixture-a");
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await rooms.locator("[data-voice-drag-member]").dispatchEvent("dragstart", { dataTransfer: transfer });
  await transfer.evaluate(value => value.setData("application/x-laokuai-voice-member", "other-tab"));
  await rooms.locator('[data-voice-drop-channel="destination"]').dispatchEvent("drop", { dataTransfer: transfer });
  await expect(page.getByTestId("sent")).toHaveText("[]");
  await expect(page.locator("[data-voice-drop-active]")).toHaveCount(0);
});

test("channel sorting still starts from its header and sends no member move", async ({ page }) => {
  const rooms = page.getByTestId("fixture-a");
  const header = await rooms.getByRole("button", { name: "原房间", exact: true }).boundingBox();
  const destination = await rooms.locator('[data-voice-drop-channel="destination"]').boundingBox();
  if (!header || !destination) throw new Error("fixture geometry missing");
  await page.mouse.move(header.x + 12, header.y + 8);
  await page.mouse.down();
  await page.mouse.move(destination.x + 20, destination.y + destination.height + 20, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId("sorts")).not.toHaveText("0");
  await expect(page.getByTestId("sent")).toHaveText("[]");
});

test("explicitly disabled channel sorting does not block independent member moves", async ({ page }) => {
  const rooms = page.getByTestId("fixture-a");
  await page.getByRole("button", { name: "disable-sorting", exact: true }).click();
  const header = await rooms.getByRole("button", { name: "原房间", exact: true }).boundingBox();
  const destination = await rooms.locator('[data-voice-drop-channel="destination"]').boundingBox();
  if (!header || !destination) throw new Error("fixture geometry missing");
  await page.mouse.move(header.x + 12, header.y + 8);
  await page.mouse.down();
  await page.mouse.move(destination.x + 20, destination.y + destination.height + 20, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId("sorts")).toHaveText("0");
  await rooms.locator("[data-voice-drag-handle]").dragTo(rooms.locator('[data-voice-drop-channel="destination"]'));
  await expect(page.getByTestId("sent")).toContainText("voice:move:user");
  await page.getByRole("button", { name: "fail", exact: true }).click();
});

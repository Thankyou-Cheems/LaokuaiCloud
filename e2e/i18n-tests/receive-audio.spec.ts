import { expect, test } from "@playwright/test";

test("installed Voice AudioWorklet binds a real synthetic track to receiver-local UI", async ({ page }) => {
  const failures: string[] = [];
  page.on("pageerror", error => failures.push(error.message));
  await page.route("**/*", route => new URL(route.request().url()).origin === "http://127.0.0.1:4777" ? route.continue() : route.abort());
  await page.addInitScript(() => {
    localStorage.setItem("gryt.ui.language", "en");
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { throw new Error("real capture forbidden"); };
  });
  await page.goto("/e2e/receive-audio-harness.html");
  const ring = page.getByTestId("actual-ring").getByRole("img");
  await expect(ring).toHaveAttribute("aria-label", /Not measured/);
  await page.getByRole("button", { name: "Start synthetic graph", exact: true }).click();
  await expect(page.getByTestId("runtime")).toHaveText("active/6");
  await expect(ring).not.toHaveAttribute("aria-label", /Not measured/);
  const batch = JSON.parse(await page.getByTestId("batch").innerText());
  expect(batch.snapshots).toHaveLength(1);
  const measured = batch.snapshots[0];
  expect(measured.participantId).toBe('["synthetic-server","synthetic-member"]');
  expect(measured.trackId).toBe(await page.getByTestId("track").innerText());
  expect(Number.isFinite(measured.learnedAutoGainDb)).toBe(true);
  expect(Number.isFinite(measured.appliedAutoGainDb)).toBe(true);
  await page.getByRole("button", { name: "Screen alias", exact: true }).click();
  await expect(ring).toHaveAttribute("aria-label", /Not measured/);
  await page.getByRole("button", { name: "Microphone role", exact: true }).click();
  await expect(ring).not.toHaveAttribute("aria-label", /Not measured/);
  const rebound = JSON.parse(await page.getByTestId("batch").innerText()).snapshots[0];
  expect(rebound.receiverId).toBe(measured.receiverId);
  expect(rebound.generation).toBeGreaterThan(measured.generation);
  await page.getByRole("button", { name: "Disable graph", exact: true }).click();
  await expect(page.getByTestId("runtime")).toHaveText("disabled/6");
  await expect(ring).toHaveAttribute("aria-label", /disabled/);
  await page.getByRole("button", { name: "Dispose graph", exact: true }).click();
  await expect(page.getByTestId("runtime")).toHaveText("closed");
  await expect(ring).toHaveAttribute("aria-label", /Not measured/);
  await expect(page.getByTestId("error")).toBeEmpty();
  expect(failures).toEqual([]);
});

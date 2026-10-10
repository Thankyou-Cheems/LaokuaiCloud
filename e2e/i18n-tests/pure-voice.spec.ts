import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => new URL(route.request().url()).origin === "http://127.0.0.1:4777" ? route.continue() : route.abort());
  await page.addInitScript(() => {
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { throw new Error("isolated UI test never captures hardware"); };
  });
});

test("move recovery retry notice stays within narrow viewport and follows language changes",async({page})=>{
  await page.setViewportSize({width:300,height:600});
  await page.goto("/e2e/pure-voice-harness.html");
  await page.getByRole("button",{name:"Recovery fixture"}).click();
  await page.getByRole("button",{name:"重试政策确认"}).click();
  await expect(page.getByTestId("recovery-retries")).toHaveText("1");
  await page.getByRole("button",{name:"English fixture"}).click();
  await expect(page.getByRole("button",{name:"Retry policy confirmation"})).toBeVisible();
  await expect(page.getByRole("status").filter({hasText:"Destination audio"})).toContainText("remains blocked");
  await page.getByRole("button",{name:"Before promotion fixture"}).click();
  await expect(page.getByRole("status").filter({hasText:"Destination policy"})).toContainText("has not confirmed the destination connection yet");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

test("pure voice toolbar has labeled audio actions and no camera or share entry", async ({ page }) => {
  await page.goto("/e2e/room-layout-harness.html");
  const bar = page.getByRole("toolbar", { name: "通话控制" });
  await expect(bar).toBeVisible();
  await expect(bar.getByRole("button", { name: /摄像|屏幕|共享/ })).toHaveCount(0);
  for (const label of ["麦克风", "扬声器", "响度均衡", "离开"]) {
    await expect(bar.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(bar.getByRole("radio", { name: "自由麦" })).toBeVisible();
  await expect(bar.getByRole("radio", { name: "按键说话" })).toBeVisible();
  await expect(bar.getByRole("button", { name: "Squad 模式", exact: true })).toBeVisible();
});

test("mode selection preserves manual mute and supports keyboard", async ({ page }) => {
  await page.goto("/e2e/pure-voice-harness.html");
  await page.getByRole("button", {name:"Mute fixture"}).click();
  const ptt = page.getByRole("radio", {name:"按键说话"});
  await ptt.click(); await expect(ptt).toHaveAttribute("aria-checked","true");
  await expect(page.getByTestId("muted")).toHaveText("true");
  await ptt.press("Home"); await expect(page.getByRole("radio", {name:"自由麦"})).toHaveAttribute("aria-checked","true");
  await expect(page.getByTestId("muted")).toHaveText("true");
});

test("single-line member and compact correction leave numbers in details", async ({ page }) => {
  await page.goto("/e2e/pure-voice-harness.html");
  const member = page.getByTestId("member-pane").locator('[data-gryt="voice-member"]');
  expect(await member.evaluate(node => node.getBoundingClientRect().height)).toBeLessThan(40);
  expect(await member.locator('[data-gryt="member-name"]').evaluate(node => node.getBoundingClientRect().width)).toBeGreaterThan(100);
  const ring = page.locator('[data-receive-correction]');
  await expect(ring).not.toContainText("12.3");
  await expect(ring).toHaveAttribute("aria-label",/12.3/);
  await expect(page.locator('[data-gryt="speaking-halo"]')).toHaveCount(0);
  await page.getByRole("button", {name:"Speech fixture"}).click();
  await expect(page.locator('[data-gryt="speaking-halo"]')).toHaveCount(1);
  await page.emulateMedia({reducedMotion:"reduce"});
  expect(await page.locator('[data-gryt="speaking-halo"]').evaluate(node => getComputedStyle(node).animationName)).toBe("none");
});

test("destination policy shows actual forced PTT without changing preference or undoing mute",async({page})=>{
  await page.goto("/e2e/pure-voice-harness.html?forced=1");
  await page.getByRole("button",{name:"Mute fixture"}).click();
  await expect(page.getByRole("radio",{name:"自由麦"})).toBeDisabled();
  const ptt=page.getByRole("radio",{name:"按键说话"});
  await expect(ptt).toHaveAttribute("aria-checked","true");
  await ptt.press("Home");await expect(ptt).toHaveAttribute("aria-checked","true");
  await expect(page.getByTestId("mode-preference")).toHaveText("voice_activity");
  await expect(page.getByTestId("muted")).toHaveText("true");
  await expect(page.getByText("设置说话按键",{exact:true})).toBeVisible();
});

test("custom version page has no unavailable official updater actions", async ({ page }) => {
  await page.goto("/e2e/pure-voice-harness.html");
  const version = page.getByTestId("version-inline");
  await expect(version.getByText("版本与更新说明")).toBeVisible();
  await expect(version).toContainText("暂未建立自动更新服务");
  await expect(version.getByRole("button")).toHaveCount(0);
  await expect(version.getByRole("switch")).toHaveCount(0);
});

test("peer cues decode and render through the shared preview gain without device playback",async({page})=>{
  await page.goto("/e2e/peer-cue-harness.html");
  const results=[];
  for(const volume of [30,60]) {
    results.push(await page.evaluate(async(volume)=>{
      const offline=new OfflineAudioContext(1,48000,48000);
      let started!:()=>void;const ready=new Promise<void>(resolve=>{started=resolve;});
      // Inject a no-device context adapter; decoding, nodes and PCM rendering are native Chromium.
      class OfflineAdapter {
        state="running";destination=offline.destination;
        decodeAudioData(bytes:ArrayBuffer){return offline.decodeAudioData(bytes);}
        createGain(){return offline.createGain();}
        createBufferSource(){const node=offline.createBufferSource();const start=node.start.bind(node);
          node.start=(...args:Parameters<typeof node.start>)=>{start(...args);started();};return node;}
      }
      Object.defineProperty(window,"AudioContext",{value:OfflineAdapter,configurable:true});
      const {peerCueUrl}=await import(/* @vite-ignore */"/src/lib/peerVoiceCues.ts");
      const {playNotificationSound}=await import(/* @vite-ignore */`/src/packages/lib/notificationSound.ts?offline=${volume}`);
      const playback=playNotificationSound(peerCueUrl("join"),volume);
      await ready;const rendered=await offline.startRendering();await playback.finished;
      const samples=rendered.getChannelData(0);let sum=0,peak=0;
      for(const sample of samples){sum+=sample*sample;peak=Math.max(peak,Math.abs(sample));}
      return {rms:Math.sqrt(sum/samples.length),peak,last:samples[samples.length-1]};
    },volume));
  }
  expect(results[0].peak).toBeGreaterThan(0);expect(results[1].peak).toBeLessThan(.04);
  expect(results[1].rms/results[0].rms).toBeCloseTo(8,4);
  expect(results.every(result=>result.last===0)).toBe(true);
});

for (const scale of [1,1.25,1.5,2]) test(`overlays stay within small viewport at ${scale} scale`, async ({ page }) => {
  await page.setViewportSize({width:700,height:560});
  await page.goto(`/e2e/pure-voice-harness.html?scale=${scale}`);
  const within = async (selector: string) => {
    const popup = page.locator(selector).last();
    await expect(popup).toBeVisible();
    await expect.poll(() => popup.evaluate(node => {
      const r=node.getBoundingClientRect(); return r.left>=-1&&r.top>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;
    })).toBe(true);
  };
  await page.getByRole("button", {name:"Open confirm"}).click();
  await within('.gryt-alert-dialog');
  await page.getByRole("button",{name:"取消",exact:true}).click();
  await page.getByRole("button", {name:"Open audio"}).click();
  await within('[data-gryt="settings"]');
  await page.keyboard.press("Escape");
  const arrow=page.getByRole("button",{name:"调节麦克风音量",exact:true});
  await arrow.click(); await within('.gryt-popover');
  await page.setViewportSize({width:620,height:460}); await within('.gryt-popover');
  await page.keyboard.press("Escape");
  await page.getByRole("button",{name:"调节Squad 模式",exact:true}).click();await within('.gryt-popover');
  await page.keyboard.press("Escape");
  await page.getByTestId("member-pane").locator('[data-gryt="member-name"]').click({button:"right"});
  await within('.gryt-menu');
  await expect(page.getByRole("menuitem",{name:/移动.*频道/})).toHaveCount(0);
});

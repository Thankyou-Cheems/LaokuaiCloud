import {expect,test} from "@playwright/test";
// integration.4 replaces media/fullscreen acceptance with pure-voice policy. integration.3 evidence is frozen separately.
test.beforeEach(async({page})=>{
 await page.route("**/*",route=>new URL(route.request().url()).origin==="http://127.0.0.1:4777"?route.continue():route.abort());
 await page.addInitScript(()=>{if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=async()=>{throw new Error("synthetic only")};});
});
test("member nickname keeps priority over compact voice descriptions",async({page})=>{
 await page.goto("/e2e/room-layout-harness.html");
 const pane=page.getByTestId("member-pane");const name=pane.getByText("老蒯和队友的很长昵称",{exact:true});
 await expect(name).toBeVisible();expect(await name.evaluate(node=>node.getBoundingClientRect().width)).toBeGreaterThanOrEqual(100);
 expect(await pane.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
});
test("legacy remote media announcements cannot create video or media controls",async({page})=>{
 await page.goto("/e2e/room-layout-harness.html");
 for(const action of ["camera","screen","other-room","failed","stop-track","remove"]){
  await page.getByRole("button",{name:action,exact:true}).click();
  await expect(page.locator('video,[data-gryt="media-actions"]')).toHaveCount(0);
  await expect(page.getByRole("toolbar",{name:"通话控制"})).toHaveCount(1);
 }
});
test("channel width supports pointer, keyboard, clamp and reload",async({page})=>{
 await page.setViewportSize({width:1440,height:800});await page.goto("/e2e/room-layout-harness.html");
 const handle=page.getByRole("separator",{name:"调整频道侧栏宽度"});await expect(handle).toHaveAttribute("aria-valuenow","280");
 const box=(await handle.boundingBox())!;await page.mouse.move(box.x+3,box.y+100);await page.mouse.down();await page.mouse.move(box.x+103,box.y+100);await page.mouse.up();
 await expect(handle).toHaveAttribute("aria-valuenow","380");await page.reload();await expect(handle).toHaveAttribute("aria-valuenow","380");
 await handle.focus();await handle.press("End");await expect(handle).toHaveAttribute("aria-valuenow","480");
 await page.setViewportSize({width:700,height:480});await expect(handle).toHaveAttribute("aria-valuenow","300");
 await page.setViewportSize({width:1440,height:800});await expect(handle).toHaveAttribute("aria-valuenow","480");await handle.press("Home");await expect(handle).toHaveAttribute("aria-valuenow","220");
});
for(const width of [300,390,800])test(`narrow ${width}px wraps call groups and opens participants without media`,async({page})=>{
 await page.setViewportSize({width,height:480});await page.goto("/e2e/room-layout-harness.html?narrow");
 const bar=page.locator('[data-gryt="room-call-bar"]');await expect(bar).toBeVisible();
 await page.getByRole("button",{name:"通话成员",exact:true}).click();
 await expect(page.locator('.gryt-popover')).toBeVisible();await expect(page.locator('video,[data-gryt="media-actions"]')).toHaveCount(0);
 await page.keyboard.press("Escape");
 for(const button of await bar.locator('button').all()){
  const box=(await button.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(-1);expect(box.x+box.width).toBeLessThanOrEqual(width+1);expect(box.y+box.height).toBeLessThanOrEqual(480);
 }
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test("preference storage failure preserves channel resize",async({page})=>{
 await page.addInitScript(()=>{
  const get=Storage.prototype.getItem,set=Storage.prototype.setItem;
  Storage.prototype.getItem=function(key){if(key==="gryt.layout.channelSidebarWidth.v1")throw new Error("blocked");return get.call(this,key)};
  Storage.prototype.setItem=function(key,value){if(key==="gryt.layout.channelSidebarWidth.v1")throw new Error("blocked");return set.call(this,key,value)};
 });
 await page.setViewportSize({width:1440,height:700});await page.goto("/e2e/room-layout-harness.html");
 const handle=page.getByRole("separator",{name:"调整频道侧栏宽度"});await expect(handle).toHaveAttribute("aria-valuenow","280");await handle.press("ArrowRight");await expect(handle).toHaveAttribute("aria-valuenow","300");
});

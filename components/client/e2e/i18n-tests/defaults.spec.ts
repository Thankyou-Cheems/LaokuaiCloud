import { expect, test } from "@playwright/test";

test.setTimeout(60_000);
test.beforeEach(async ({context,page})=>{
  await context.route("**/*",route=>new URL(route.request().url()).origin==="http://127.0.0.1:4777"?route.continue():route.fulfill({json:{},headers:{"access-control-allow-origin":"*"}}));
  await page.addInitScript(()=>{
    Object.defineProperty(navigator,"languages",{value:["en-US"]});
    const counters={capture:0,display:0,permission:0};Object.assign(window,{fixtureCounters:counters});
    navigator.mediaDevices.getUserMedia=async()=>{counters.capture++;throw new DOMException("Fixture denies real media","NotAllowedError");};
    navigator.mediaDevices.getDisplayMedia=async()=>{counters.display++;throw new DOMException("Fixture denies real media","NotAllowedError");};
    navigator.mediaDevices.enumerateDevices=async()=>[];
    Notification.requestPermission=async()=>{counters.permission++;return "denied";};
  });
});
const counters=(page:import("@playwright/test").Page)=>page.evaluate(()=>(window as unknown as {fixtureCounters:{capture:number;display:number;permission:number}}).fixtureCounters);
async function values(page:import("@playwright/test").Page) {
  await expect(page.getByTestId("ready")).toHaveText("true",{timeout:30000});
  return JSON.parse((await page.getByTestId("values").textContent())!);
}
test("empty store uses approved defaults without capture or notification permission; explicit choices survive relaunch",async({page})=>{
  await page.goto("/e2e/defaults-harness.html"); const current=await values(page);
  expect(current).toMatchObject({language:"zh-CN",compressor:false,agc:false,rn:true,receive:true,mic:50,output:100,gate:1,release:200,
    message:false,connect:true,disconnect:true,connectVolume:30,desktop:true,badge:true,camera:"720p",cameraFps:30,screen:"720p",screenFps:30,gaming:false});
  expect(current.squad).toMatchObject({enabled:true,processDetection:true});
  await expect(page.locator("html")).toHaveAttribute("lang","zh-CN");
  await expect(page.getByTestId("notification")).toHaveText("mentions");
  await expect(page.getByTestId("decisions")).toHaveText("[false,true]");
  const config=JSON.parse((await page.getByTestId("voice").textContent())!);
  expect(config.audio).toMatchObject({compressorEnabled:false,noiseSuppression:true,receiveLevelingEnabled:true,volume:50,outputVolume:100});
  // Stored legacy media choices survive; runtime is inert under the private audio-only contract.
  expect(config.camera).toMatchObject({quality:"480p",fps:30});expect(config.screen).toMatchObject({quality:"480p",fps:30,gamingMode:false});
  expect(config.connection.mediaMode).toBe("audio-only");
  expect(config.audio).toMatchObject({noiseGateMode:"automatic",transmitSpeechActivityEnabled:true,transmitEligible:false});
  expect(await counters(page)).toEqual({capture:0,display:0,permission:0});
  await page.getByRole("button",{name:"Save explicit legacy choices"}).click();
  await page.reload();expect(await values(page)).toMatchObject({compressor:true,message:true,camera:"native",screen:"native",gaming:true});
  await expect(page.getByTestId("notification")).toHaveText("all");expect(await counters(page)).toEqual({capture:0,display:0,permission:0});
});
test("old explicit false, zero, null, empty and enum values are preserved",async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem("gryt.deviceId","device:defaults-fixture");localStorage.setItem("gryt.ui.language","en");
    localStorage.setItem("gryt_notification_prefs",JSON.stringify({global:"none",servers:{}}));
    const saved={nickname:"Fixture",compressorEnabled:true,messageSoundEnabled:true,rnnoiseEnabled:false,receiveLevelingEnabled:false,
      micVolume:0,outputVolume:0,noiseGate:0,noiseGateRelease:0,customMessageSoundFile:null,cameraQuality:"native",screenShareQuality:"native",screenShareGamingMode:true,outputDeviceID:""};
    for(const [key,value]of Object.entries(saved))localStorage.setItem(`user:device:defaults-fixture:${key}`,JSON.stringify(value));
  });
  await page.goto("/e2e/defaults-harness.html");expect(await values(page)).toMatchObject({language:"en",compressor:true,message:true,rn:false,receive:false,mic:0,output:0,gate:0,release:0,custom:null,camera:"native",screen:"native",gaming:true});
  await expect(page.getByTestId("notification")).toHaveText("none");
  expect(await page.evaluate(()=>localStorage.getItem("user:device:defaults-fixture:outputDeviceID"))).toBe('""');
});
test("opening camera settings waits for explicit local preview",async({page})=>{
  await page.goto("/e2e/defaults-harness.html");await values(page);
  await page.getByRole("button",{name:"Open camera settings"}).click();
  await expect(page.getByRole("button",{name:"开始本地预览"})).toBeVisible();expect((await counters(page)).capture).toBe(0);
  await page.getByRole("button",{name:"开始本地预览"}).click();
  await expect.poll(async()=>(await counters(page)).capture).toBe(1);expect((await counters(page)).display).toBe(0);
});
for(const platform of ["Web","Electron"] as const) for(const quality of ["720p","native"]) {
  test(`${platform} picker keeps ${quality}, audio off until manually selected, no automatic publication`,async({page})=>{
    if(platform==="Electron")await page.addInitScript(()=>Object.assign(window,{electronAPI:{isElectron:true,
      getDesktopSources:async()=>[{id:"screen:fixture:0",sourceType:"screen",name:"Synthetic screen",width:854,height:480,thumbnail:""}],
      getScreenCaptureAccess:async()=>"granted"}}));
    await page.goto(`/e2e/share-defaults-harness.html?quality=${quality}`);
    await expect(page.getByTestId("starts")).toHaveText("[]");await page.getByRole("button",{name:"Open picker"}).click();
    await expect(page.getByRole("dialog")).toBeVisible();await expect(page.getByTestId("quality")).toHaveText(quality);
    const audio=page.getByRole("checkbox",{name:"同时共享音频",exact:true});await expect(audio).not.toBeChecked();
    expect(await counters(page)).toEqual({capture:0,display:0,permission:0});
    await page.getByRole("button",{name:"共享",exact:true}).click();
    await expect(page.getByTestId("starts")).toContainText('"withAudio":false');
    await page.getByRole("button",{name:"Open picker"}).click();await audio.check();
    await page.getByRole("button",{name:"共享",exact:true}).click();await expect(page.getByTestId("starts")).toContainText('"withAudio":true');
    expect(await counters(page)).toEqual({capture:0,display:0,permission:0});
  });
}

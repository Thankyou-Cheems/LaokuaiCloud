/* eslint-disable react-refresh/only-export-components -- standalone TEST entry, no HMR */
import {createGrytTheme} from '@gryt/theme';
import {GrytUiI18nProvider,grytUiZhCN} from '@gryt/ui/i18n';
import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';

import {CommunityLanStatusControl} from '../../src/components/CommunityLanStatusControl';
import {easyTierCommunityAction} from '../../src/lib/easyTierCommunitySubscriptions';
type Variant = 'unconfigured' | 'cleanup' | 'disabled' | 'error';
declare global { interface Window { __componentFixture: { setVariant(v: Variant): void; snapshot(): object }; } }
const theme=createGrytTheme();for(const [n,v]of Object.entries(theme))document.documentElement.style.setProperty(n,v as string);
function Fixture(){
 const [variant,setVariant]=useState<Variant>('unconfigured'),[enabled,setEnabled]=useState(true),[events,setEvents]=useState<string[]>([]);
 const phase=variant==='unconfigured'?'activation-required':variant==='cleanup'?'error':variant==='disabled'?'disabled':'error';
 const reason=variant==='unconfigured'?'configuration-required':variant==='cleanup'?'cleanup-failed':'connect-failed';
 const action=easyTierCommunityAction({serverId:'synthetic-community',generation:1,phase,reason,virtualIp:null,lanSnapshot:null},enabled);
 useEffect(()=>{window.__componentFixture={setVariant:(v:Variant)=>{setVariant(v);setEnabled(v!=='disabled'&&v!=='cleanup');},snapshot:()=>{
  const rect=(n:Element|null|undefined)=>{if(!n)return null;const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
  const control=document.querySelector('[data-gryt="community-lan-control"]'),button=control?.querySelector('button'),popup=document.querySelector('[aria-label="社区联机详情"]');
  return {variant,enabled,action,events,viewport:{width:innerWidth,height:innerHeight},control:rect(control),controlPosition:control&&getComputedStyle(control).position,button:rect(button),footer:rect(document.querySelector('[data-fixture="footer"]')),popup:rect(popup),popupStyle:popup?{width:getComputedStyle(popup).width,minWidth:getComputedStyle(popup).minWidth,maxWidth:getComputedStyle(popup).maxWidth,boxSizing:getComputedStyle(popup).boxSizing,availableWidth:getComputedStyle(popup).getPropertyValue("--available-width"),availableHeight:getComputedStyle(popup).getPropertyValue("--available-height")} : null,popupText:popup?.textContent||'',bodyText:document.body.textContent,documentWidth:document.documentElement.scrollWidth,settingsLogo:(document.querySelector('[data-fixture="settings-logo"]') as HTMLImageElement)?.naturalWidth};
 }};},[variant,enabled,action,events]);
 return <GrytUiI18nProvider locale="zh-CN" labels={grytUiZhCN}><div className="flex min-h-0 h-full" style={{background:'var(--gryt-neutral-2)',color:'var(--gryt-neutral-12)'}}>
  <nav className="flex min-h-0 flex-col h-full gap-4 items-center justify-between" style={{width:60}}>
   <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pt-2 pb-1">{Array.from({length:20},(_,i)=><button key={i} style={{minHeight:32}}>TEST {i}</button>)}
    <CommunityLanStatusControl action={action} enabled={enabled} preparing={false} communityLabel="社区服务已连接（合成输入）" channelsReceived={true} onToggle={()=>{setEnabled(!enabled);setEvents([...events,'toggle']);}} onPrepare={()=>setEvents([...events,'prepare'])} onRetry={()=>setEvents([...events,'retry'])}/>
   </div>
   <div className="flex shrink-0 justify-center" data-fixture="footer"><button aria-label="TEST 设置"><img data-fixture="settings-logo" src="./laokuai-icon.png" width="32" height="32"/></button></div>
  </nav>
  <main style={{minWidth:0,padding:16}}>TEST · 真实社区控制组件，合成社区输入。真实账号、原生联机和语音未启动。</main>
 </div></GrytUiI18nProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);

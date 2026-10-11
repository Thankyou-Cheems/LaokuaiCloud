import { validateSocketEvidence } from './owned-tun-socket-policy.mjs';
const fail=code=>{throw new Error(code);};
export function validateLight(before,now,owned,{settling=false}={}) {
  validateSocketEvidence(now,settling?0:owned?.pid??0);
  if(now?.lightSchema!==1||now.complete!==true||!now.guiAlive||now.guiFingerprint!==before.guiFingerprint||!now.driverRunning)fail('light-old-identity-or-driver-unavailable');
  const old=before.adapters.find(n=>n.guid==='4226cc04-7343-4caa-bfd6-55d097487583');
  const current=now.adapters.find(n=>n.guid===old?.guid);
  if(!old||!current||current.ifIndex!==old.ifIndex||current.luid!==old.luid||current.status!==old.status||!current.addresses.some(a=>a.ip==='10.126.126.2'&&a.prefix===24))fail('light-protected-interface-changed');
  if(before.adapters.some(n=>!now.adapterGuids.includes(n.guid)))fail('light-old-interface-missing');
  const added=now.adapterGuids.filter(g=>!before.adapters.some(n=>n.guid===g));
  if(now.nonLoopbackRpc||now.ownedForbiddenSocketCount!==0)fail('light-unexpected-socket');
  if(added.length>1)fail('light-extra-interface');
  if(settling){if(added.length||now.portalOwnerPids.length)return false;return true;}
  if(!owned?.pid||owned.interfaces.length>1)fail('invalid-owned-receipt');
  if(now.portalOwnerPids.some(pid=>pid!==owned.pid))fail('foreign-rpc-listener');
  if(!added.length)return false;
  const n=now.adapters.find(n=>n.guid===added[0]);
  if(!n||n.alias!=='lk_trial_20261011_a'||n.hasDefault||!n.safeTrialRoutes||n.addresses.some(a=>a.family===4&&(a.ip!=='10.253.253.1'||a.prefix!==30)))fail('light-unexpected-trial-interface');
  const receipt=owned.interfaces[0];if(!receipt)return false;
  if(receipt.guid!==n.guid||receipt.ifIndex!==n.ifIndex||receipt.luid!==n.luid)fail('receipt-os-identity-mismatch');
  return n.status==='Up'&&n.addresses.some(a=>a.ip==='10.253.253.1'&&a.prefix===30)&&now.portalOwnerPids.includes(owned.pid)&&Boolean(now.ownedIdentity);
}

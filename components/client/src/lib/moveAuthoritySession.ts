import {createMoveAuthority} from "./moveAuthority";

/** Replace an invalidated authority only after a fresh authenticated server response.
 * The coordinator keeps its identity; captured old move authorities never revive. */
export function createMoveAuthoritySession(serverId:string,args:Parameters<typeof createMoveAuthority>,changed:()=>void) {
  const socket=args[0],generation=socket.id;
  let authority=createMoveAuthority(...args),disposed=false;
  const refresh=()=>{
    if(disposed || !socket.connected || socket.id!==generation || authority.valid)return;
    authority.dispose();authority=createMoveAuthority(...args);changed();
  };
  const details=(value?:unknown)=>{
    if(!value || typeof value!=="object")return;
    const row=value as Record<string,unknown>,info=row.server_info as Record<string,unknown>|undefined;
    if(!row.error && info?.server_id===serverId && Array.isArray(row.channels))refresh();
  };
  const joined=(value?:unknown)=>{
    if(value && typeof value==="object" && typeof (value as Record<string,unknown>).accessToken==="string")refresh();
  };
  const granted=(value?:unknown)=>{
    if(!value || typeof value!=="object")return;
    const row=value as Record<string,unknown>;
    if(typeof row.room_id==="string" && !!row.room_id && row.join_token && typeof row.join_token==="object" &&
      typeof row.timestamp==="number" && Math.abs(Date.now()-row.timestamp)<30000)refresh();
  };
  socket.on("server:details",details);socket.on("server:joined",joined);socket.on("voice:room:granted",granted);
  return {
    get authority(){return authority;},
    dispose(){if(disposed)return;disposed=true;socket.off("server:details",details);socket.off("server:joined",joined);
      socket.off("voice:room:granted",granted);authority.dispose();},
  };
}

const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
// One source for the reviewed recipe and the encoded synthetic trial config.
// No credentials, URLs, community identity or real profile enters this module.
export const NO_PEER_CONFIGURATION=freeze({
 topLevel:{instance_name:'owned-nic-trial',hostname:'owned-nic-trial',ipv4:'10.253.253.1/30',dhcp:false,
  listeners:[],peer:[],mapped_listeners:[],exit_nodes:[],routes:[],proxy_network:[],port_forward:[],
  stun_servers:[],tcp_stun_servers:[],stun_servers_v6:[],ipv6_public_addr_provider:false,ipv6_public_addr_auto:false},
 flags:{dev_name:'lk_trial_20261011_a',enable_ipv6:false,disable_upnp:true,disable_p2p:true,
  disable_tcp_hole_punching:true,disable_udp_hole_punching:true,enable_udp_broadcast_relay:false,accept_dns:false,
  enable_exit_node:false,proxy_forward_by_system:false,no_tun:false,private_mode:true,disable_relay_data:true,relay_network_whitelist:''},
 externalConfigManagement:false,
});
export function encodeNoPeerConfiguration(instanceId){
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(instanceId))throw new Error('invalid-instance-id');
 const scalar=value=>{if(Array.isArray(value)){if(value.length)throw new Error('trial-recipe-not-empty');return '[]';}if(typeof value==='boolean')return String(value);if(typeof value==='string')return JSON.stringify(value);throw new Error('invalid-trial-recipe-value');};
 const table=value=>Object.entries(value).map(([key,v])=>`${key} = ${scalar(v)}`).join('\n');
 return `instance_id = "${instanceId}"\n${table(NO_PEER_CONFIGURATION.topLevel)}\n\n[flags]\n${table(NO_PEER_CONFIGURATION.flags)}\n`;
}

import net from 'node:net';
import dgram from 'node:dgram';

const prohibited = () => { throw Error('network_prohibited_in_hybrid_regression'); };
net.Server.prototype.listen = net.Socket.prototype.connect = dgram.createSocket = prohibited;
globalThis.fetch = prohibited;
globalThis.RTCPeerConnection = class { constructor() { prohibited(); } };

const net = require('node:net'), dgram = require('node:dgram'), dns = require('node:dns');
const { randomBytes } = require('node:crypto');
process.env.JWT_SECRET = randomBytes(32).toString('hex'); process.env.NODE_ENV = 'test';
net.Server.prototype.listen = net.Socket.prototype.connect = dgram.createSocket = () => { throw new Error('network_prohibited_in_pure_hybrid_unit'); };
dns.lookup = dns.resolve = () => { throw new Error('dns_prohibited_in_pure_hybrid_unit'); };
global.fetch = () => { throw new Error('fetch_prohibited_in_pure_hybrid_unit'); };
require('ts-node/register');
require('../src/socket/handlers/voiceHybrid.test.ts');

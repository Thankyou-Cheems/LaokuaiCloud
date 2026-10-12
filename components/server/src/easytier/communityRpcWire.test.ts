import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRpcFrame, CommunityTcpRpcTransport, pbBytes, pbDecode, pbGetBytes, pbGetNumber,
  pbGetString, pbInstance, pbNumber, pbVarint, type RpcByteChannel, type RpcMethod,
} from './communityRpcWire';

const INSTANCE = '0b3d77dd-a3ad-4c31-aecc-2264c2d72130';
const NODE: RpcMethod = {service:'PeerManageRpc',index:7};
const ENDPOINT = {host:'127.0.0.1' as const,port:15889,timeoutMs:100};

test('pinned descriptor uses protobuf service name, not package name', () => {
  for (const method of [NODE,{service:'CredentialManageRpc' as const,index:3}]) {
    const frame = buildRpcFrame(method,pbBytes(1,pbInstance(INSTANCE)),1,2000);
    assert.equal(frame.readUInt32LE(0),frame.length-4);
    assert.equal(frame[12],8);
    assert.equal(frame[14],1);
    const packet = pbDecode(frame.subarray(20),{1:0,2:0,3:0,4:2,5:2,6:0,7:0,10:2});
    const descriptor = pbDecode(pbGetBytes(packet,4),{2:2,3:2,4:0});
    assert.equal(pbGetString(descriptor,2),method.service);
    assert.equal(pbGetString(descriptor,3),method.service);
    assert.equal(pbGetNumber(descriptor,4),method.index);
  }
});

test('UUID selector preserves four big-endian words through protobuf encoding', () => {
  const selector = pbDecode(pbInstance(INSTANCE),{1:2});
  const parts = pbDecode(pbGetBytes(selector,1),{1:0,2:0,3:0,4:0});
  assert.deepEqual([1,2,3,4].map(k=>pbGetNumber(parts,k)),[0x0b3d77dd,0xa3ad4c31,0xaecc2264,0xc2d72130]);
});

test('one-based method boundaries reject zero and unavailable methods before dialing', async () => {
  let dials = 0;
  const wire = new CommunityTcpRpcTransport(ENDPOINT,async()=>{ dials++; throw new Error('must-not-dial'); });
  for (const method of [
    {service:'PeerManageRpc' as const,index:0},{service:'PeerManageRpc' as const,index:9},
    {service:'CredentialManageRpc' as const,index:0},{service:'CredentialManageRpc' as const,index:5},
  ]) await assert.rejects(wire.call(method,Buffer.alloc(0)),/invalid-rpc-method/);
  assert.equal(dials,0);
});

test('varint uint64 overflow, truncated and unknown protobuf fields fail closed', () => {
  assert.throws(()=>pbVarint(BigInt('18446744073709551616')),/rpc-invalid-integer/);
  assert.throws(()=>pbDecode(Buffer.from([8,128]),{1:0}),/rpc-truncated/);
  assert.throws(()=>pbDecode(pbNumber(9,1),{1:0}),/rpc-schema-mismatch/);
  assert.throws(()=>pbDecode(Buffer.concat([pbNumber(1,1),pbNumber(1,2)]),{1:0}),/rpc-schema-mismatch/);
});

// Synthetic channel only: this verifies redaction, not native interoperability.
test('synthetic upstream error exposes only allowlisted variant, never error text', async () => {
  const sentinel = 'SYNTHETIC-PRIVATE-CONFIG-MUST-NOT-ESCAPE';
  let onData: (bytes:Buffer)=>void = ()=>assert.fail('listener missing');
  let closed = false;
  const channel: RpcByteChannel = {
    onData:listener=>{onData=listener;},onError:()=>{},onClose:()=>{},close:()=>{closed=true;},
    write:request=>{
      const fields = pbDecode(request.subarray(20),{1:0,2:0,3:0,4:2,5:2,6:0,7:0,10:2});
      const error = pbBytes(3,pbBytes(1,Buffer.from(sentinel)));
      const body = pbBytes(2,error);
      const packet = Buffer.concat([pbNumber(1,1),pbNumber(2,1),pbNumber(3,pbGetNumber(fields,3)),
        pbBytes(4,pbGetBytes(fields,4)),pbBytes(5,body),pbNumber(7,1)]);
      const header = Buffer.alloc(20);
      header.writeUInt32LE(packet.length+16,0);header.writeUInt32LE(1,4);header.writeUInt32LE(1,8);
      header[12]=9;header[14]=1;header.writeUInt32LE(packet.length,16);
      onData(Buffer.concat([header,packet]));
    },
  };
  const wire = new CommunityTcpRpcTransport(ENDPOINT,async()=>channel);
  await assert.rejects(wire.call(NODE,pbBytes(1,pbInstance(INSTANCE))),error=>{
    assert.ok(error instanceof Error);
    assert.equal(error.message,'rpc-native-error');
    assert.equal((error as Error & {nativeErrorKind:string}).nativeErrorKind,'invalid-service');
    assert.equal(JSON.stringify(error).includes(sentinel),false);
    assert.equal(String(error).includes(sentinel),false);
    return true;
  });
  assert.equal(closed,true);
});

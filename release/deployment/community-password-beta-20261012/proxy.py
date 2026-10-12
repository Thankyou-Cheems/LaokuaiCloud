"""Approved member-device AF_UNIX -> existing loopback15890. Never log wire bytes.
One request per connection; fixed UUID/services; independent short-TTL credentials with continuous same-key renewals.
NodeInfo configuration is removed before anything leaves the host management port.
"""
import base64, hashlib, json, os, pathlib, socket, stat, struct, threading, time, uuid

SOCKET = '/run/laokuai-community-et/public-management.sock'
LEDGER = pathlib.Path('/run/laokuai-community-et/member-ledger.json')
INSTANCE = 'e2a5bd9d-47bb-4120-8589-e6898112ae85'
UID = 1001
MAX_BODY = 262144
LOCK = threading.Lock()
SLOTS = threading.BoundedSemaphore(8)

def varint(n):
    out = bytearray()
    while n > 127: out.append((n & 127) | 128); n >>= 7
    out.append(n); return bytes(out)

def field(n, value):
    if isinstance(value, int): return varint(n << 3) + varint(value)
    return varint((n << 3) | 2) + varint(len(value)) + value

def decode(data, schema, repeated=()):
    if len(data) > MAX_BODY: raise ValueError('bound')
    i = 0; out = {}
    def number():
        nonlocal i
        value = 0
        for shift in range(0, 64, 7):
            if i >= len(data): raise ValueError('truncated')
            b = data[i]; i += 1
            if shift == 63 and b > 1: raise ValueError('varint')
            value |= (b & 127) << shift
            if not b & 128: return value
        raise ValueError('varint')
    while i < len(data):
        tag = number(); n, wire = tag >> 3, tag & 7
        if schema.get(n) != wire or (n in out and n not in repeated): raise ValueError('schema')
        if wire == 0: value = number()
        else:
            count = number() if wire == 2 else 4 if wire == 5 else 8 if wire == 1 else -1
            if count < 0 or i + count > len(data): raise ValueError('truncated')
            value = data[i:i+count]; i += count
        out.setdefault(n, []).append(value)
        if len(out[n]) > 4096: raise ValueError('bound')
    return out

def value(fields, n, default=b''): return fields.get(n, [default])[0]
def num(fields, n): return value(fields, n, 0)
def text(fields, n): return value(fields, n).decode('utf8', errors='strict')

PACKET_SCHEMA = {1:0,2:0,3:0,4:2,5:2,6:0,7:0,8:0,9:0,10:2}
def packet(frame, kind):
    if len(frame) < 20 or len(frame) > 2004: raise ValueError('frame')
    length = struct.unpack_from('<I', frame)[0]
    if length < 16 or length > 2000 or length + 4 != len(frame): raise ValueError('frame')
    if struct.unpack_from('<II', frame, 4) != (1,1) or frame[12] != kind or frame[13] != 0 or struct.unpack_from('<I', frame, 16)[0] != length - 16: raise ValueError('frame')
    return decode(frame[20:], PACKET_SCHEMA)

def wrap(fields, body):
    replacements = {5:body,7:1,8:0}
    raw = b''.join(field(n, replacements.get(n, vals[0])) for n, vals in fields.items())
    if 7 not in fields: raw += field(7,1)
    if 8 not in fields: raw += field(8,0)
    header = bytearray(20); struct.pack_into('<III',header,0,len(raw)+16,1,1)
    header[12] = 9; struct.pack_into('<I',header,16,len(raw))
    return bytes(header)+raw

def selection(data):
    inner = decode(value(decode(data,{1:2}),1),{1:0,2:0,3:0,4:0})
    raw = b''.join(struct.pack('>I',num(inner,n)) for n in range(1,5))
    if str(uuid.UUID(bytes=raw)) != INSTANCE: raise ValueError('instance')

def request(frame):
    f = packet(frame,8)
    if any(num(f,n) != v for n,v in [(1,1),(2,1),(6,1),(7,1),(8,0)]) or num(f,3) < 1: raise ValueError('request')
    compression = decode(value(f,10),{1:0,2:0})
    if num(compression,1) != 1: raise ValueError('compression')
    d = decode(value(f,4),{1:2,2:2,3:2,4:0}); service, method = text(d,2), num(d,4)
    if text(d,1) or text(d,3) != service or (service,method) not in {('CredentialManageRpc',1),('CredentialManageRpc',2),('CredentialManageRpc',3),('CredentialManageRpc',4),('PeerManageRpc',1),('PeerManageRpc',3),('PeerManageRpc',7)}: raise ValueError('method')
    b = decode(value(f,5),{2:2,3:0})
    if not 1 <= num(b,3) <= 1000: raise ValueError('deadline')
    raw = value(b,2)
    if service == 'PeerManageRpc' or method == 3:
        q = decode(raw,{1:2}); selector = value(q,1)
    elif method == 1:
        q = decode(raw,{1:2,2:0,3:2,4:0,5:2,6:2,7:0},(1,3)); selector=value(q,6)
        if num(q,2) or num(q,7) or q.get(3) or num(q,4) != 300: raise ValueError('unsafe-create')
    elif method == 4:
        q = decode(raw,{1:2,2:2,3:2,4:0,5:2,6:0,7:0,8:2},(3,5)); selector=value(q,8)
        if num(q,4) or num(q,7) or q.get(5): raise ValueError('unsafe-renew')
        if len(base64.b64decode(value(q,2),validate=True)) != 32: raise ValueError('key')
    else:
        q = decode(raw,{1:2,2:2}); selector=value(q,2)
    selection(selector)
    return service, method, q, f

def sanitize(response, method):
    r = decode(response,{1:2,2:2,3:0})
    if 2 in r:
        error = decode(value(r,2),{n:2 for n in range(1,9)})
        kind = next(iter(error)) if len(error) == 1 else 1
        return field(2,field(kind,b''))
    if method == ('PeerManageRpc',7):
        wrapper=decode(value(r,1),{1:2}); node=decode(value(wrapper,1),{1:0,2:2,3:2,4:2,5:2,6:2,7:2,8:2,9:2,10:2,11:2,12:2,13:2},(3,7))
        # Only non-secret identity/version required by the frozen provider.
        clean=b''.join(field(n,value(node,n,0 if n==1 else b'')) for n in (1,6,9))
        return field(1,field(1,clean))
    return response

class Budget:
    """Nonsecret key digests/expiry only; backend remains membership authority."""
    def __init__(self, file=LEDGER, clock=time.time): self.file=file; self.clock=clock
    def load(self):
        try:
            info=self.file.lstat()
            if not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode) or info.st_size > 1048576: raise ValueError('ledger')
            data=json.loads(self.file.read_text())
            if not isinstance(data,dict): raise ValueError('ledger')
            return data
        except FileNotFoundError: return {}
    def save(self, state):
        target=self.file.with_name(self.file.name+'.'+uuid.uuid4().hex+'.next')
        fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL|getattr(os,'O_NOFOLLOW',0),0o600)
        with os.fdopen(fd,'w') as out: json.dump(state,out); out.flush(); os.fsync(out.fileno())
        os.replace(target,self.file)
    def before(self, service, method, q):
        if service!='CredentialManageRpc' or method==3: return
        now=int(self.clock()); credential=text(q,5 if method==1 else 1)
        if str(uuid.UUID(credential))!=credential: raise ValueError('credential')
        if method==2: return # retirement/readback works across expired/restarted ledgers
        groups=[g.decode('utf8',errors='strict') for g in q.get(1 if method==1 else 3,[])]
        if groups!=['laokuai-member']: raise ValueError('group')
        state={k:v for k,v in self.load().items() if v.get('expiresUnix',0)>now}
        if method==1:
            if credential in state: raise ValueError('duplicate-create')
            state[credential]={'expiresUnix':now+305,'pending':True};self.save(state)
        elif method==4:
            old=state.get(credential)
            expiry=num(q,6)
            if not old or old.get('pending') or not now<expiry<=now+305 or expiry<old['expiresUnix'] or hashlib.sha256(value(q,2)).hexdigest()!=old.get('secretDigest'): raise ValueError('unsafe-renew')
    def after(self, service, method, response):
        if service!='CredentialManageRpc' or method not in (1,): return
        r=decode(response,{1:2,2:2,3:0})
        if 2 in r: return
        result=decode(value(r,1),{1:2,2:2,3:0});state=self.load();now=int(self.clock());credential=text(result,1)
        if credential not in state or not now<num(result,3)<=now+305 or len(base64.b64decode(value(result,2),validate=True))!=32: raise ValueError('create-readback')
        state[credential]={'secretDigest':hashlib.sha256(value(result,2)).hexdigest(),'expiresUnix':num(result,3)};self.save(state)
    def complete(self,service,method,q,response):
        if service!='CredentialManageRpc' or method not in (2,4):return
        r=decode(response,{1:2,2:2,3:0})
        if 2 in r:return
        outcome=decode(value(r,1),{1:0})
        if not num(outcome,1):return
        state=self.load();credential=text(q,1)
        if method==2:state.pop(credential,None)
        elif credential in state:state[credential]['expiresUnix']=num(q,6)
        self.save(state)

def exact_read(s, size):
    data=bytearray()
    while len(data)<size:
        chunk=s.recv(size-len(data))
        if not chunk: raise ValueError('closed')
        data.extend(chunk)
    return bytes(data)

def read_frame(s):
    head=exact_read(s,4); length=struct.unpack('<I',head)[0]
    if not 16<=length<=2000: raise ValueError('frame')
    return head+exact_read(s,length)

def handle(client, budget):
    try:
        client.settimeout(1)
        _,uid,_=struct.unpack('3i',client.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12))
        if uid!=UID: raise ValueError('peer')
        frame=read_frame(client); service,method,q,sent=request(frame)
        with LOCK:
            budget.before(service,method,q)
            with socket.create_connection(('127.0.0.1',15890),timeout=1) as upstream:
                upstream.settimeout(1); upstream.sendall(frame); pieces={}; total=0; size=0; first=None
                while True:
                    r=packet(read_frame(upstream),9)
                    if any(num(r,n)!=num(sent,n) for n in (1,2,3)) or num(r,6): raise ValueError('reply')
                    if value(r,4)!=value(sent,4): raise ValueError('reply-method')
                    compression=decode(value(r,10),{1:0,2:0})
                    if 10 in r and num(compression,1)!=1: raise ValueError('compression')
                    count=num(r,7) or 1; index=num(r,8); data=value(r,5)
                    if count>256 or index>=count or index in pieces or total not in (0,count): raise ValueError('pieces')
                    total=count; pieces[index]=data; size+=len(data)
                    if size>MAX_BODY: raise ValueError('bound')
                    if first is None: first=r
                    if len(pieces)==total: break
                response=b''.join(pieces[i] for i in range(total)); budget.after(service,method,response); budget.complete(service,method,q,response)
                clean=sanitize(response,(service,method))
                # Node reply is tiny after projection. Other replies preserve their
                # existing pieces; their only sensitive content is the one approved
                # member secret returned to the backend, never logs/files here.
                if (service,method)==('PeerManageRpc',7) or decode(response,{1:2,2:2,3:0}).get(2): client.sendall(wrap(first,clean))
                else:
                    for i in range(total):
                        current=dict(first); current[7]=[total]; current[8]=[i]
                        raw=b''.join(field(n,pieces[i] if n==5 else vals[0]) for n,vals in current.items())
                        header=bytearray(20); struct.pack_into('<III',header,0,len(raw)+16,1,1);header[12]=9;struct.pack_into('<I',header,16,len(raw));client.sendall(bytes(header)+raw)
    except Exception:
        # Close is a stable rpc-outcome-unknown. No data/error interpolation.
        pass
    finally: client.close(); SLOTS.release()

def serve():
    if os.getuid()!=UID: raise RuntimeError('wrong-service-uid')
    directory=pathlib.Path(SOCKET).parent; info=directory.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid!=UID or stat.S_IMODE(info.st_mode)!=0o700: raise RuntimeError('unsafe-runtime-directory')
    if os.path.lexists(SOCKET): raise RuntimeError('existing-socket')
    os.umask(0o077)
    with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as listener:
        listener.bind(SOCKET);os.chmod(SOCKET,0o600);listener.listen(8);budget=Budget()
        while True:
            client,_=listener.accept()
            if not SLOTS.acquire(blocking=False): client.close();continue
            threading.Thread(target=handle,args=(client,budget),daemon=True).start()

if __name__=='__main__': serve()

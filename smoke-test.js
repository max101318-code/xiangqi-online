const WebSocket = require('ws');
const base = 'ws://127.0.0.1:3000';
const a = new WebSocket(base);
const b = new WebSocket(base);
let room = null;
let joined = false;
let moved = false;
let done = false;
let messages = [];
function send(ws, payload) { ws.send(JSON.stringify(payload)); }
function finish(code) { if (done) return; done = true; console.log(JSON.stringify(messages.map(x => x.type))); process.exit(code); }
function handle(ws, raw) {
  const msg = JSON.parse(raw.toString());
  messages.push(msg);
  if (msg.type === 'error') console.error(`server_error=${msg.message}`);
  if (msg.type === 'room') {
    room = msg.roomId;
    if (b.readyState === WebSocket.OPEN) send(b, { action: 'join', roomId: room, name: '測試黑方' });
  }
  if (msg.type === 'state' && msg.players?.length === 2) joined = true;
  if (joined && !moved && msg.type === 'state' && msg.turn === msg.color) {
    moved = true;
    send(ws, { action: 'move', r1: 3, c1: 0, r2: 4, c2: 0 });
  }
  if (moved && msg.type === 'state' && msg.history.length === 1) {
    console.log(`room=${msg.roomId} turn=${msg.turn} history=${msg.history.length}`);
    finish(0);
  }
}
a.on('open', () => send(a, { action: 'create', name: '測試紅方' }));
b.on('open', () => { if (room) send(b, { action: 'join', roomId: room, name: '測試黑方' }); });
a.on('message', raw => handle(a, raw));
b.on('message', raw => handle(b, raw));
setTimeout(() => { console.error('timeout'); finish(1); }, 5000);

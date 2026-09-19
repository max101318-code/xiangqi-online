const WebSocket = require('ws');
const ws = new WebSocket('ws://127.0.0.1:3000');
let seen = [];
ws.on('open', () => ws.send(JSON.stringify({action:'ai', name:'測試玩家'})));
ws.on('message', raw => {
  const m = JSON.parse(raw.toString());
  seen.push(m);
  if (m.type === 'state' && m.turn === 'red' && m.history.length === 0) {
    ws.send(JSON.stringify({action:'move', r1:3, c1:0, r2:4, c2:0}));
  }
  if (m.type === 'state' && m.history.length >= 2) {
    console.log(`mode=${m.mode} players=${m.players.length} history=${m.history.length} turn=${m.turn}`);
    process.exit(m.mode === 'ai' && m.history.length === 2 ? 0 : 1);
  }
});
setTimeout(() => { console.error('timeout', seen.map(m=>m.type)); process.exit(1); }, 4000);

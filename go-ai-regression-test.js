const fs=require('fs'), vm=require('vm');
let code=fs.readFileSync(__dirname+'/server.js','utf8');
code=code.replace("const http = require('http');","const http = { createServer(){ return { listen(){ } }; } };");
code=code.replace("const { WebSocketServer } = require('ws');","const WebSocketServer = class { on(){} };");
const wsStart=code.indexOf('const wss=new WebSocketServer({server});');
if(wsStart>=0) code=code.slice(0,wsStart);
code += '\nglobalThis.API={newGame,applyGoMove,passGo,scoreGo,aiTurn,aiGomokuMove,aiGoMove,applyOnlineMove,toggleGoDead,confirmGoScore,groupAndLiberties,serializeGo};\n';
const ctx={console,require,process:{env:{}},crypto:require('crypto'),Math,Date,JSON,setTimeout,clearTimeout,setInterval:()=>0,Buffer};
ctx.__dirname=__dirname;ctx.path=require('path');ctx.fs=require('fs');ctx.http={};
vm.createContext(ctx);vm.runInContext(code,ctx,{timeout:10000});
const A=ctx.API; ctx.broadcast=()=>{};
function assert(v,m){if(!v)throw new Error(m)}
for(const mode of ['xiangqi','gomoku','go']){const g=A.newGame(mode);g.turn=mode==='xiangqi'?'black':'white';const x={mode,ai:true,players:[{pid:'human',color:mode==='xiangqi'?'red':'black'}],g,difficulty:'normal',undoStack:[]};A.aiTurn(x);assert(g.history.length>=1,`AI did not move: ${mode}`);}
let g=A.newGame('go');assert(g.size===19&&g.board.length===19,'Go board is not 19x19');assert(g.positions.length===1,'Initial superko history missing');
// Suicide test on corner.
g=A.newGame('go');g.turn='white';g.board[0][1]='black';g.board[1][0]='black';g.positions=[A.serializeGo(g.board)];let x={mode:'go',ai:false,g,players:[],undoStack:[]};let r=A.applyGoMove(x,{pid:'w',color:'white'},0,0);assert(r.error&&r.error.includes('自殺'),'Suicide was not rejected');
// Capture test.
g=A.newGame('go');g.turn='black';g.board[0][1]='white';g.board[0][0]='black';g.board[0][2]='black';g.positions=[A.serializeGo(g.board)];x={mode:'go',ai:false,g,players:[],undoStack:[]};r=A.applyGoMove(x,{pid:'b',color:'black'},1,1); assert(r.ok&&g.board[0][1]===null&&g.captures.black===1,'Capture failed');
// Superko: inject current next position into history before trying it.
g=A.newGame('go');g.turn='black';g.positions=[A.serializeGo(g.board)];x={mode:'go',ai:false,g,players:[],undoStack:[]};const sim=A.applyGoMove(x,{pid:'b',color:'black'},3,3);assert(sim.ok,'Basic Go move failed');const repeatedSig=A.serializeGo(g.board);g.turn='black';g.positions.push(repeatedSig);r=A.applyGoMove(x,{pid:'b',color:'black'},3,3);assert(r.error,'Occupied point should be rejected');
// Two passes -> scoring, then AI/online confirmation path.
g=A.newGame('go');g.turn='black';x={mode:'go',ai:false,g,players:[{pid:'b',color:'black'},{pid:'w',color:'white'}],undoStack:[]};assert(A.passGo(x,{pid:'b',color:'black'}).ok,'Pass 1 failed');assert(A.passGo(x,{pid:'w',color:'white'}).ok,'Pass 2 failed');assert(g.phase==='scoring'&&g.winner===null,'Two passes did not enter scoring');assert(A.confirmGoScore(x,{pid:'b',color:'black'}).ok);assert(g.winner===null,'One confirmation should not end online scoring');assert(A.confirmGoScore(x,{pid:'w',color:'white'}).ok);assert(g.winner,'Two confirmations should finalize');
console.log('v2.9 regression: OK');


const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const TURN_SECONDS = 30;
const GO_SIZE = 19;
const GOMOKU_SIZE = 15;
const rooms = new Map();
const matchmakingQueue = [];
const pub = path.join(__dirname, 'public');

const GAME_NAMES = {
  xiangqi: '中國象棋',
  gomoku: '五子棋',
  go: '圍棋'
};
const TYPES = { K:'帥', A:'仕', B:'相', N:'傌', R:'俥', C:'炮', P:'兵', k:'將', a:'士', b:'象', n:'馬', r:'車', c:'炮', p:'卒' };
const START = [
  ['R',0,0],['N',0,1],['B',0,2],['A',0,3],['K',0,4],['A',0,5],['B',0,6],['N',0,7],['R',0,8],
  ['C',2,1],['C',2,7],['P',3,0],['P',3,2],['P',3,4],['P',3,6],['P',3,8],
  ['r',9,0],['n',9,1],['b',9,2],['a',9,3],['k',9,4],['a',9,5],['b',9,6],['n',9,7],['r',9,8],
  ['c',7,1],['c',7,7],['p',6,0],['p',6,2],['p',6,4],['p',6,6],['p',6,8]
];
const BEATS = {剪刀:'布',布:'石頭',石頭:'剪刀'};
const AVATARS = ['🧑🏻','🧑🏼','🧑🏽','🧑🏾','🧑🏿','🐱','🐼','🦊','🐯','🐸','🤖','👾','🦄','🐲','😎','🥷'];

function normalizeMode(v){ return ['xiangqi','gomoku','go'].includes(v) ? v : 'xiangqi'; }
function normalizeDifficulty(v){ return ['easy','normal','hard'].includes(v) ? v : 'normal'; }
function normalizeAvatar(value){
  const v=String(value||'');
  if(AVATARS.includes(v)) return v;
  if(/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(v) && v.length<=350000) return v;
  return '🧑🏻';
}
const clone = v => JSON.parse(JSON.stringify(v));
const rid = () => crypto.randomBytes(3).toString('hex').toUpperCase();
const pid = () => crypto.randomBytes(5).toString('hex');
const eventId = () => `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

function baseGame(mode){
  if(mode==='gomoku'){
    return {mode,size:GOMOKU_SIZE,board:Array.from({length:GOMOKU_SIZE},()=>Array(GOMOKU_SIZE).fill(null)),turn:null,winner:null,winnerPid:null,endedReason:null,history:[],move:1,turnDeadline:null,roundKey:eventId()};
  }
  if(mode==='go'){
    const board=Array.from({length:GO_SIZE},()=>Array(GO_SIZE).fill(null));
    return {mode,size:GO_SIZE,board,turn:null,winner:null,winnerPid:null,endedReason:null,history:[],move:1,turnDeadline:null,roundKey:eventId(),captures:{black:0,white:0},passStreak:0,koPoint:null,phase:'play',positions:[serializeGo(board)],deadGroups:[],scoreConfirm:{}};
  }
  const b=Array.from({length:10},()=>Array(9).fill(null));
  for(const [t,r,c] of START)b[r][c]={t,id:crypto.randomBytes(4).toString('hex')};
  return {mode:'xiangqi',size:9,rows:10,b:b,turn:null,winner:null,winnerPid:null,endedReason:null,history:[],move:1,turnDeadline:null,roundKey:eventId()};
}
function newGame(mode){ return baseGame(normalizeMode(mode)); }
function newRps(){ return {phase:'rps',choices:{},result:null,winnerPid:null}; }

function own(t,color){ return color==='red' ? /[A-Z]/.test(t) : /[a-z]/.test(t); }
function insideXQ(r,c){ return r>=0&&r<10&&c>=0&&c<9; }
function palace(r,c,color){ return c>=3&&c<=5&&(color==='red'?r<=2:r>=7); }
function clearCount(b,r1,c1,r2,c2){
  const dr=Math.sign(r2-r1),dc=Math.sign(c2-c1);let n=0,r=r1+dr,c=c1+dc;
  while(r!==r2||c!==c2){if(b[r][c])n++;r+=dr;c+=dc;}
  return n;
}
function legalXQ(g,p,r1,c1,r2,c2){
  if(!insideXQ(r1,c1)||!insideXQ(r2,c2))return'座標超出棋盤';
  const a=g.b[r1][c1],d=g.b[r2][c2];
  if(!a)return'起點沒有棋子';
  if(!own(a.t,p.color))return'只能移動自己的棋子';
  if(d&&own(d.t,p.color))return'目標已有己方棋子';
  const t=a.t.toLowerCase(),R=r2-r1,C=c2-c1,ar=Math.abs(R),ac=Math.abs(C);
  if(t==='k'){
    const facingCapture=d&&d.t.toLowerCase()==='k'&&C===0&&clearCount(g.b,r1,c1,r2,c2)===0;
    if(!facingCapture&&!(ar+ac===1&&palace(r2,c2,p.color)))return'將／帥只能在己方九宮內直走一格；面對對方將／帥且中間無子時，可像車一樣直接吃將／帥';
  }else if(t==='a'){
    if(!(ar===1&&ac===1&&palace(r2,c2,p.color)))return'士／仕只能在己方九宮內斜走一格';
  }else if(t==='b'){
    if(!(ar===2&&ac===2))return'象／相必須斜走兩格';
    if((p.color==='red'&&r2>4)||(p.color==='black'&&r2<5))return'象／相不能過河';
    if(g.b[r1+R/2][c1+C/2])return'象眼被堵';
  }else if(t==='n'){
    if(!((ar===2&&ac===1)||(ar===1&&ac===2)))return'馬／傌必須走日字';
    const lr=r1+(ar===2?Math.sign(R):0),lc=c1+(ac===2?Math.sign(C):0);
    if(g.b[lr][lc])return'馬腿被堵';
  }else if(t==='r'){
    if(!(R===0||C===0)||clearCount(g.b,r1,c1,r2,c2)!==0)return'車／俥只能直線走且不能越子';
  }else if(t==='c'){
    if(!(R===0||C===0))return'炮必須直線移動';
    const n=clearCount(g.b,r1,c1,r2,c2);
    if(d&&n!==1)return'炮吃子時中間必須恰好一枚炮架';
    if(!d&&n!==0)return'炮移動到空位時不能隔子';
  }else if(t==='p'){
    const f=p.color==='red'?1:-1,crossed=p.color==='red'?r1>=5:r1<=4;
    if(!(R===f&&C===0)&&!(crossed&&R===0&&ac===1))return'兵／卒只能向前；過河後才能左右走一格，不能後退';
  }
  return null;
}
function findKing(g,color){
  const kt=color==='red'?'K':'k';
  for(let r=0;r<10;r++)for(let c=0;c<9;c++)if(g.b[r][c]?.t===kt)return[r,c];
  return null;
}
function attacksSquare(g,color,fr,fc,tr,tc){
  const a=g.b[fr]?.[fc];if(!a||!own(a.t,color)||!insideXQ(tr,tc))return false;
  if(fr===tr&&fc===tc)return false;
  const d=g.b[tr][tc],t=a.t.toLowerCase(),R=tr-fr,C=tc-fc,ar=Math.abs(R),ac=Math.abs(C);
  if(t==='k')return C===0&&clearCount(g.b,fr,fc,tr,tc)===0;
  if(t==='a')return ar===1&&ac===1&&palace(tr,tc,color);
  if(t==='b'){if(!(ar===2&&ac===2))return false;if((color==='red'&&tr>4)||(color==='black'&&tr<5))return false;return !g.b[fr+R/2][fc+C/2];}
  if(t==='n'){if(!((ar===2&&ac===1)||(ar===1&&ac===2)))return false;const lr=fr+(ar===2?Math.sign(R):0),lc=fc+(ac===2?Math.sign(C):0);return !g.b[lr][lc];}
  if(t==='r')return(R===0||C===0)&&clearCount(g.b,fr,fc,tr,tc)===0;
  if(t==='c')return(R===0||C===0)&&d&&clearCount(g.b,fr,fc,tr,tc)===1;
  if(t==='p'){const f=color==='red'?1:-1,crossed=color==='red'?fr>=5:fr<=4;return(R===f&&C===0)||(crossed&&R===0&&ac===1);}
  return false;
}
function isAttacked(g,color,r,c){
  for(let fr=0;fr<10;fr++)for(let fc=0;fc<9;fc++)if(attacksSquare(g,color,fr,fc,r,c))return true;
  return false;
}
function checkTarget(g,byColor){
  const target=byColor==='red'?'black':'red';const k=findKing(g,target);
  return k&&isAttacked(g,byColor,k[0],k[1])?target:null;
}
function hasLegalXQ(g,color){
  const p={color};
  for(let r=0;r<10;r++)for(let c=0;c<9;c++)if(g.b[r][c]&&own(g.b[r][c].t,color))
    for(let rr=0;rr<10;rr++)for(let cc=0;cc<9;cc++)if(!legalXQ(g,p,r,c,rr,cc))return true;
  return false;
}
function applyXQ(x,p,m){
  const g=x.g;if(!g.turn)return{error:'等待對局開始'};if(g.winner)return{error:'遊戲已結束'};if(g.turn!==p.color)return{error:'還沒輪到你'};
  if(g.turnDeadline&&Date.now()>g.turnDeadline){timeOut(x);return{error:'回合時間已到'};}
  const r1=+m.r1,c1=+m.c1,r2=+m.r2,c2=+m.c2,err=legalXQ(g,p,r1,c1,r2,c2);if(err)return{error:err};
  const before=clone(g),src=g.b[r1][c1],dst=g.b[r2][c2];g.b[r2][c2]=src;g.b[r1][c1]=null;
  g.history.push({n:g.move,color:p.color,piece:TYPES[src.t],from:[r1+1,c1+1],to:[r2+1,c2+1],captured:dst?TYPES[dst.t]:null});x.undoStack.push(before);g.move++;
  g.turn=null;x.checkEvent=null;
  if(dst&&dst.t.toLowerCase()==='k'){g.winner=p.color;g.winnerPid=p.pid;g.endedReason=`${p.color==='red'?'紅方':'黑方'}直接吃掉${p.color==='red'?'黑將':'紅帥'}，獲勝！`;g.turnDeadline=null;}
  else{const target=checkTarget(g,p.color);x.checkEvent=target?{id:eventId(),by:p.color,target}:null;g.turn=p.color==='red'?'black':'red';setTurnDeadline(x);if(!hasLegalXQ(g,g.turn)){g.winner=p.color;g.winnerPid=p.pid;g.endedReason=`${g.turn==='red'?'紅方':'黑方'}困斃，${p.color==='red'?'紅方':'黑方'}獲勝！`;g.turnDeadline=null;}}
  return{ok:true};
}

function gomokuWinner(b,r,c,color){
  const dirs=[[1,0],[0,1],[1,1],[1,-1]];
  for(const [dr,dc] of dirs){let n=1;for(const s of [1,-1]){let rr=r+dr*s,cc=c+dc*s;while(rr>=0&&rr<GOMOKU_SIZE&&cc>=0&&cc<GOMOKU_SIZE&&b[rr][cc]===color){n++;rr+=dr*s;cc+=dc*s;}}if(n>=5)return true;}
  return false;
}
function applyGomoku(x,p,m){
  const g=x.g;if(g.winner)return{error:'遊戲已結束'};if(g.turn!==p.color)return{error:'還沒輪到你'};
  if(g.turnDeadline&&Date.now()>g.turnDeadline){timeOut(x);return{error:'回合時間已到'};}
  const r=+m.r,c=+m.c;if(r<0||r>=GOMOKU_SIZE||c<0||c>=GOMOKU_SIZE)return{error:'位置超出棋盤'};if(g.board[r][c])return{error:'這裡已有棋子'};
  const before={board:clone(g.board),history:clone(g.history),turn:g.turn,move:g.move};
  g.board[r][c]=p.color;g.history.push({n:g.move,color:p.color,move:[r+1,c+1]});x.undoStack.push(before);g.move++;
  if(gomokuWinner(g.board,r,c,p.color)){g.winner=p.color;g.winnerPid=p.pid;g.endedReason=`${p.color==='black'?'黑方':'白方'}五連，獲勝！`;g.turnDeadline=null;}
  else if(g.board.every(row=>row.every(v=>v))){g.winner='draw';g.endedReason='棋盤已滿，和棋。';g.turnDeadline=null;}
  else{g.turn=p.color==='black'?'white':'black';setTurnDeadline(x);}
  return{ok:true};
}

function goNeighbors(r,c){
  const out=[];
  for(const [dr,dc] of [[1,0],[-1,0],[0,1],[0,-1]]){const nr=r+dr,nc=c+dc;if(nr>=0&&nr<GO_SIZE&&nc>=0&&nc<GO_SIZE)out.push([nr,nc]);}
  return out;
}
function groupAndLiberties(board,r,c){
  const color=board[r]?.[c];if(!color)return{stones:[],liberties:new Set()};
  const stones=[],seen=new Set(),liberties=new Set(),q=[[r,c]];
  while(q.length){const [rr,cc]=q.pop(),key=`${rr},${cc}`;if(seen.has(key))continue;seen.add(key);stones.push([rr,cc]);
    for(const [nr,nc] of goNeighbors(rr,cc)){const v=board[nr][nc];if(v===null)liberties.add(`${nr},${nc}`);else if(v===color)q.push([nr,nc]);}
  }
  return{stones,liberties};
}
function serializeGo(board){return board.map(row=>row.map(v=>v||'.').join('')).join('/');}
function cloneGoState(g){return {board:clone(g.board),history:clone(g.history),turn:g.turn,move:g.move,captures:clone(g.captures),passStreak:g.passStreak,koPoint:g.koPoint,phase:g.phase,positions:clone(g.positions),deadGroups:clone(g.deadGroups),scoreConfirm:clone(g.scoreConfirm)};}
function restoreGoState(g,snap){g.board=clone(snap.board);g.history=clone(snap.history);g.turn=snap.turn;g.move=snap.move;g.captures=clone(snap.captures);g.passStreak=snap.passStreak;g.koPoint=snap.koPoint;g.phase=snap.phase||'play';g.positions=clone(snap.positions||[serializeGo(g.board)]);g.deadGroups=clone(snap.deadGroups||[]);g.scoreConfirm=clone(snap.scoreConfirm||{});g.winner=null;g.winnerPid=null;g.endedReason=null;}
function oppositeGo(c){return c==='black'?'white':'black';}
function simulateGoPlacement(g,color,r,c){
  if(r<0||r>=GO_SIZE||c<0||c>=GO_SIZE)return{error:'位置超出棋盤'};
  if(g.board[r][c])return{error:'這裡已有棋子'};
  const b=clone(g.board);b[r][c]=color;let captured=0,capturedStones=[];
  const checked=new Set();
  for(const [nr,nc] of goNeighbors(r,c)){
    if(b[nr][nc]!==oppositeGo(color))continue;
    const k=`${nr},${nc}`;if(checked.has(k))continue;
    const gr=groupAndLiberties(b,nr,nc);for(const st of gr.stones)checked.add(`${st[0]},${st[1]}`);
    if(gr.liberties.size===0){captured+=gr.stones.length;capturedStones.push(...gr.stones);for(const [sr,sc] of gr.stones)b[sr][sc]=null;}
  }
  const ownGroup=groupAndLiberties(b,r,c);
  if(ownGroup.liberties.size===0&&captured===0)return{error:'自殺禁著點：落子後自己的棋組沒有氣，且沒有提子'};
  const sig=serializeGo(b);
  if((g.positions||[]).includes(sig))return{error:'全盤同形禁重複（Superko）：這一步會重複歷史盤面'};
  return{board:b,captured,capturedStones,sig};
}
function applyGoMove(x,p,r,c){
  const g=x.g;if(g.phase!=='play')return{error:'目前正在終局結算'};if(g.winner)return{error:'遊戲已結束'};if(g.turn!==p.color)return{error:'還沒輪到你'};
  if(g.turnDeadline&&Date.now()>g.turnDeadline){timeOut(x);return{error:'回合時間已到'};}
  const result=simulateGoPlacement(g,p.color,r,c);if(result.error)return{error:result.error};
  x.undoStack.push({mode:'go',state:cloneGoState(g)});
  g.board=result.board;g.captures[p.color]+=result.captured;g.passStreak=0;g.koPoint=null;g.positions.push(result.sig);
  g.history.push({n:g.move,color:p.color,move:[r+1,c+1],captured:result.captured});g.move++;
  g.turn=oppositeGo(p.color);setTurnDeadline(x);return{ok:true};
}
function passGo(x,p){
  const g=x.g;if(g.phase!=='play')return{error:'目前正在終局結算'};if(g.winner)return{error:'遊戲已結束'};if(g.turn!==p.color)return{error:'還沒輪到你'};
  x.undoStack.push({mode:'go',state:cloneGoState(g)});
  g.history.push({n:g.move,color:p.color,pass:true});g.move++;g.passStreak++;
  if(g.passStreak>=2){g.phase='scoring';g.turn=null;g.turnDeadline=null;g.scoreConfirm={};g.deadGroups=[];}
  else{g.turn=oppositeGo(p.color);setTurnDeadline(x);}
  return{ok:true};
}
function deadGroupKey(stones){return stones.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]).map(s=>`${s[0]},${s[1]}`).join(';');}
function toggleGoDead(x,p,r,c){
  const g=x.g;if(g.phase!=='scoring')return{error:'目前不是圍棋終局結算階段'};if(r<0||r>=GO_SIZE||c<0||c>=GO_SIZE)return{error:'位置超出棋盤'};if(!g.board[r][c])return{error:'這裡沒有棋子'};
  const gr=groupAndLiberties(g.board,r,c),key=deadGroupKey(gr.stones),idx=g.deadGroups.findIndex(k=>k===key);
  if(idx>=0)g.deadGroups.splice(idx,1);else g.deadGroups.push(key);
  g.scoreConfirm={};return{ok:true};
}
function boardForGoScore(g){
  const b=clone(g.board),dead=[];
  for(const key of g.deadGroups||[]){for(const item of key.split(';')){const [r,c]=item.split(',').map(Number);if(b[r]?.[c]){dead.push([r,c,b[r][c]]);b[r][c]=null;}}}
  return{board:b,dead};
}
function scoreGo(g){
  const {board,dead}=boardForGoScore(g);let black=0,white=0,seen=new Set();
  for(let r=0;r<GO_SIZE;r++)for(let c=0;c<GO_SIZE;c++){
    if(board[r][c]==='black'){black++;continue} if(board[r][c]==='white'){white++;continue}
    const key=`${r},${c}`;if(seen.has(key))continue;const q=[[r,c]],region=[],touch=new Set();seen.add(key);
    while(q.length){const [rr,cc]=q.pop();region.push([rr,cc]);for(const [nr,nc] of goNeighbors(rr,cc)){const v=board[nr][nc];if(v===null){const k=`${nr},${nc}`;if(!seen.has(k)){seen.add(k);q.push([nr,nc]);}}else touch.add(v);}}
    if(touch.size===1){if(touch.has('black'))black+=region.length;else white+=region.length;}
  }
  // User-supplied Go endgame specification: Chinese area scoring; 3.75 komi is awarded to White.
  // The requested win threshold is Black area > 184.25 (i.e. at least 185 area points).
  const blackArea=black,whiteArea=white,whiteWithKomi=white+3.75;
  return{black:blackArea,white:whiteWithKomi,blackArea,whiteArea,komi:3.75,blackStones:blackArea,whiteStones:whiteArea,dead,blackWin:blackArea>184.25};
}
function finalizeGoScore(x){
  const sc=scoreGo(x.g);x.g.score=sc;
  x.g.winner=sc.blackWin?'black':'white';
  x.g.winnerPid=x.ai?(x.g.winner===x.players[0].color?x.players[0].pid:'ai'):x.players.find(q=>q.color===x.g.winner)?.pid||null;
  x.g.endedReason=`圍棋終局：黑 ${sc.blackArea} 子，白 ${sc.whiteArea} 子 + 貼目 ${sc.komi.toFixed(2)} = ${sc.white.toFixed(2)}；${x.g.winner==='black'?'黑方獲勝（黑方達 185 子）':'白方獲勝（黑方未達 185 子）'}！`;
  x.g.phase='ended';x.g.turn=null;x.g.turnDeadline=null;
}
function confirmGoScore(x,p){
  const g=x.g;if(g.phase!=='scoring')return{error:'目前不是終局結算階段'};g.scoreConfirm[p.pid]=true;
  if(x.ai){finalizeGoScore(x);return{ok:true};}
  if(x.players.length===2&&x.players.every(q=>g.scoreConfirm[q.pid]))finalizeGoScore(x);
  return{ok:true};
}
function createRoom(mode,matchmade=false,ai=false){
  const x={id:rid(),mode:normalizeMode(mode),ai,players:[],spectators:[],g:newGame(mode),rps:newRps(),difficulty:null,undoStack:[],checkEvent:null,proposal:null,rematchInvite:null,chat:[],matchmade:!!matchmade};
  rooms.set(x.id,x);return x;
}
function playerList(x){return x.players.map(p=>({pid:p.pid,name:p.name,avatar:p.avatar,color:p.color||null,connected:p.connected!==false})).concat(x.ai?[{pid:'ai',name:'電腦',avatar:'🤖',color:x.mode==='xiangqi'?'black':'white',connected:true}]:[]);}
function send(p,o){if(p?.ws?.readyState===1)p.ws.send(JSON.stringify(o));}
function setTurnDeadline(x){x.g.turnDeadline=x.g.turn?Date.now()+TURN_SECONDS*1000:null;}
function publicSnapshot(x,p){
  const spectator=p.role==='spectator';
  const rps=x.rps?{phase:x.rps.phase,result:x.rps.result||null,winnerPid:x.rps.winnerPid||null,isRpsWinner:!spectator&&x.rps.winnerPid===p.pid,youChoice:!spectator?(x.rps.choices?.[p.pid]||null):null,hasOpponentChoice:spectator?false:x.players.some(q=>q.pid!==p.pid&&x.rps.choices?.[q.pid])}:null;
  return {type:'state',roomId:spectator?x.id:(x.ai||x.matchmade?null:x.id),spectatorCode:x.id,matchmade:!!x.matchmade,mode:spectator?'spectator':(x.ai?'ai':'online'),gameMode:x.mode,difficulty:x.difficulty||null,color:spectator?null:(p.color||null),turn:x.g.turn,winner:x.g.winner,winnerPid:x.g.winnerPid||null,endedReason:x.g.endedReason||null,size:x.g.size,rows:x.g.rows||x.g.size,board:x.g.b||x.g.board,history:x.g.history,move:x.g.move,turnDeadline:x.g.turnDeadline,players:playerList(x),spectators:x.spectators?.length||0,rps,roundKey:x.g.roundKey,chat:x.chat||[],checkEvent:x.checkEvent||null,rematch:spectator?null:(x.rematchInvite?{pendingForMe:x.rematchInvite.toPid===p.pid,pendingByMe:x.rematchInvite.fromPid===p.pid}:null),proposal:spectator?null:(x.proposal?{kind:x.proposal.kind,fromPid:x.proposal.fromPid,fromName:x.proposal.fromName,toPid:x.proposal.toPid}:null),avatar:p.avatar,captures:x.g.captures||null,passStreak:x.g.passStreak||0,goPhase:x.g.phase||null,deadGroups:x.g.deadGroups||[],scoreConfirm:x.g.scoreConfirm||{},score:x.g.score||null};
}
function broadcast(x){[...x.players,...(x.spectators||[])].forEach(p=>send(p,publicSnapshot(x,p)));}
function broadcastMatchmakingWaiting(item){send(item.p,{type:'matchmaking',status:'searching',mode:item.mode});}
function removeFromMatchmaking(p){for(let i=matchmakingQueue.length-1;i>=0;i--)if(matchmakingQueue[i].p===p)matchmakingQueue.splice(i,1);}
function tryMatchmaking(){
  for(let i=0;i<matchmakingQueue.length;i++){
    const first=matchmakingQueue[i];if(!first||first.cancelled||first.p.ws.readyState!==1){matchmakingQueue.splice(i--,1);continue;}
    let j=-1;for(let k=i+1;k<matchmakingQueue.length;k++){const cand=matchmakingQueue[k];if(!cand||cand.cancelled||cand.p.ws.readyState!==1)continue;if(cand.mode===first.mode){j=k;break;}}
    if(j<0)continue;
    const second=matchmakingQueue[j];matchmakingQueue.splice(j,1);matchmakingQueue.splice(i,1);i--;
    const x=createRoom(first.mode,true,false);first.p.color=null;second.p.color=null;x.players.push(first.p,second.p);first.assign(x);second.assign(x);send(first.p,{type:'room',roomId:null,pid:first.p.pid,color:null,mode:'online',gameMode:x.mode,matchmade:true});send(second.p,{type:'room',roomId:null,pid:second.p.pid,color:null,mode:'online',gameMode:x.mode,matchmade:true});broadcast(x);
  }
}
function resetOnlineRound(x){x.g=newGame(x.mode);x.players.forEach(p=>p.color=null);x.rps=newRps();x.rematchInvite=null;x.proposal=null;x.checkEvent=null;x.chat=[];}
function choosePalette(mode){return mode==='xiangqi'?['red','black']:['black','white'];}
function resolveRps(x){
  if(x.rps.phase!=='rps'||x.players.length<2)return;
  const [a,b]=x.players,ca=x.rps.choices[a.pid],cb=x.rps.choices[b.pid];if(!ca||!cb)return;
  if(ca===cb){x.g.turn=null;x.rps={phase:'rps',choices:{},result:'平手！請再猜一次',winnerPid:null};return broadcast(x);}
  const winner=BEATS[ca]===cb?a:b;x.g.turn=null;x.rps={phase:'choose-color',choices:{},result:`${winner.name} 猜拳獲勝！請選擇${x.mode==='xiangqi'?'紅方／黑方':'黑方／白方'}。`,winnerPid:winner.pid};broadcast(x);
}
function chooseColor(x,p,color){
  if(x.rps.phase!=='choose-color')return'目前不是選色階段';if(x.rps.winnerPid!==p.pid)return'你是猜拳落敗者，請等待對方選色';
  const palette=choosePalette(x.mode);if(!palette.includes(color))return'顏色無效';
  const loser=x.players.find(q=>q.pid!==p.pid);p.color=color;loser.color=palette.find(c=>c!==color);x.rps.phase='done';x.rps.result=`${p.name} 選擇${x.mode==='xiangqi'?(color==='red'?'紅方':'黑方'):(color==='black'?'黑方':'白方')}，猜拳獲勝者先手。`;x.g.turn=p.color;setTurnDeadline(x);return null;
}
function timeOut(x){
  if(x.g.winner||!x.g.turn)return;
  const loser=x.g.turn,winner=x.mode==='xiangqi'?(loser==='red'?'black':'red'):(loser==='black'?'white':'black');
  x.g.winner=winner;x.g.winnerPid=x.ai&&winner===x.players[0].color?x.players[0].pid:(!x.ai?x.players.find(p=>p.color===winner)?.pid:null);x.endedReason=`${loser}方超時，${winner}方獲勝！`;x.g.turnDeadline=null;broadcast(x);
}
function applyOnlineMove(x,p,m){
  if(!x.ai&&x.rps?.phase!=='done')return{error:'請先完成猜拳與選色，現在還不能走棋'};
  if(x.mode==='xiangqi')return applyXQ(x,p,m);
  if(x.mode==='gomoku')return applyGomoku(x,p,m);
  return applyGoMove(x,p,+m.r,+m.c);
}

function lineRunScore(board,r,c,color){
  const dirs=[[1,0],[0,1],[1,1],[1,-1]];let total=0;
  for(const [dr,dc] of dirs){let len=1,open=0;for(const sign of [1,-1]){let rr=r+dr*sign,cc=c+dc*sign;while(rr>=0&&rr<GOMOKU_SIZE&&cc>=0&&cc<GOMOKU_SIZE&&board[rr][cc]===color){len++;rr+=dr*sign;cc+=dc*sign;}if(rr>=0&&rr<GOMOKU_SIZE&&cc>=0&&cc<GOMOKU_SIZE&&!board[rr][cc])open++;}if(len>=5)total+=100000;else total+=len*len*25+open*8;}return total;
}
function aiGomokuMove(g,level,color){
  const opp=oppositeGo(color),empties=[];for(let r=0;r<GOMOKU_SIZE;r++)for(let c=0;c<GOMOKU_SIZE;c++)if(!g.board[r][c])empties.push([r,c]);
  if(!empties.length)return null;
  if(!g.history.length&&g.board[Math.floor(GOMOKU_SIZE/2)][Math.floor(GOMOKU_SIZE/2)]===null)return[Math.floor(GOMOKU_SIZE/2),Math.floor(GOMOKU_SIZE/2)];
  if(level==='easy')return empties[Math.floor(Math.random()*empties.length)];
  // Win now, then block opponent's immediate win.
  for(const [r,c] of empties){g.board[r][c]=color;const w=gomokuWinner(g.board,r,c,color);g.board[r][c]=null;if(w)return[r,c];}
  for(const [r,c] of empties){g.board[r][c]=opp;const w=gomokuWinner(g.board,r,c,opp);g.board[r][c]=null;if(w)return[r,c];}
  let best=empties[0],bestScore=-Infinity;
  for(const [r,c] of empties){g.board[r][c]=color;const attack=lineRunScore(g.board,r,c,color);g.board[r][c]=null;g.board[r][c]=opp;const defend=lineRunScore(g.board,r,c,opp);g.board[r][c]=null;const center=10-Math.abs(r-7)-Math.abs(c-7);const noise=level==='hard'?Math.random():Math.random()*8;const score=attack+defend*.92+center*3+noise;if(score>bestScore){bestScore=score;best=[r,c];}}
  return best;
}
function legalGoMoves(x,color){
  const g=x.g, out=[];for(let r=0;r<GO_SIZE;r++)for(let c=0;c<GO_SIZE;c++){const sim=simulateGoPlacement(g,color,r,c);if(!sim.error)out.push({r,c,captured:sim.captured,board:sim.board});}return out;
}
function goLocalHeuristic(g,move,color){
  const opp=oppositeGo(color);let score=move.captured*250;
  const b=move.board,grp=groupAndLiberties(b,move.r,move.c);score+=grp.liberties.size*9;
  if(levelThreatened(b,move.r,move.c,opp))score+=120;
  for(const [nr,nc] of goNeighbors(move.r,move.c)){if(g.board[nr][nc]===color)score+=12;if(g.board[nr][nc]===opp)score+=7;}
  const center=9-Math.hypot(move.r-9,move.c-9)/2;score+=center;
  return score;
}
function levelThreatened(board,r,c,color){const g=groupAndLiberties(board,r,c);return g.liberties.size<=1;}
function aiGoMove(x,level){
  const color='white',legal=legalGoMoves(x,color);if(!legal.length)return null;
  if(level==='easy')return legal[Math.floor(Math.random()*legal.length)];
  // Tactical priorities: capture, save own group, pressure adjacent groups, center.
  let ranked=legal.map(m=>({...m,score:goLocalHeuristic(x.g,m,color)+Math.random()*(level==='hard'?0.4:8)})).sort((a,b)=>b.score-a.score);
  if(level==='normal')return ranked[0];
  // Hard: shallow 1-ply opponent reply approximation over the best candidates.
  const candidates=ranked.slice(0,Math.min(18,ranked.length));let best=candidates[0],bestScore=-Infinity;
  for(const m of candidates){let score=m.score;const ng={...x.g,board:m.board};const replies=[];for(let r=Math.max(0,m.r-2);r<=Math.min(GO_SIZE-1,m.r+2);r++)for(let c=Math.max(0,m.c-2);c<=Math.min(GO_SIZE-1,m.c+2);c++){if(ng.board[r][c])continue;const sim=simulateGoPlacement(ng,'black',r,c);if(!sim.error)replies.push({...sim,r,c});}
    if(replies.length){let oppBest=0;for(const rep of replies.slice(0,20)){oppBest=Math.max(oppBest,rep.captured*250+groupAndLiberties(rep.board,rep.r,rep.c).liberties.size*6);}score-=oppBest*.32;}
    if(score>bestScore){bestScore=score;best=m;}
  }
  return best;
}
function aiColor(x){return x.mode==='xiangqi'?'black':'white';}
function aiTurn(x){
  const ac=aiColor(x);if(!x.ai||x.g.winner||x.g.turn!==ac)return;
  const fake={pid:'ai',color:ac};let move=null;
  if(x.mode==='xiangqi'){
    const moves=[];const p={color:'black'};for(let r=0;r<10;r++)for(let c=0;c<9;c++)if(x.g.b[r][c]&&own(x.g.b[r][c].t,'black'))for(let rr=0;rr<10;rr++)for(let cc=0;cc<9;cc++)if(!legalXQ(x.g,p,r,c,rr,cc))moves.push({r1:r,c1:c,r2:rr,c2:cc});
    if(!moves.length){x.g.winner='red';x.g.winnerPid=x.players[0].pid;x.g.endedReason='電腦無合法走法，你獲勝！';x.g.turnDeadline=null;broadcast(x);return;}move=moves[Math.floor(Math.random()*moves.length)];
  } else if(x.mode==='gomoku'){const a=aiGomokuMove(x.g,x.difficulty,ac);if(a)move={r:a[0],c:a[1]};}
  else {const mv=aiGoMove(x,x.difficulty);if(mv)move={r:mv.r,c:mv.c};}
  if(x.mode==='go'&&move===null){passGo(x,fake);broadcast(x);return;}
  const res=applyOnlineMove(x,fake,move);if(res.ok){const checkId=x.checkEvent?.id;broadcast(x);if(checkId)setTimeout(()=>{if(x.checkEvent?.id===checkId){x.checkEvent=null;broadcast(x);}},1500);}
}
function proposal(x,p,kind){
  if(x.g.winner)return'對局已結束';if(x.players.length<2)return'目前沒有對手';if(x.proposal)return'已有一個請求等待回覆';
  const other=x.players.find(q=>q.pid!==p.pid);if(!other)return'目前沒有對手';x.proposal={kind,fromPid:p.pid,fromName:p.name,toPid:other.pid};send(other,{type:'proposal',kind,fromName:p.name});broadcast(x);return null;
}
function handleProposalResponse(x,p,accept){
  const q=x.proposal;if(!q||q.toPid!==p.pid)return'沒有等待中的請求';const from=x.players.find(z=>z.pid===q.fromPid);x.proposal=null;
  if(q.kind==='draw'){if(accept){x.g.winner='draw';x.g.winnerPid=null;x.g.endedReason='雙方同意和棋。';x.g.turnDeadline=null;broadcast(x);}else{if(from)send(from,{type:'notice',message:`${p.name} 拒絕和棋請求。`});broadcast(x);}}
  else if(q.kind==='undo'){
    if(!accept){if(from)send(from,{type:'notice',message:`${p.name} 拒絕悔棋請求。`});broadcast(x);return null;}
    if(!x.undoStack.length)return'沒有可以悔回的步驟';const prev=x.undoStack.pop();
    if(x.mode==='xiangqi'){x.g=clone(prev);}else if(x.mode==='go'){restoreGoState(x.g,prev);}else{x.g.board=clone(prev.board);x.g.history=clone(prev.history);x.g.turn=prev.turn;x.g.move=prev.move||Math.max(1,x.g.history.length+1);x.g.winner=null;x.g.winnerPid=null;x.g.endedReason=null;}
    x.checkEvent=null;x.g.winner=null;x.g.winnerPid=null;x.g.endedReason=null;setTurnDeadline(x);broadcast(x);
  }
}
function inviteRematch(x,p){
  if(!x.g.winner)return'對局結束後才能邀請再戰';if(x.rematchInvite)return'已經有再戰邀請正在等待';const other=x.players.find(q=>q.pid!==p.pid);if(!other)return'沒有對手';
  x.rematchInvite={fromPid:p.pid,toPid:other.pid};send(other,{type:'rematch-invite',fromName:p.name,roomId:x.id,ended:true});broadcast(x);return null;
}

const server=http.createServer((req,res)=>{
  let u=req.url.split('?')[0];if(u==='/')u='/index.html';const file=path.join(pub,u);
  if(!file.startsWith(pub)||!fs.existsSync(file)){res.writeHead(404);return res.end('404');}
  const mime={'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8'}[path.extname(file)]||'application/octet-stream';
  res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store'});fs.createReadStream(file).pipe(res);
});
const wss=new WebSocketServer({server});
wss.on('connection',ws=>{
  let x=null,p=null;
  ws.on('message',raw=>{
    let m;try{m=JSON.parse(raw)}catch{return}
    if(m.action==='create'){
      const mode=normalizeMode(m.mode);x=createRoom(mode,false,false);p={ws,pid:pid(),role:'player',profileId:String(m.profileId||''),name:String(m.name||'玩家1').slice(0,12),avatar:normalizeAvatar(m.avatar),color:null,connected:true};x.players.push(p);
      send(p,{type:'room',roomId:x.id,pid:p.pid,color:null,mode:'online',gameMode:mode,matchmade:false,spectatorCode:x.id});send(p,publicSnapshot(x,p));
    }else if(m.action==='watch'){
      if(x||p)return send({ws},{type:'error',message:'你目前已有一個連線中的對局，請先離開。'});
      const code=String(m.roomId||'').trim().toUpperCase();
      x=rooms.get(code);
      if(!x)return send({ws},{type:'error',message:'找不到這個觀戰房間。'});
      if(!x.ai&&x.rps?.phase!=='done')return send({ws},{type:'error',message:'這場對局尚未開始，請等雙方完成猜拳與選色後再觀戰。'});
      p={ws,pid:pid(),role:'spectator',profileId:String(m.profileId||''),name:String(m.name||'觀戰者').slice(0,12),avatar:normalizeAvatar(m.avatar),color:null,connected:true};x.spectators.push(p);
      send(p,{type:'room',roomId:x.id,pid:p.pid,color:null,mode:'spectator',gameMode:x.mode,matchmade:!!x.matchmade,spectatorCode:x.id});send(p,publicSnapshot(x,p));broadcast(x);
    }else if(m.action==='matchmake'){
      if(x||p)return send({ws},{type:'error',message:'你已在房間中'});const mode=normalizeMode(m.mode);
      p={ws,pid:pid(),role:'player',profileId:String(m.profileId||''),name:String(m.name||'玩家').slice(0,12),avatar:normalizeAvatar(m.avatar),color:null,connected:true};
      const item={ws,p,mode,cancelled:false,assign:room=>{x=room;}};matchmakingQueue.push(item);broadcastMatchmakingWaiting(item);tryMatchmaking();
    }else if(m.action==='cancelMatchmake'){
      if(p&&!x){removeFromMatchmaking(p);send(p,{type:'matchmaking',status:'cancelled'});}
    }else if(m.action==='ai'){
      const mode=normalizeMode(m.mode),difficulty=normalizeDifficulty(m.difficulty);x=createRoom(mode,false,true);x.difficulty=difficulty;
      p={ws,pid:pid(),role:'player',profileId:String(m.profileId||''),name:String(m.name||'玩家1').slice(0,12),avatar:normalizeAvatar(m.avatar),color:mode==='xiangqi'?'red':'black',connected:true};x.players.push(p);x.g.turn=p.color;setTurnDeadline(x);
      send(p,{type:'room',roomId:null,pid:p.pid,color:p.color,mode:'ai',gameMode:mode,difficulty,spectatorCode:x.id});send(p,publicSnapshot(x,p));
    }else if(m.action==='join'){
      x=rooms.get(String(m.roomId||'').trim().toUpperCase());
      if(!x||x.ai||x.players.length>=2)return send({ws},{type:'error',message:'房間不存在、已滿，或這是人機房間'});
      p={ws,pid:pid(),role:'player',profileId:String(m.profileId||''),name:String(m.name||'玩家2').slice(0,12),avatar:normalizeAvatar(m.avatar),color:null,connected:true};x.players.push(p);
      send(p,{type:'room',roomId:x.id,pid:p.pid,color:null,mode:'online',gameMode:x.mode,matchmade:!!x.matchmade,spectatorCode:x.id});
      broadcast(x);
    }else if(!x||!p)return;
    else if(p.role==='spectator'){
      if(m.action==='leaveWatch'){x.spectators=x.spectators.filter(q=>q!==p);x=x;send(p,{type:'left-watch'});if(!x.players.length&&!x.spectators.length)rooms.delete(x.id);}
      else if(m.action==='chat')send(p,{type:'error',message:'觀戰模式目前僅能觀看，不能發送聊天訊息。'});
      else return;
    }
    else if(m.action==='rps'&&!x.ai){
      if(x.players.length<2)return send(p,{type:'error',message:'請等待另一位玩家加入'});if(x.rps.phase!=='rps')return send(p,{type:'error',message:'目前不是猜拳階段'});
      if(!['剪刀','石頭','布'].includes(m.choice))return send(p,{type:'error',message:'猜拳選項無效'});if(x.rps.choices[p.pid])return send(p,{type:'error',message:'你本輪已經出拳，請等待結果'});
      x.rps.choices[p.pid]=m.choice;if(x.players.every(q=>x.rps.choices[q.pid]))resolveRps(x);else broadcast(x);
    }else if(m.action==='chooseColor'&&!x.ai){const e=chooseColor(x,p,m.color);if(e)send(p,{type:'error',message:e});else broadcast(x);}
    else if(m.action==='chat'){
      if(x.ai)return send(p,{type:'error',message:'單人模式沒有聊天室'});if(x.rps?.phase!=='done'||!x.g.turn||x.g.winner)return send(p,{type:'error',message:'目前無法聊天'});
      const text=String(m.text||'').trim().slice(0,200);if(!text)return;x.chat.push({pid:p.pid,name:p.name,avatar:p.avatar,text,ts:Date.now()});if(x.chat.length>100)x.chat=x.chat.slice(-100);broadcast(x);
    }else if(m.action==='move'){
      const res=applyOnlineMove(x,p,m);if(res.error)return send(p,{type:'error',message:res.error});
      const checkId=x.checkEvent?.id;broadcast(x);if(checkId)setTimeout(()=>{if(x.checkEvent?.id===checkId){x.checkEvent=null;broadcast(x);}},1500);
      if(x.ai&&!x.g.winner)setTimeout(()=>aiTurn(x),450);
    }else if(m.action==='pass'&&x.mode==='go'){
      const res=passGo(x,p);if(res.error)return send(p,{type:'error',message:res.error});broadcast(x);
      if(x.ai&&!x.g.winner&&x.g.phase==='play')setTimeout(()=>aiTurn(x),450);
    }else if(m.action==='goToggleDead'&&x.mode==='go'){
      const res=toggleGoDead(x,p,+m.r,+m.c);if(res.error)return send(p,{type:'error',message:res.error});broadcast(x);
    }else if(m.action==='goConfirmScore'&&x.mode==='go'){
      const res=confirmGoScore(x,p);if(res.error)return send(p,{type:'error',message:res.error});broadcast(x);
    }else if(m.action==='resign'){
      if(x.g.winner)return send(p,{type:'error',message:'對局已結束'});const opp=x.mode==='xiangqi'?(p.color==='red'?'black':'red'):(p.color==='black'?'white':'black');x.g.winner=opp;x.g.winnerPid=x.ai&&opp===x.players[0].color?x.players[0].pid:(!x.ai?x.players.find(q=>q.color===opp)?.pid||null:null);x.g.endedReason=`${p.name} 投降，${opp==='red'?'紅方':opp==='black'?'黑方':'白方'}獲勝！`;x.g.turn=null;x.g.turnDeadline=null;x.g.phase=x.mode==='go'?'ended':x.g.phase;broadcast(x);
    }else if(m.action==='proposal'){
      if(x.ai&&m.kind==='undo'){
        if(x.g.winner)return send(p,{type:'error',message:'對局已結束，不能悔棋'});if(!x.undoStack.length)return send(p,{type:'error',message:'目前沒有可以悔回的步驟'});
        const steps=Math.min(2,x.undoStack.length);let restored=null;for(let i=0;i<steps;i++)restored=x.undoStack.pop();
        if(x.mode==='xiangqi')x.g=clone(restored);else if(x.mode==='go')restoreGoState(x.g,restored);else{x.g.board=clone(restored.board);x.g.history=clone(restored.history);x.g.turn=restored.turn;x.g.move=restored.move||Math.max(1,x.g.history.length+1);x.g.winner=null;x.g.winnerPid=null;x.g.endedReason=null;}
        x.checkEvent=null;setTurnDeadline(x);broadcast(x);
      }else if(x.ai&&m.kind==='draw'){
        if(x.g.winner)return send(p,{type:'error',message:'對局已結束'});x.g.winner='draw';x.g.endedReason='你選擇求和，本局以和棋結束。';x.g.turnDeadline=null;broadcast(x);
      }else{const e=proposal(x,p,m.kind);if(e)send(p,{type:'error',message:e});}
    }else if(m.action==='proposalResponse'){const e=handleProposalResponse(x,p,!!m.accept);if(e)send(p,{type:'error',message:e});}
    else if(m.action==='inviteRematch'&&!x.ai){const e=inviteRematch(x,p);if(e)send(p,{type:'error',message:e});else broadcast(x);}
    else if(m.action==='rematchResponse'&&!x.ai){
      const inv=x.rematchInvite;if(!inv||inv.toPid!==p.pid)return send(p,{type:'error',message:'沒有等待中的再戰邀請'});x.rematchInvite=null;if(m.accept){resetOnlineRound(x);broadcast(x);}else{const inviter=x.players.find(q=>q.pid===inv.fromPid);if(inviter)send(inviter,{type:'notice',message:`${p.name} 暫時不進行下一場。`});broadcast(x);}
    }else if(m.action==='aiRematch'&&x.ai){x.g=newGame(x.mode);x.g.turn=p.color;setTurnDeadline(x);x.undoStack=[];x.checkEvent=null;x.chat=[];broadcast(x);}
  });
  ws.on('close',()=>{
    if(p&&!x)removeFromMatchmaking(p);if(!x||!p)return;
    if(p.role==='spectator'){
      x.spectators=(x.spectators||[]).filter(q=>q!==p);
      if(!x.players.length&&!x.spectators.length)rooms.delete(x.id);else broadcast(x);
      return;
    }
    const online=!x.ai,hadTwo=x.players.length===2;x.players=x.players.filter(q=>q!==p);
    if(!x.players.length&&!x.spectators.length){rooms.delete(x.id);return;}
    if(online&&hadTwo){const survivor=x.players[0];const winner=survivor.color||(x.mode==='xiangqi'?'red':'black');survivor.color=winner;x.g.winner=winner;x.g.winnerPid=survivor.pid;x.g.endedReason='對方已斷線，你方獲勝！';x.g.turnDeadline=null;x.proposal=null;x.rematchInvite=null;x.rps.phase='done';broadcast(x);}
    else broadcast(x);
  });
});
setInterval(()=>{for(const x of rooms.values())if(x.g?.turnDeadline&&Date.now()>x.g.turnDeadline&&!x.g.winner)timeOut(x);tryMatchmaking();},500);
server.listen(PORT,()=>console.log(`Board Arena Online v2.9 multi-game on ${PORT}`));

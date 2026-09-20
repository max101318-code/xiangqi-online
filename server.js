
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const TURN_SECONDS = 30;
const GO_SIZE = 19;
const GOMOKU_SIZE = 15;
const BANQI_ROWS = 8;
const BANQI_COLS = 4;
const rooms = new Map();
const matchmakingQueue = [];
const pub = path.join(__dirname, 'public');

const GAME_NAMES = {
  xiangqi: '中國象棋',
  gomoku: '五子棋',
  go: '圍棋',
  banqi: '明棋',
  darkbanqi: '暗棋（連吃版）',
  checkers: '多人跳棋'
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

function normalizeMode(v){ return ['xiangqi','gomoku','go','banqi','darkbanqi','checkers'].includes(v) ? v : 'xiangqi'; }
function isExtraMode(mode){ return ['banqi','darkbanqi','checkers'].includes(mode); }
function isBanqi(mode){ return mode==='banqi'||mode==='darkbanqi'; }
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


// === v3.2 新增：明棋／暗棋（連吃版）／多人跳棋 ===
const BANQI_RANK={king:6,advisor:5,elephant:4,rook:3,cannon:3,knight:2,pawn:1};
const BANQI_TYPES=[
  ['king',1],['advisor',2],['elephant',2],['rook',2],['cannon',2],['knight',2],['pawn',5]
];
function shuffledBanqiPieces(){
  const all=[];
  for(const color of ['red','black']) for(const [type,n] of BANQI_TYPES) for(let i=0;i<n;i++)
    all.push({color,type,revealed:false,id:crypto.randomBytes(4).toString('hex')});
  for(let i=all.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[all[i],all[j]]=[all[j],all[i]];}
  return all;
}
function initBanqiBoard(g){
  const pieces=shuffledBanqiPieces();
  g.board=Array.from({length:BANQI_ROWS},()=>Array(BANQI_COLS).fill(null));
  let k=0;
  for(let r=0;r<BANQI_ROWS;r++)for(let c=0;c<BANQI_COLS;c++)g.board[r][c]=pieces[k++];
  return g;
}
function banqiLabel(piece){
  const red={king:'帥',advisor:'仕',elephant:'相',rook:'俥',cannon:'炮',knight:'傌',pawn:'兵'};
  const black={king:'將',advisor:'士',elephant:'象',rook:'車',cannon:'炮',knight:'馬',pawn:'卒'};
  return (piece.color==='red'?red:black)[piece.type];
}
function banqiCanEat(att,def){
  if(!att||!def||att.color===def.color)return false;
  // 客製規則：卒不能吃炮；除卒外，其他棋種都可以吃炮。
  if(def.type==='cannon')return att.type!=='pawn';
  if(att.type==='pawn'&&def.type==='king')return true;
  if(att.type==='king'&&def.type==='pawn')return false;
  return BANQI_RANK[att.type]>=BANQI_RANK[def.type];
}
function banqiOppColor(c){return c==='red'?'black':'red';}
function banqiNextPid(x,pid){
  const ps=[...x.players.filter(p=>p.connected!==false),...(x.ai?[{pid:'ai',color:x.aiColor||null,connected:true}]:[])];
  const i=ps.findIndex(q=>q.pid===pid);
  return i<0?ps[0]?.pid:ps[(i+1)%ps.length]?.pid;
}
function banqiPlayerByPid(x,id){ if(id==='ai') return {pid:'ai',name:'電腦',color:x.aiColor}; return x.players.find(p=>p.pid===id)||null; }
function banqiRemaining(x,color){let n=0;for(const row of x.g.board)for(const p of row)if(p&&p.color===color)n++;return n;}
function banqiEndsIfWon(x,p){
  const opp=banqiOppColor(p.color);
  if(banqiRemaining(x,opp)===0){x.g.winner=p.color;x.g.winnerPid=p.pid;x.g.endedReason=`${p.name||'玩家'} 消滅對方全部棋子，獲勝！`;x.g.turn=null;x.g.turnDeadline=null;return true;}
  return false;
}

function banqiAdjacent(r1,c1,r2,c2){return Math.abs(r1-r2)+Math.abs(c1-c2)===1;}
function banqiOrthogonal(r1,c1,r2,c2){return (r1===r2||c1===c2)&&!(r1===r2&&c1===c2);}
function banqiBetweenCount(board,r1,c1,r2,c2){
  if(!banqiOrthogonal(r1,c1,r2,c2))return -1;
  const dr=Math.sign(r2-r1),dc=Math.sign(c2-c1);let r=r1+dr,c=c1+dc,n=0;
  while(r!==r2||c!==c2){if(board[r][c])n++;r+=dr;c+=dc;}
  return n;
}
function banqiCaptureRule(att,target,board,r1,c1,r2,c2){
  if(!att||!target||att.color===target.color)return false;
  if(att.type==='cannon')return banqiBetweenCount(board,r1,c1,r2,c2)===1;
  if(!banqiAdjacent(r1,c1,r2,c2))return false;
  return banqiCanEat(att,target);
}
function banqiPlayerByPid(x,id){if(id==='ai')return{pid:'ai',name:'電腦',color:x.aiColor};return x.players.find(p=>p.pid===id)||null;}
function banqiRemaining(x,color){let n=0;for(const row of x.g.board)for(const p of row)if(p&&p.color===color)n++;return n;}
function banqiEndsIfWon(x,p){
  const opp=banqiOppColor(p.color);
  if(banqiRemaining(x,opp)===0){x.g.winner=p.color;x.g.winnerPid=p.pid;x.g.endedReason=`${p.name||'玩家'} 消滅對方全部棋子，獲勝！`;x.g.turn=null;x.g.turnDeadline=null;return true;}
  return false;
}
function applyBanqi(x,p,m){
  const g=x.g;
  if(g.winner)return{error:'遊戲已結束'};
  if(g.turn!==p.pid)return{error:'還沒輪到你'};
  if(g.turnDeadline&&Date.now()>g.turnDeadline){timeOut(x);return{error:'回合時間已到'}};
  const r=+m.r,c=+m.c;
  if(r<0||r>=BANQI_ROWS||c<0||c>=BANQI_COLS)return{error:'位置超出棋盤'};
  const cell=g.board[r]?.[c];

  // 翻棋：只翻一顆，翻完立即換手。
  if(m.action==='flip'){
    if(!cell)return{error:'這裡沒有棋子'};
    if(cell.revealed)return{error:'這顆棋已經翻開'};
    cell.revealed=true;
    if(!p.color){
      p.color=cell.color;
      if(p.pid==='ai'){
        x.aiColor=cell.color;
        const other=x.players.find(q=>q.pid!==p.pid);if(other)other.color=banqiOppColor(cell.color);
      }else if(x.ai){
        x.aiColor=banqiOppColor(cell.color);
        const other=x.players.find(q=>q.pid!==p.pid);if(other)other.color=banqiOppColor(cell.color);
      }else{
        const other=x.players.find(q=>q.pid!==p.pid);if(other)other.color=banqiOppColor(cell.color);
      }
    }
    g.history.push({n:g.move,color:p.color||cell.color,move:'翻棋',at:[r+1,c+1],piece:banqiLabel(cell)});g.move++;
    g.turn=banqiNextPid(x,p.pid);setTurnDeadline(x);
    return{ok:true};
  }

  // 只有已翻開的己方棋子才能作為攻擊者。
  const attacker=g.board[r]?.[c];
  if(!attacker||!attacker.revealed)return{error:'起點必須是自己已翻開的棋子'};
  if(attacker.color!==p.color)return{error:'只能使用自己的已翻開棋子'};
  const toR=+m.toR,toC=+m.toC;
  if(toR<0||toR>=BANQI_ROWS||toC<0||toC>=BANQI_COLS)return{error:'目的地超出棋盤'};
  const target=g.board[toR]?.[toC];

  if(m.action==='move'){
    if(!banqiAdjacent(r,c,toR,toC))return{error:'移動只能上下左右一格'};
    if(target)return{error:'目標格已有棋子'};
    if(g.chain?.pid===p.pid)return{error:'連吃中不能普通移動，請吃棋或停止連吃'};
    const before=clone(g);
    g.board[toR][toC]=attacker;g.board[r][c]=null;
    g.history.push({n:g.move,color:p.color,piece:banqiLabel(attacker),from:[r+1,c+1],to:[toR+1,toC+1]});g.move++;x.undoStack.push(before);
    g.turn=banqiNextPid(x,p.pid);setTurnDeadline(x);return{ok:true};
  }

  if(m.action==='capture'){
    if(!target)return{error:'目標沒有棋子'};

    // 暗棋連吃的特殊規則：碰到未翻開的棋時先揭露。
    // 1) 未翻開己方棋：揭露它，原攻擊棋不移動，立即結束連吃並換手。
    // 2) 未翻開敵棋且比攻擊棋大：揭露它，原攻擊棋不移動，立即中斷連吃並換手。
    // 3) 未翻開敵棋且可吃：才真正吃掉，攻擊棋移到目標格。
    const wasCovered=!target.revealed;
    if(x.mode==='banqi'&&wasCovered)return{error:'明棋不能吃未翻開的暗棋'};
    if(x.mode==='darkbanqi'&&wasCovered){
      const revealBefore=clone(g);
      target.revealed=true;
      if(target.color===p.color){
        g.history.push({n:g.move,color:p.color,piece:banqiLabel(attacker),from:[r+1,c+1],to:[toR+1,toC+1],reveal:true,revealedPiece:banqiLabel(target),blockedByFriend:true});
        x.undoStack.push(revealBefore);
        g.move++;g.chain=null;g.turn=banqiNextPid(x,p.pid);setTurnDeadline(x);return{ok:true};
      }
      // 暗棋的炮依然是特殊棋：對已翻開目標可跨子吃；但踩到未翻開且目標階級更大時仍依規格中斷連吃。
      if(attacker.type!=='cannon'&&BANQI_RANK[target.type]>BANQI_RANK[attacker.type]){
        g.history.push({n:g.move,color:p.color,piece:banqiLabel(attacker),from:[r+1,c+1],to:[toR+1,toC+1],reveal:true,revealedPiece:banqiLabel(target),blocked:true});
        x.undoStack.push(revealBefore);
        g.move++;g.chain=null;g.turn=banqiNextPid(x,p.pid);setTurnDeadline(x);return{ok:true};
      }
      if(attacker.type==='cannon'&&BANQI_RANK[target.type]>BANQI_RANK[attacker.type]){
        // 炮仍需隔一子才可能飛吃；若不滿足炮架規則，保持原地並換手。
        if(!banqiCaptureRule(attacker,target,g.board,r,c,toR,toC)){
          g.history.push({n:g.move,color:p.color,piece:banqiLabel(attacker),from:[r+1,c+1],to:[toR+1,toC+1],reveal:true,revealedPiece:banqiLabel(target),blocked:true});
          x.undoStack.push(revealBefore);
        g.move++;g.chain=null;g.turn=banqiNextPid(x,p.pid);setTurnDeadline(x);return{ok:true};
        }
      }
    }

    if(!banqiCaptureRule(attacker,target,g.board,r,c,toR,toC)){
      // 暗棋：如果是未翻開敵棋但不能吃，也必須停在原地；棋子本身不移動。
      if(x.mode==='darkbanqi'&&wasCovered){
        g.history.push({n:g.move,color:p.color,piece:banqiLabel(attacker),from:[r+1,c+1],to:[toR+1,toC+1],reveal:true,revealedPiece:banqiLabel(target),blocked:true});
        g.move++;g.chain=null;g.turn=banqiNextPid(x,p.pid);setTurnDeadline(x);return{ok:true};
      }
      return{error:'這顆棋不能吃目標棋子'};
    }

    const before=clone(g);
    g.board[toR][toC]=attacker;g.board[r][c]=null;
    g.history.push({n:g.move,color:p.color,piece:banqiLabel(attacker),from:[r+1,c+1],to:[toR+1,toC+1],captured:banqiLabel(target),coveredTarget:wasCovered});g.move++;x.undoStack.push(before);

    if(banqiEndsIfWon(x,p))return{ok:true};
    if(x.mode==='darkbanqi'){
      // 成功吃到同階／較小敵棋後，才進入連吃；若沒有下一個合法吃法才換手。
      g.chain={pid:p.pid,r:toR,c:toC,captures:(g.chain?.captures||0)+1};
      if(!hasBanqiChainCapture(x,p.pid,toR,toC)){
        g.chain=null;g.turn=banqiNextPid(x,p.pid);setTurnDeadline(x);
      }else setTurnDeadline(x);
      return{ok:true};
    }
    g.turn=banqiNextPid(x,p.pid);setTurnDeadline(x);return{ok:true};
  }
  return{error:'未知動作'};
}

function hasBanqiChainCapture(x,pid,r,c){
  const p=banqiPlayerByPid(x,pid);if(!p?.color)return false;const att=x.g.board[r]?.[c];if(!att)return false;
  for(let rr=0;rr<BANQI_ROWS;rr++)for(let cc=0;cc<BANQI_COLS;cc++){
    if(rr===r&&cc===c)continue;const t=x.g.board[rr][cc];if(!t||t.color===p.color)continue;
    if(x.mode==='banqi'&&!t.revealed)continue;
    const test=t.revealed?t:Object.assign({},t,{revealed:true});
    if(banqiCaptureRule(att,test,x.g.board,r,c,rr,cc))return true;
  }
  return false;
}
function stopBanqiChain(x,p){if(x.mode!=='darkbanqi'||!x.g.chain||x.g.chain.pid!==p.pid)return{error:'目前沒有你的連吃回合'};x.g.chain=null;x.g.turn=banqiNextPid(x,p.pid);setTurnDeadline(x);return{ok:true};}

const CHECKER_HOLES=[{id:'h0',x:0.271429,y:0.163265,camp:0},{id:'h1',x:0.730000,y:0.164723,camp:1},{id:'h2',x:0.671429,y:0.193878,camp:1},{id:'h3',x:0.328571,y:0.198251,camp:0},{id:'h4',x:0.727143,y:0.225948,camp:1},{id:'h5',x:0.615714,y:0.228863,camp:1},{id:'h6',x:0.387143,y:0.230321,camp:0},{id:'h7',x:0.271429,y:0.231778,camp:0},{id:'h8',x:0.560000,y:0.260933,camp:1},{id:'h9',x:0.672857,y:0.260933,camp:1},{id:'h10',x:0.444286,y:0.263848,camp:0},{id:'h11',x:0.328571,y:0.265306,camp:0},{id:'h12',x:0.615714,y:0.293003,camp:1},{id:'h13',x:0.731429,y:0.294461,camp:1},{id:'h14',x:0.501429,y:0.295918,camp:-1},{id:'h15',x:0.387143,y:0.298834,camp:0},{id:'h16',x:0.272857,y:0.300292,camp:0},{id:'h17',x:0.672857,y:0.326531,camp:1},{id:'h18',x:0.558571,y:0.329446,camp:-1},{id:'h19',x:0.442857,y:0.330904,camp:-1},{id:'h20',x:0.330000,y:0.333819,camp:0},{id:'h21',x:0.731429,y:0.360058,camp:1},{id:'h22',x:0.615714,y:0.362974,camp:-1},{id:'h23',x:0.272857,y:0.364431,camp:0},{id:'h24',x:0.500000,y:0.364431,camp:-1},{id:'h25',x:0.387143,y:0.365889,camp:-1},{id:'h26',x:0.672857,y:0.396501,camp:-1},{id:'h27',x:0.331429,y:0.397959,camp:-1},{id:'h28',x:0.558571,y:0.397959,camp:-1},{id:'h29',x:0.444286,y:0.399417,camp:-1},{id:'h30',x:0.730000,y:0.430029,camp:-1},{id:'h31',x:0.388571,y:0.431487,camp:-1},{id:'h32',x:0.614286,y:0.431487,camp:-1},{id:'h33',x:0.501429,y:0.432945,camp:-1},{id:'h34',x:0.272857,y:0.434402,camp:-1},{id:'h35',x:0.787143,y:0.462099,camp:2},{id:'h36',x:0.444286,y:0.465015,camp:-1},{id:'h37',x:0.671429,y:0.465015,camp:-1},{id:'h38',x:0.217143,y:0.466472,camp:5},{id:'h39',x:0.558571,y:0.466472,camp:-1},{id:'h40',x:0.330000,y:0.467930,camp:-1},{id:'h41',x:0.844286,y:0.495627,camp:2},{id:'h42',x:0.502857,y:0.497085,camp:-1},{id:'h43',x:0.730000,y:0.497085,camp:-1},{id:'h44',x:0.275714,y:0.500000,camp:-1},{id:'h45',x:0.388571,y:0.500000,camp:-1},{id:'h46',x:0.615714,y:0.500000,camp:-1},{id:'h47',x:0.160000,y:0.501458,camp:5},{id:'h48',x:0.901429,y:0.529155,camp:2},{id:'h49',x:0.560000,y:0.530612,camp:-1},{id:'h50',x:0.785714,y:0.530612,camp:2},{id:'h51',x:0.331429,y:0.532070,camp:-1},{id:'h52',x:0.672857,y:0.532070,camp:-1},{id:'h53',x:0.101429,y:0.534985,camp:5},{id:'h54',x:0.218571,y:0.534985,camp:5},{id:'h55',x:0.444286,y:0.534985,camp:-1},{id:'h56',x:0.958571,y:0.562682,camp:2},{id:'h57',x:0.615714,y:0.564140,camp:-1},{id:'h58',x:0.844286,y:0.564140,camp:2},{id:'h59',x:0.275714,y:0.565598,camp:-1},{id:'h60',x:0.388571,y:0.565598,camp:-1},{id:'h61',x:0.730000,y:0.565598,camp:-1},{id:'h62',x:0.160000,y:0.567055,camp:5},{id:'h63',x:0.501429,y:0.567055,camp:-1},{id:'h64',x:0.045714,y:0.569971,camp:5},{id:'h65',x:0.674286,y:0.597668,camp:-1},{id:'h66',x:0.901429,y:0.597668,camp:2},{id:'h67',x:0.447143,y:0.599125,camp:-1},{id:'h68',x:0.560000,y:0.599125,camp:-1},{id:'h69',x:0.787143,y:0.599125,camp:2},{id:'h70',x:0.217143,y:0.600583,camp:5},{id:'h71',x:0.331429,y:0.600583,camp:-1},{id:'h72',x:0.104286,y:0.602041,camp:5},{id:'h73',x:0.731429,y:0.628280,camp:-1},{id:'h74',x:0.844286,y:0.631195,camp:2},{id:'h75',x:0.388571,y:0.632653,camp:-1},{id:'h76',x:0.502857,y:0.632653,camp:-1},{id:'h77',x:0.615714,y:0.632653,camp:-1},{id:'h78',x:0.275714,y:0.634111,camp:-1},{id:'h79',x:0.160000,y:0.635569,camp:5},{id:'h80',x:0.787143,y:0.661808,camp:2},{id:'h81',x:0.447143,y:0.666181,camp:-1},{id:'h82',x:0.560000,y:0.666181,camp:-1},{id:'h83',x:0.674286,y:0.666181,camp:-1},{id:'h84',x:0.331429,y:0.667638,camp:-1},{id:'h85',x:0.217143,y:0.669096,camp:5},{id:'h86',x:0.502857,y:0.698251,camp:-1},{id:'h87',x:0.618571,y:0.698251,camp:-1},{id:'h88',x:0.731429,y:0.698251,camp:-1},{id:'h89',x:0.388571,y:0.701166,camp:-1},{id:'h90',x:0.275714,y:0.702624,camp:-1},{id:'h91',x:0.674286,y:0.731778,camp:-1},{id:'h92',x:0.447143,y:0.733236,camp:-1},{id:'h93',x:0.561429,y:0.733236,camp:-1},{id:'h94',x:0.331429,y:0.736152,camp:-1},{id:'h95',x:0.731429,y:0.763848,camp:3},{id:'h96',x:0.618571,y:0.765306,camp:-1},{id:'h97',x:0.502857,y:0.766764,camp:-1},{id:'h98',x:0.277143,y:0.768222,camp:4},{id:'h99',x:0.388571,y:0.768222,camp:-1},{id:'h100',x:0.674286,y:0.798834,camp:3},{id:'h101',x:0.447143,y:0.800292,camp:-1},{id:'h102',x:0.560000,y:0.800292,camp:-1},{id:'h103',x:0.332857,y:0.801749,camp:4},{id:'h104',x:0.732857,y:0.832362,camp:3},{id:'h105',x:0.275714,y:0.833819,camp:4},{id:'h106',x:0.502857,y:0.833819,camp:-1},{id:'h107',x:0.618571,y:0.833819,camp:3},{id:'h108',x:0.390000,y:0.835277,camp:4},{id:'h109',x:0.447143,y:0.867347,camp:4},{id:'h110',x:0.561429,y:0.867347,camp:3},{id:'h111',x:0.674286,y:0.867347,camp:3},{id:'h112',x:0.335714,y:0.868805,camp:4},{id:'h113',x:0.618571,y:0.899417,camp:3},{id:'h114',x:0.731429,y:0.899417,camp:3},{id:'h115',x:0.277143,y:0.902332,camp:4},{id:'h116',x:0.391429,y:0.902332,camp:4},{id:'h117',x:0.674286,y:0.932945,camp:3},{id:'h118',x:0.335714,y:0.934402,camp:4},{id:'h119',x:0.732857,y:0.966472,camp:3},{id:'h120',x:0.278571,y:0.969388,camp:4}];
const CHECKER_CAMPS=[
  ['h0','h3','h7','h6','h11','h16','h10','h15','h20','h23','h14','h19','h25','h27','h34'],
  ['h1','h4','h2','h13','h9','h5','h21','h17','h12','h8','h30','h26','h22','h18','h14'],
  ['h56','h48','h66','h41','h58','h74','h35','h50','h69','h80','h30','h43','h61','h73','h88'],
  ['h119','h117','h114','h113','h111','h104','h110','h107','h100','h95','h106','h102','h96','h91','h88'],
  ['h120','h115','h118','h105','h112','h116','h98','h103','h108','h109','h90','h94','h99','h101','h106'],
  ['h64','h53','h72','h47','h62','h79','h38','h54','h70','h85','h34','h44','h59','h78','h90']
];
const CHECKER_COLOR_LABELS={red:'紅色',blue:'藍色',green:'綠色'};
const CHECKER_COLOR_ARM={green:0,blue:2,red:4};
const CHECKER_COLORS=['red','blue','green'];
function checkerColorLabel(c){return CHECKER_COLOR_LABELS[c]||'待定';}
function checkerArm(di){return (CHECKER_CAMPS[di]||[]).slice();}
function checkerCamps(count){return CHECKER_CAMPS.map(c=>c.slice());}
function unusedCheckerColor(x){return CHECKER_COLORS.find(c=>!(x.checkerColorChoices||{})[c] && !(x.players||[]).some(p=>p.color===c))||null;}

function buildCheckerGraphs(){
  const neighbors=Object.fromEntries(CHECKER_HOLES.map(h=>[h.id,new Set()])); const jumps=Object.fromEntries(CHECKER_HOLES.map(h=>[h.id,new Map()]));
  const byId=new Map(CHECKER_HOLES.map(h=>[h.id,h]));
  const dirs=[[-.8660254,-.5],[0,-1],[.8660254,-.5],[.8660254,.5],[0,1],[-.8660254,.5]];
  for(const h of CHECKER_HOLES){
    const px=h.x*700,py=h.y*686;
    for(const [dx,dy] of dirs){
      let best=null;
      for(const n of CHECKER_HOLES){
        if(n.id===h.id)continue;
        const qx=n.x*700-px,qy=n.y*686-py,dist=Math.hypot(qx,qy);
        if(dist<37||dist>50)continue;
        const dot=(qx*dx+qy*dy)/dist;
        const ang=Math.acos(Math.max(-1,Math.min(1,dot)))*180/Math.PI;
        if(ang>14)continue;
        const score=ang*2+Math.abs(dist-44);
        if(!best||score<best.score)best={id:n.id,score};
      }
      if(best)neighbors[h.id].add(best.id);
    }
  }
  for(const id of Object.keys(neighbors))for(const n of neighbors[id])neighbors[n].add(id);
  for(const h of CHECKER_HOLES){
    const px=h.x*700,py=h.y*686;
    for(const n of neighbors[h.id]){
      const nh=byId.get(n);if(!nh)continue;
      const tx=px+2*(nh.x*700-px),ty=py+2*(nh.y*686-py);
      let best=null;
      for(const t of CHECKER_HOLES){
        const d=Math.hypot(t.x*700-tx,t.y*686-ty);
        if(!best||d<best.d)best={id:t.id,d};
      }
      if(best&&best.d<=9)jumps[h.id].set(best.id,n);
    }
  }
  return {
    neighbors:Object.fromEntries(Object.entries(neighbors).map(([k,v])=>[k,[...v]])),
    jumps:Object.fromEntries(Object.entries(jumps).map(([k,v])=>[k,[...v.entries()].map(([to,mid])=>({to,mid}))]))
  };
}
const CHECKER_GRAPH=buildCheckerGraphs();
const CHECKER_HOLE_SET=new Set(CHECKER_HOLES.map(h=>h.id));

// 跳棋 AI 以目標營地為方向，依棋孔圖的最短距離評分，避免無意義前後折返。
function buildCheckerCampDistances(){
  const result=[];
  for(const camp of CHECKER_CAMPS){
    const dist=Object.fromEntries(CHECKER_HOLES.map(h=>[h.id,Infinity]));
    const queue=[];
    for(const id of camp){dist[id]=0;queue.push(id);}
    for(let i=0;i<queue.length;i++){
      const cur=queue[i];
      const base=dist[cur];
      for(const n of checkerNeighbors(cur)){
        if(dist[n]===Infinity){dist[n]=base+1;queue.push(n);}
      }
    }
    result.push(dist);
  }
  return result;
}
let CHECKER_CAMP_DISTANCES=[];
CHECKER_CAMP_DISTANCES=buildCheckerCampDistances();

function checkerNeighbors(id){return CHECKER_GRAPH.neighbors[id]||[];}
function checkerJumpTargets(id){return (CHECKER_GRAPH.jumps[id]||[]).map(x=>x.to);}
function checkerPlayerByPid(x,pid){if(pid==='ai'&&x.ai)return{pid:'ai',name:'電腦',avatar:'🤖',color:x.aiColor||'blue',connected:true};return x.players.find(p=>p.pid===pid)||null;}
function checkerInit(x){
  const count=x.maxPlayers===3?3:2;
  const assigned=x.checkerColorByPid||{};
  const allCamps=Array.from({length:6},(_,di)=>checkerArm(di,count===2));
  x.checkerCamps=allCamps;
  x.players.forEach(p=>{
    const color=assigned[p.pid]||null;
    const arm=CHECKER_COLOR_ARM[color];
    p.color=color;p.camp=arm!=null?(allCamps[arm]||[]):[];p.targetCamp=arm!=null?(allCamps[(arm+3)%6]||[]):[];
  });
  if(x.ai){
    const aiColor=assigned.ai||x.aiColor||null;
    const arm=CHECKER_COLOR_ARM[aiColor];
    x.aiColor=aiColor;x.aiCamp=arm!=null?(allCamps[arm]||[]):[];x.aiTargetCamp=arm!=null?(allCamps[(arm+3)%6]||[]):[];
  }
  const board={};
  x.players.forEach((p)=>{if(!p.color)return;for(const id of p.camp||[])board[id]=p.color;});
  if(x.ai&&x.aiColor){for(const id of x.aiCamp||[])board[id]=x.aiColor;}
  x.g.board=board;x.g.camps=allCamps;x.g.holes=CHECKER_HOLES;x.g.turn=null;x.g.started=false;x.g.chain=null;x.g.turnDeadline=null;
  return Object.keys(board).length>0;
}
function checkerActivePlayers(x){return [...x.players.filter(p=>p.connected!==false),...(x.ai?[{pid:'ai',color:x.aiColor||'blue',connected:true}]:[])];}
function checkerCanStep(x,pid,from,to){const n=checkerNeighbors(from);if(!n.includes(to)||x.g.board[to])return false;return CHECKER_HOLE_SET.has(to);}
function checkerCanJump(x,from,to){
  const jump=(CHECKER_GRAPH.jumps[from]||[]).find(j=>j.to===to);
  return !!jump && !!x.g.board[jump.mid] && !x.g.board[to];
}
function checkerHasAnyMove(x,pid){
  const p=checkerPlayerByPid(x,pid);if(!p)return false;
  for(const [id,occ] of Object.entries(x.g.board)){
    if(occ!==p.color)continue;
    for(const n of checkerNeighbors(id))if(checkerCanStep(x,pid,id,n))return true;
    for(const to of checkerJumpTargets(id))if(checkerCanJump(x,id,to))return true;
  }
  return false;
}
function checkerWon(x,p){const target=p.targetCamp||(p.pid==='ai'?x.aiTargetCamp:[]),count=target.length;let filled=0;for(const id of target){const occ=x.g.board[id];if(occ===p.color)filled++;else if(occ){const blocker=(x.ai&&occ===x.aiColor)?checkerPlayerByPid(x,'ai'):x.players.find(q=>q.color===occ);if(blocker&&!checkerHasAnyMove(x,blocker.pid))filled++;}}return count>0&&filled>=count;}
function nextCheckerPid(x,pid){const ps=checkerActivePlayers(x),i=ps.findIndex(q=>q.pid===pid);return i<0?ps[0]?.pid:ps[(i+1)%ps.length]?.pid;}
function applyCheckers(x,p,m){
  const g=x.g;if(!g.started)return{error:'等待其他玩家加入'};if(g.winner)return{error:'遊戲已結束'};if(g.turn!==p.pid)return{error:'還沒輪到你'};
  const from=String(m.from||''),to=String(m.to||''),color=p.color;
  if(g.board[from]!==color)return{error:'只能移動自己的棋子'};if(g.board[to])return{error:'目標位置已有棋子'};if(!CHECKER_HOLE_SET.has(from)||!CHECKER_HOLE_SET.has(to))return{error:'無效棋孔'};
  const chain=g.chain&&g.chain.pid===p.pid;
  if(chain && from!==g.chain.pos)return{error:'連跳中必須使用同一顆棋子'};
  let kind=checkerCanStep(x,p.pid,from,to)?'step':checkerCanJump(x,from,to)?'jump':null;
  if(chain&&kind!=='jump')kind=null;
  if(!kind)return{error:chain?'連跳只能再跳躍，或按「停止連跳」':'只能單步或等距跳躍'};

  const before=clone(g);
  g.board[to]=g.board[from];delete g.board[from];
  g.history.push({n:g.move,color,from,to,kind});g.move++;x.undoStack.push(before);

  if(checkerWon(x,p)){
    g.winner=p.color;g.winnerPid=p.pid;
    g.endedReason=`${p.name} 已將全部棋子移入目標大本營，獲勝！`;
    g.turn=null;g.turnDeadline=null;g.chain=null;
    return{ok:true};
  }

  // 跳棋：同一顆棋如果還有合法跳躍，留在同一回合繼續連跳。
  // 每一次連跳都沿用同一個 30 秒回合倒數，不重置計時器。
  if(kind==='jump' && checkerHasAnyJump(x,to)){
    g.chain={pid:p.pid,pos:to};
    g.turn=p.pid;
    return{ok:true};
  }

  // 沒有下一個合法跳躍（或本手是普通走一步）才交棒給下一位。
  g.chain=null;
  g.turn=nextCheckerPid(x,p.pid);
  setTurnDeadline(x);
  return{ok:true};
}
function checkerHasAnyJump(x,from){for(const to of checkerJumpTargets(from))if(checkerCanJump(x,from,to))return true;return false;}
function stopCheckerChain(x,p){if(!x.g.chain||x.g.chain.pid!==p.pid)return{error:'目前沒有你的連跳回合'};x.g.chain=null;x.g.turn=nextCheckerPid(x,p.pid);setTurnDeadline(x);return{ok:true};}

function baseGame(mode){
  if(mode==='banqi'||mode==='darkbanqi'){
    return {mode,size:BANQI_ROWS,cols:BANQI_COLS,board:Array.from({length:BANQI_ROWS},()=>Array(BANQI_COLS).fill(null)),turn:null,winner:null,winnerPid:null,endedReason:null,history:[],move:1,turnDeadline:null,roundKey:eventId(),chain:null,started:false};
  }
  if(mode==='checkers'){
    return {mode,size:121,board:{},holes:CHECKER_HOLES,camps:[],turn:null,winner:null,winnerPid:null,endedReason:null,history:[],move:1,turnDeadline:null,roundKey:eventId(),chain:null,started:false};
  }
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
function resolveRpsChoices(x, choices){
  const entries=x.players.map(p=>({pid:p.pid,name:p.name,choice:choices[p.pid]})).filter(v=>v.choice);
  if(x.ai)entries.push({pid:'ai',name:'電腦',choice:choices.ai});
  if(entries.length<2)return null;
  const distinct=[...new Set(entries.map(e=>e.choice))];
  if(distinct.length===1)return {tie:true};
  if(distinct.length===3)return {tie:true};
  const a=distinct[0],b=distinct[1],winChoice=BEATS[a]===b?a:b;
  const winners=entries.filter(e=>e.choice===winChoice);
  if(winners.length!==1)return {tie:true};
  return {tie:false,winnerPid:winners[0].pid,winnerName:winners[0].name};
}
function resolveCheckersRps(x, choices){
  const ids=(x.rps.activePids||x.players.map(p=>p.pid).concat(x.ai?['ai']:[])).filter(id=>id==='ai'&&x.ai || x.players.some(p=>p.pid===id));
  const entries=ids.map(id=>{const p=id==='ai'?{pid:'ai',name:'電腦'}:x.players.find(q=>q.pid===id);return {pid:id,name:p?.name||'玩家',choice:choices[id]};}).filter(v=>v.choice);
  if(entries.length<ids.length)return null;
  if(ids.length===2){
    const r=resolveRpsChoices({...x,players:x.players.filter(p=>ids.includes(p.pid)),ai:x.ai&&ids.includes('ai')},choices);return r?{...r,activePids:ids}:r;
  }
  if(ids.length!==3)return null;
  const score=new Map(ids.map(id=>[id,0]));
  for(let i=0;i<entries.length;i++)for(let j=i+1;j<entries.length;j++){
    const a=entries[i],b=entries[j];if(a.choice===b.choice)continue;
    if(BEATS[a.choice]===b.choice)score.set(a.pid,score.get(a.pid)+1);else score.set(b.pid,score.get(b.pid)+1);
  }
  const ordered=[...ids].sort((a,b)=>score.get(b)-score.get(a));
  const top=score.get(ordered[0]),tiesTop=ordered.filter(id=>score.get(id)===top);
  if(tiesTop.length===3)return {tie:true,reset:true};
  if(tiesTop.length===2){
    const third=ordered.find(id=>!tiesTop.includes(id));
    x.rps.rankPrefix= [third];
    x.rps.rankPrefixAtEnd=true;
    x.rps.activePids=tiesTop;
    return {continue:true,message:'第一名平手，兩位玩家再猜拳決定前兩名。'};
  }
  const winner=ordered[0],rest=ordered.slice(1);
  // The remaining two are tied for 2nd/3rd and must decide their order.
  x.rps.rankPrefix=[winner];
  x.rps.rankPrefixAtEnd=false;
  x.rps.activePids=rest;
  return {continue:true,message:`${x.players.find(p=>p.pid===winner)?.name||'玩家'}取得第一名，剩餘兩位再猜拳決定第二、第三名。`};
}
function applyCheckersRpsResult(x,result){
  if(result?.tie){
    x.g.turn=null;x.rps={phase:'rps',choices:{},result:result.reset?'平手！三人重新猜拳':'平手！請再猜一次',winnerPid:null,activePids:x.players.map(p=>p.pid).concat(x.ai?['ai']:[])};broadcast(x);if(x.ai)setTimeout(()=>aiExtraRpsChoose(x),650);return;
  }
  if(result?.continue){
    x.g.turn=null;x.rps={...x.rps,phase:'rps',choices:{},result:result.message,winnerPid:null};return broadcast(x);
  }
  if(result?.winnerPid){
    const activeNow=x.rps.activePids||x.players.map(p=>p.pid).concat(x.ai?['ai']:[]);let rank=[result.winnerPid,...activeNow.filter(id=>id!==result.winnerPid)];
    if(x.rps.rankPrefixAtEnd && x.rps.rankPrefix?.length)rank=[...rank,...x.rps.rankPrefix.filter(id=>!rank.includes(id))];
    else if(x.rps.rankPrefix?.length)rank=[...x.rps.rankPrefix,...rank.filter(id=>!x.rps.rankPrefix.includes(id))];
    x.rps={...x.rps,phase:'choose-color',choices:{},result:`猜拳排名決定：第 1 名 ${nameByPid(x,rank[0])}，請依序選擇棋色。`,winnerPid:rank[0],rankOrder:rank,colorChoices:{},colorTurnIndex:0,colorTurnPid:rank[0],activePids:null};
    x.g.turn=null;x.g.started=false;return broadcast(x);
  }
}
function nameByPid(x,id){return id==='ai'?'電腦':x.players.find(p=>p.pid===id)?.name||'玩家';}
function aiChooseCheckerColor(x){
  if(!x.ai||x.rps?.phase!=='choose-color'||x.rps.colorTurnPid!=='ai')return false;
  // AI 選色冪等保護：如果前一次排程晚到，重新檢查目前真正的選色輪次。
  if(Object.values(x.rps.colorChoices||{}).includes('ai'))return true;
  const choices=Object.keys(x.rps.colorChoices||{});
  const color=CHECKER_COLORS.find(c=>!choices.includes(c))||'red';
  x.rps.colorChoices[color]='ai';
  x.checkerColorByPid=x.checkerColorByPid||{};
  x.checkerColorByPid.ai=color;
  x.aiColor=color;
  x.rps.colorTurnIndex=(x.rps.colorTurnIndex||0)+1;
  const idx=x.rps.colorTurnIndex;
  const rank=x.rps.rankOrder||[];

  if(idx<rank.length){
    x.rps.colorTurnPid=rank[idx];
    x.rps.result=`電腦選擇${checkerColorLabel(color)}；輪到${nameByPid(x,rank[idx])}選擇下一個顏色。`;
    broadcast(x);
    return true;
  }

  const order=rank.map(pid=>Object.entries(x.rps.colorChoices).find(([c,v])=>v===pid)?.[0]).filter(Boolean);
  x.checkerColorOrder=order;
  checkerInit(x);
  x.g.turn=rank[0];
  x.g.started=true;
  setTurnDeadline(x);
  x.rps.result=`選色完成：${rank.map((pid,i)=>`第${i+1}名 ${nameByPid(x,pid)}－${checkerColorLabel(order[i])}`).join('、')}`;
  x.rps.colorTurnPid=null;
  broadcast(x);
  if(x.g.turn==='ai')setTimeout(()=>aiTurn(x),450);
  return true;
}
function chooseCheckerColor(x,p,color){
  if(x.rps.phase!=='choose-color')return'目前不是選色階段';
  if(x.rps.colorTurnPid!==p.pid)return'現在不是你的選色順序';
  if(!CHECKER_COLORS.includes(color))return'跳棋只能選紅、藍、綠三色';
  const picked=Object.keys(x.rps.colorChoices||{});if(picked.includes(color))return'這個顏色已被選走';
  x.rps.colorChoices[color]=p.pid;x.checkerColorByPid=x.checkerColorByPid||{};x.checkerColorByPid[p.pid]=color;p.color=color;
  x.rps.colorTurnIndex=(x.rps.colorTurnIndex||0)+1;
  const idx=x.rps.colorTurnIndex;const rank=x.rps.rankOrder||[];
  // 3 人局：第一名選一色、第二名選一色，第三名直接使用最後剩下的顏色。
  if(rank.length===3 && idx===2){
    const remaining=CHECKER_COLORS.find(c=>!x.rps.colorChoices[c]);
    const thirdPid=rank[2];
    if(remaining){x.rps.colorChoices[remaining]=thirdPid;x.checkerColorByPid=x.checkerColorByPid||{};x.checkerColorByPid[thirdPid]=remaining;const third=x.players.find(q=>q.pid===thirdPid);if(third)third.color=remaining;}
    const order=rank.map(pid=>Object.entries(x.rps.colorChoices).find(([c,v])=>v===pid)?.[0]).filter(Boolean);
    x.checkerColorOrder=order;checkerInit(x);x.g.turn=rank[0];x.g.started=true;setTurnDeadline(x);
    x.rps.result=`選色完成：${rank.map((pid,i)=>`第${i+1}名 ${nameByPid(x,pid)}－${checkerColorLabel(order[i])}`).join('、')}。第三名使用剩餘顏色。`;
    x.rps.colorTurnPid=null;
    if(x.g.turn==='ai')setTimeout(()=>aiTurn(x),450);
    return null;
  }
  if(idx>=rank.length){
    const order=rank.map(pid=>Object.entries(x.rps.colorChoices).find(([c,v])=>v===pid)?.[0]).filter(Boolean);
    x.checkerColorOrder=order;checkerInit(x);x.g.turn=rank[0];x.g.started=true;setTurnDeadline(x);x.rps.result=`選色完成：${rank.map((pid,i)=>`第${i+1}名 ${nameByPid(x,pid)}－${checkerColorLabel(order[i])}`).join('、')}`;x.rps.colorTurnPid=null;
    if(x.g.turn==='ai')setTimeout(()=>aiTurn(x),450);
    return null;
  }
  x.rps.colorTurnPid=rank[idx];x.rps.result=`${p.name} 選擇${checkerColorLabel(color)}；輪到${nameByPid(x,rank[idx])}選擇下一個顏色。`;
  if(x.rps.colorTurnPid==='ai'){x.aiProgressLockUntil=0;setTimeout(()=>aiChooseCheckerColor(x),180);}
  return null;
}
function resolveRps(x){
  if(x.rps.phase!=='rps')return;
  if(x.mode==='checkers'){
    const result=resolveCheckersRps(x,x.rps.choices);if(!result)return;
    if(result.continue){x.g.turn=null;x.rps.result=result.message; x.rps.choices={}; return broadcast(x);}
    return applyCheckersRpsResult(x,result);
  }
  const result=resolveRpsChoices(x,x.rps.choices);if(!result)return;
  if(result.tie){x.g.turn=null;x.rps={phase:'rps',choices:{},result:'平手！請再猜一次',winnerPid:null};return broadcast(x);}
  x.g.turn=null;
  if(isExtraMode(x.mode)){
    x.rps={phase:'done',choices:x.rps.choices,result:`${result.winnerName} 猜拳獲勝！由他先手。`,winnerPid:result.winnerPid};
    x.g.turn=result.winnerPid;x.g.started=true;setTurnDeadline(x);return broadcast(x);
  }
  x.rps={phase:'choose-color',choices:{},result:`${result.winnerName} 猜拳獲勝！請選擇${x.mode==='xiangqi'?'紅方／黑方':'黑方／白方'}。`,winnerPid:result.winnerPid};broadcast(x);
}
function beginExtraAfterRps(x,winnerPid){
  x.rps.phase='done';x.rps.winnerPid=winnerPid;
  x.g.turn=winnerPid;x.g.started=true;setTurnDeadline(x);
  if(x.mode==='checkers'&&x.g.board && Object.keys(x.g.board).length===0)checkerInit(x);
  x.g.turn=winnerPid;setTurnDeadline(x);
}
function resolveAiExtraRps(x){
  if(!x.ai||x.rps?.phase!=='rps'||!x.players.length)return;
  if(x.mode==='checkers' && x.players.length===1){
    // 單人人機跳棋：AI 永遠紅色、玩家永遠藍色；猜拳只決定先手，不存在選色階段。
    const human=x.players[0], choices=x.rps.choices||{};
    if(!choices.ai || !choices[human.pid])return;
    if(choices.ai===choices[human.pid]){
      x.g.turn=null;
      x.rps={phase:'rps',choices:{},result:'平手！請再猜一次',winnerPid:null,activePids:[human.pid,'ai']};
      broadcast(x);setTimeout(()=>aiExtraRpsChoose(x),650);return;
    }
    const winnerPid=BEATS[choices[human.pid]]===choices.ai?human.pid:'ai';
    human.color='blue';x.aiColor='red';x.checkerColorByPid={[human.pid]:'blue',ai:'red'};x.checkerColorOrder=['red','blue'];
    checkerInit(x);x.g.turn=winnerPid;x.g.started=true;setTurnDeadline(x);
    x.rps={phase:'done',choices,result:`${winnerPid==='ai'?'電腦':'你'} 猜拳獲勝！${winnerPid==='ai'?'電腦（紅色）':'你（藍色）'}先手。`,winnerPid};
    broadcast(x);if(winnerPid==='ai')setTimeout(()=>aiTurn(x),450);return;
  }
  if(x.mode==='checkers'){
    const result=resolveCheckersRps(x,x.rps.choices);if(!result)return;
    if(result.continue){x.g.turn=null;x.rps={...x.rps,phase:'rps',choices:{},result:result.message};broadcast(x);if(x.ai)setTimeout(()=>aiExtraRpsChoose(x),650);return;}
    if(result.tie){x.g.turn=null;x.rps={phase:'rps',choices:{},result:result.reset?'平手！三人重新猜拳':'平手！請再猜一次',winnerPid:null,activePids:x.players.map(p=>p.pid).concat(x.ai?['ai']:[])};broadcast(x);if(x.ai)setTimeout(()=>aiExtraRpsChoose(x),650);return;}
    applyCheckersRpsResult(x,result);
    if(x.rps.phase==='choose-color'&&x.rps.colorTurnPid==='ai')setTimeout(()=>aiChooseCheckerColor(x),350);
    return;
  }
  const result=resolveRpsChoices(x,x.rps.choices);if(!result)return;
  if(result.tie){x.rps={phase:'rps',choices:{},result:'平手！請再猜一次',winnerPid:null};broadcast(x);return setTimeout(()=>aiExtraRpsChoose(x),650);}
  x.g.turn=result.winnerPid;x.rps={phase:'done',choices:x.rps.choices,result:`${result.winnerName} 猜拳獲勝！先手。`,winnerPid:result.winnerPid};x.g.started=true;setTurnDeadline(x);broadcast(x);
  if(x.g.turn==='ai')setTimeout(()=>aiTurn(x),450);
}
function aiExtraRpsChoose(x){
  if(!x.ai||x.rps?.phase!=='rps'||!x.players.length)return false;
  if(x.rps.choices?.ai)return true;
  x.rps.choices.ai=['剪刀','石頭','布'][Math.floor(Math.random()*3)];
  resolveAiExtraRps(x);
  broadcast(x);
  return true;
}

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
function aiProgressTick(x){
  if(!x?.ai||x.g?.winner)return;
  const now=Date.now();
  if(now < (x.aiProgressLockUntil||0))return;
  if(x.rps?.phase==='rps'){
    if(!x.rps.choices?.ai){
      x.aiProgressLockUntil=now+300;
      aiExtraRpsChoose(x);
    }
    return;
  }
  if(x.rps?.phase==='choose-color' && x.mode==='checkers' && x.rps.colorTurnPid==='ai'){
    x.aiProgressLockUntil=now+300;
    aiChooseCheckerColor(x);
    return;
  }
  if(x.rps?.phase==='done' && x.g?.turn==='ai'){
    aiTurn(x);
  }
}
function armAIWatchdog(x){
  if(!x?.ai||x.aiWatchdogTimer)return;
  x.aiWatchdogTimer=setInterval(()=>{
    if(x.g?.winner){clearInterval(x.aiWatchdogTimer);x.aiWatchdogTimer=null;return;}
    aiProgressTick(x);
  },400);
}
function createRoom(mode,matchmade=false,ai=false,maxPlayers=null){
  mode=normalizeMode(mode);
  const cap=mode==='checkers'?(maxPlayers===3?3:2):2;
  const x={id:rid(),mode,ai,players:[],spectators:[],maxPlayers:cap,g:newGame(mode),rps:newRps(),difficulty:null,undoStack:[],checkEvent:null,proposal:null,rematchInvite:null,chat:[],matchmade:!!matchmade,checkerCamps:[],checkerColorByPid:{},aiTurnRetries:0,aiWatchdogTimer:null,aiNextAt:0,aiLastMove:null,aiReverseCount:0};
  if(isBanqi(mode))initBanqiBoard(x.g);
  if(mode==='checkers')x.g.holes=CHECKER_HOLES;
  if(ai)armAIWatchdog(x);
  rooms.set(x.id,x);return x;
}
function playerList(x){return x.players.map(p=>({pid:p.pid,name:p.name,avatar:p.avatar,color:p.color||null,connected:p.connected!==false,camp:p.camp||null,targetCamp:p.targetCamp||null})).concat(x.ai?[{pid:'ai',name:'電腦',avatar:'🤖',color:x.mode==='xiangqi'?'black':x.mode==='checkers'?(x.aiColor||'blue'):(x.aiColor||'white'),connected:true,camp:x.mode==='checkers'?(x.aiCamp||null):null,targetCamp:x.mode==='checkers'?(x.aiTargetCamp||null):null}]:[]);}
function send(p,o){if(p?.ws?.readyState===1)p.ws.send(JSON.stringify(o));}
function setTurnDeadline(x){x.g.turnDeadline=x.g.turn?Date.now()+TURN_SECONDS*1000:null;}
function publicSnapshot(x,p){
  const spectator=p.role==='spectator';
  const rps=x.rps?{phase:x.rps.phase,result:x.rps.result||null,winnerPid:x.rps.winnerPid||null,isRpsWinner:!spectator&&x.rps.winnerPid===p.pid,youChoice:!spectator?(x.rps.choices?.[p.pid]||null):null,hasOpponentChoice:spectator?false:(x.players.some(q=>q.pid!==p.pid&&x.rps.choices?.[q.pid])||(x.ai&&p.pid!=='ai'&&!!x.rps.choices?.ai))}:null;
  return {type:'state',roomId:spectator?x.id:(x.ai||x.matchmade?null:x.id),spectatorCode:x.id,matchmade:!!x.matchmade,mode:spectator?'spectator':(x.ai?'ai':'online'),gameMode:x.mode,difficulty:x.difficulty||null,color:spectator?null:(p.color||null),turn:x.g.turn,winner:x.g.winner,winnerPid:x.g.winnerPid||null,endedReason:x.g.endedReason||null,size:x.g.size,rows:x.g.rows||x.g.size,cols:x.g.cols||null,board:x.g.b||x.g.board,holes:x.g.holes||CHECKER_HOLES,camps:x.g.camps||x.checkerCamps||[],maxPlayers:x.maxPlayers||2,started:!!x.g.started,history:x.g.history,move:x.g.move,turnDeadline:x.g.turnDeadline,players:playerList(x),spectators:x.spectators?.length||0,rps:{...rps,activePids:x.rps?.activePids||null,rankOrder:x.rps?.rankOrder||null,colorChoices:x.rps?.colorChoices||{},colorTurnPid:x.rps?.colorTurnPid||null,rankPrefix:x.rps?.rankPrefix||null},roundKey:x.g.roundKey,chat:x.chat||[],checkEvent:x.checkEvent||null,rematch:spectator?null:(x.rematchInvite?{pendingForMe:x.rematchInvite.toPid===p.pid,pendingByMe:x.rematchInvite.fromPid===p.pid}:null),proposal:spectator?null:(x.proposal?{kind:x.proposal.kind,fromPid:x.proposal.fromPid,fromName:x.proposal.fromName,toPid:x.proposal.toPid}:null),avatar:p.avatar,captures:x.g.captures||null,passStreak:x.g.passStreak||0,goPhase:x.g.phase||null,deadGroups:x.g.deadGroups||[],scoreConfirm:x.g.scoreConfirm||{},score:x.g.score||null,chain:x.g.chain||null};
}
function broadcast(x){[...x.players,...(x.spectators||[])].forEach(p=>send(p,publicSnapshot(x,p)));}
function broadcastLobbySync(x){
  const payload={type:'lobby-sync',roomId:x.id,matchmade:!!x.matchmade,gameMode:x.mode,maxPlayers:x.maxPlayers||2,players:playerList(x),spectators:(x.spectators||[]).length};
  for(const p of x.players)send(p,payload);
}
function broadcastMatchmakingWaiting(item){send(item.p,{type:'matchmaking',status:'searching',mode:item.mode});}
function removeFromMatchmaking(p){for(let i=matchmakingQueue.length-1;i>=0;i--)if(matchmakingQueue[i].p===p)matchmakingQueue.splice(i,1);}
function tryMatchmaking(){
  for(let i=0;i<matchmakingQueue.length;i++){
    const first=matchmakingQueue[i];if(!first||first.cancelled||first.p.ws.readyState!==1){matchmakingQueue.splice(i--,1);continue;}
    const need=first.capacity||2;if(need<=2){let j=-1;for(let k=i+1;k<matchmakingQueue.length;k++){const cand=matchmakingQueue[k];if(!cand||cand.cancelled||cand.p.ws.readyState!==1)continue;if(cand.mode===first.mode&&(cand.capacity||2)===need){j=k;break;}}if(j<0)continue;const second=matchmakingQueue[j];matchmakingQueue.splice(j,1);matchmakingQueue.splice(i,1);i--;const x=createRoom(first.mode,true,false,need);first.p.color=null;second.p.color=null;x.players.push(first.p,second.p);first.assign(x);second.assign(x);if(first.mode==='checkers'){x.g.board={};x.g.turn=null;x.g.started=false;}send(first.p,{type:'room',roomId:null,pid:first.p.pid,color:first.p.color||null,mode:'online',gameMode:x.mode,matchmade:true,spectatorCode:x.id});send(second.p,{type:'room',roomId:null,pid:second.p.pid,color:second.p.color||null,mode:'online',gameMode:x.mode,matchmade:true,spectatorCode:x.id});broadcast(x);continue;}
    const group=[first];for(let k=i+1;k<matchmakingQueue.length&&group.length<need;k++){const cand=matchmakingQueue[k];if(!cand||cand.cancelled||cand.p.ws.readyState!==1)continue;if(cand.mode===first.mode&&(cand.capacity||2)===need)group.push(cand);}
    if(group.length<need)continue;
    for(const item of group){const idx=matchmakingQueue.indexOf(item);if(idx>=0)matchmakingQueue.splice(idx,1);}
    const x=createRoom(first.mode,true,false,need);group.forEach(it=>{it.assign(x);it.p.color=null;x.players.push(it.p)});if(first.mode==='checkers'){x.g.board={};x.g.turn=null;x.g.started=false;}else if(isBanqi(first.mode)){x.g.started=true;x.g.turn=x.players[0].pid;setTurnDeadline(x);}
    group.forEach(it=>send(it.p,{type:'room',roomId:null,pid:it.p.pid,color:it.p.color||null,mode:'online',gameMode:x.mode,matchmade:true,spectatorCode:x.id}));broadcast(x);i=-1;
  }
}
function resetOnlineRound(x){x.g=newGame(x.mode);x.players.forEach(p=>{p.color=null;p.camp=null;p.targetCamp=null});x.rps=newRps();x.rps.activePids=x.players.map(p=>p.pid);x.rematchInvite=null;x.proposal=null;x.checkEvent=null;x.chat=[];if(isBanqi(x.mode))initBanqiBoard(x.g);if(x.mode==='checkers'){x.g.board={};x.g.turn=null;x.g.started=false;x.checkerColorOrder=[];} }
function choosePalette(mode){return mode==='xiangqi'?['red','black']:['black','white'];}
function chooseColor(x,p,color){
  if(x.rps.phase!=='choose-color')return'目前不是選色階段';if(x.rps.winnerPid!==p.pid)return'你是猜拳落敗者，請等待對方選色';
  const palette=choosePalette(x.mode);if(!palette.includes(color))return'顏色無效';
  const loser=x.players.find(q=>q.pid!==p.pid);p.color=color;loser.color=palette.find(c=>c!==color);x.rps.phase='done';x.rps.result=`${p.name} 選擇${x.mode==='xiangqi'?(color==='red'?'紅方':'黑方'):(color==='black'?'黑方':'白方')}，猜拳獲勝者先手。`;x.g.turn=p.color;setTurnDeadline(x);return null;
}
function timeOut(x){
  if(x.g.winner||!x.g.turn)return;
  if(isExtraMode(x.mode)){
    const loserPid=x.g.turn,next=isBanqi(x.mode)?banqiNextPid(x,loserPid):nextCheckerPid(x,loserPid);
    const winnerP=banqiPlayerByPid(x,next);x.g.winner=isBanqi(x.mode)?winnerP?.color:'p'+(x.players.findIndex(p=>p.pid===next));x.g.winnerPid=next||null;x.endedReason=`${banqiPlayerByPid(x,loserPid)?.name||'玩家'} 超時，${winnerP?.name||'下一位玩家'}獲勝！`;x.g.turn=null;x.g.turnDeadline=null;broadcast(x);return;
  }
  const loser=x.g.turn,winner=x.mode==='xiangqi'?(loser==='red'?'black':'red'):(loser==='black'?'white':'black');
  x.g.winner=winner;x.g.winnerPid=x.ai&&winner===x.players[0].color?x.players[0].pid:(!x.ai?x.players.find(p=>p.color===winner)?.pid:null);x.endedReason=`${loser}方超時，${winner}方獲勝！`;x.g.turnDeadline=null;broadcast(x);
}
function applyOnlineMove(x,p,m){
  if(isExtraMode(x.mode)&&x.rps?.phase==='rps')return{error:'目前正在猜拳階段，請先完成猜拳。'};
  if(isExtraMode(x.mode)&&x.rps?.phase==='choose-color')return{error:x.mode==='checkers'?'目前正在選擇跳棋顏色，請等待輪到你選色。':'目前正在選擇棋子顏色，請先完成選色。'};
  if(isExtraMode(x.mode)){
    if(x.mode==='checkers')return applyCheckers(x,p,m);
    if(m.subaction) m.action=m.subaction;
    return applyBanqi(x,p,m);
  }
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
function aiColor(x){return x.mode==='xiangqi'?'black':x.mode==='gomoku'||x.mode==='go'?'white':x.aiColor||'p1';}

function banqiAICaptureCandidates(x,p){
  const g=x.g,c=[];
  for(let r=0;r<BANQI_ROWS;r++)for(let col=0;col<BANQI_COLS;col++){
    const me=g.board[r][col];if(!me||!me.revealed||me.color!==p.color)continue;
    if(me.type==='cannon'){
      for(let rr=0;rr<BANQI_ROWS;rr++)for(let cc=0;cc<BANQI_COLS;cc++){
        const t=g.board[rr][cc];if(!t||t.color===me.color)continue;
        const test=t.revealed?t:Object.assign({},t,{revealed:true});
        if(banqiCaptureRule(me,test,g.board,r,col,rr,cc))c.push({action:'capture',r,c:col,toR:rr,toC:cc,score:t.revealed?200:180});
      }
    }else{
      for(const [dr,dc] of [[1,0],[-1,0],[0,1],[0,-1]]){
        const rr=r+dr,cc=col+dc;if(rr<0||rr>=BANQI_ROWS||cc<0||cc>=BANQI_COLS)continue;
        const t=g.board[rr][cc];if(!t||t.color===me.color)continue;
        if(x.mode==='banqi'&&!t.revealed)continue;
        const test=t.revealed?t:Object.assign({},t,{revealed:true});
        if(banqiCaptureRule(me,test,g.board,r,col,rr,cc))c.push({action:'capture',r,c:col,toR:rr,toC:cc,score:100+BANQI_RANK[test.type]});
        else if(x.mode==='darkbanqi'&&!t.revealed&&!banqiCanEat(me,test))c.push({action:'capture',r,c:col,toR:rr,toC:cc,score:70});
      }
    }
  }
  return c;
}
function banqiAIAllCandidates(x,p){
  const g=x.g,c=[];
  // 翻棋：所有未翻開棋都算合法候選，不因某一顆已翻開棋無法動就放棄整回合。
  for(let r=0;r<BANQI_ROWS;r++)for(let col=0;col<BANQI_COLS;col++){
    const t=g.board[r][col];
    if(t&&!t.revealed)c.push({action:'flip',r,c:col,toR:r,toC:col,score:40+Math.random()*4});
  }
  // 所有己方已翻開棋：逐顆檢查「走一步」與「吃棋」。
  for(let r=0;r<BANQI_ROWS;r++)for(let col=0;col<BANQI_COLS;col++){
    const me=g.board[r][col];
    if(!me||!me.revealed||me.color!==p.color)continue;
    // 普通移動
    if(me.type!=='cannon'){
      for(const [dr,dc] of [[1,0],[-1,0],[0,1],[0,-1]]){
        const rr=r+dr,cc=col+dc;
        if(rr<0||rr>=BANQI_ROWS||cc<0||cc>=BANQI_COLS||g.board[rr][cc])continue;
        c.push({action:'move',r,c:col,toR:rr,toC:cc,score:10+Math.random()*3});
      }
    } else {
      // 炮也可以走到相鄰空格，但吃棋必須走「飛吃」規則。
      for(const [dr,dc] of [[1,0],[-1,0],[0,1],[0,-1]]){
        const rr=r+dr,cc=col+dc;
        if(rr<0||rr>=BANQI_ROWS||cc<0||cc>=BANQI_COLS||g.board[rr][cc])continue;
        c.push({action:'move',r,c:col,toR:rr,toC:cc,score:9+Math.random()*3});
      }
    }
    // 直向四鄰吃棋；炮則檢查所有直線敵棋＋恰好一枚炮架。
    if(me.type==='cannon'){
      for(let rr=0;rr<BANQI_ROWS;rr++)for(let cc=0;cc<BANQI_COLS;cc++){
        const t=g.board[rr][cc];if(!t||t.color===me.color)continue;
        const test=t.revealed?t:Object.assign({},t,{revealed:true});
        if(banqiCaptureRule(me,test,g.board,r,col,rr,cc))c.push({action:'capture',r,c:col,toR:rr,toC:cc,score:120+(t.revealed?20:10)+Math.random()*3});
        else if(x.mode==='darkbanqi'&&!t.revealed)c.push({action:'capture',r,c:col,toR:rr,toC:cc,score:80+Math.random()*3});
      }
    }else{
      for(const [dr,dc] of [[1,0],[-1,0],[0,1],[0,-1]]){
        const rr=r+dr,cc=col+dc;
        if(rr<0||rr>=BANQI_ROWS||cc<0||cc>=BANQI_COLS)continue;
        const t=g.board[rr][cc];if(!t||t.color===me.color)continue;
        if(x.mode==='banqi'&&!t.revealed)continue;
        const test=t.revealed?t:Object.assign({},t,{revealed:true});
        if(banqiCaptureRule(me,test,g.board,r,col,rr,cc))c.push({action:'capture',r,c:col,toR:rr,toC:cc,score:100+BANQI_RANK[test.type]+Math.random()*4});
        else if(x.mode==='darkbanqi'&&!t.revealed)c.push({action:'capture',r,c:col,toR:rr,toC:cc,score:t.color===me.color?95:70+Math.random()*3});
      }
    }
  }
  return c;
}

function aiBanqiAction(x){
  const p={pid:'ai',name:'電腦',color:x.aiColor},g=x.g;
  if(!p.color){
    const covered=[];for(let r=0;r<BANQI_ROWS;r++)for(let c=0;c<BANQI_COLS;c++)if(g.board[r][c]&&!g.board[r][c].revealed)covered.push([r,c]);
    if(covered.length){const [r,c]=covered[Math.floor(Math.random()*covered.length)];return applyBanqi(x,p,{action:'flip',r,c});}
    return{error:'沒有可翻棋子'};
  }
  // 連吃中只能使用目前那一顆；這是規則限制，不代表其他棋子沒有合法動作。
  if(g.chain?.pid==='ai'){
    const fromR=g.chain.r,fromC=g.chain.c,me=g.board[fromR]?.[fromC],cands=[];
    if(me){
      if(me.type==='cannon'){
        for(let rr=0;rr<BANQI_ROWS;rr++)for(let cc=0;cc<BANQI_COLS;cc++){
          const t=g.board[rr][cc];if(!t||t.color===me.color)continue;
          const test=t.revealed?t:Object.assign({},t,{revealed:true});
          if(banqiCaptureRule(me,test,g.board,fromR,fromC,rr,cc))cands.push({action:'capture',r:fromR,c:fromC,toR:rr,toC:cc,score:120});
        }
      }else{
        for(const [dr,dc] of [[1,0],[-1,0],[0,1],[0,-1]]){
          const rr=fromR+dr,cc=fromC+dc;if(rr<0||rr>=BANQI_ROWS||cc<0||cc>=BANQI_COLS)continue;
          const t=g.board[rr][cc];if(!t)continue;
          const test=t.revealed?t:Object.assign({},t,{revealed:true});
          if(t.revealed){
            if(t.color!==me.color&&banqiCaptureRule(me,test,g.board,fromR,fromC,rr,cc))cands.push({action:'capture',r:fromR,c:fromC,toR:rr,toC:cc,score:120});
          }else if(x.mode==='darkbanqi'){
            cands.push({action:'capture',r:fromR,c:fromC,toR:rr,toC:cc,score:t.color===me.color?95:banqiCanEat(me,test)?105:90});
          }
        }
      }
    }
    if(!cands.length)return stopBanqiChain(x,p);
    cands.sort((a,b)=>b.score-a.score);
    return applyBanqi(x,p,cands[0]);
  }
  // 正常回合：把「所有己方棋子」的合法候選一次建完，再逐個嘗試。
  // 因此不會因某一支棋不能走，就錯誤判定 AI 整回合沒有合法走法。
  const candidates=banqiAIAllCandidates(x,p);
  if(!candidates.length)return{error:'AI 沒有合法動作'};
  candidates.sort((a,b)=>b.score-a.score);
  const pool=x.difficulty==='hard'?candidates.slice(0,Math.min(40,candidates.length)):
             x.difficulty==='easy'?candidates.slice(0,Math.min(candidates.length,20)):
             candidates.slice(0,Math.min(24,candidates.length));
  // 依難度混入少量隨機，避免每局完全固定；但每一個候選都會經過伺服器合法檢查。
  for(let i=0;i<pool.length;i++){
    const j=x.difficulty==='hard'?i:Math.floor(Math.random()*pool.length);
    const pick=pool[j]||pool[i];
    const res=applyBanqi(x,p,pick);
    if(res?.ok)return res;
    pool.splice(j,1);
    if(!pool.length)break;
  }
  return{error:'AI 已檢查全部候選，但目前沒有可執行的合法行動'};
}

function checkerGoalDistance(x,id,color){
  const arm=CHECKER_COLOR_ARM[color];
  const target=(arm!=null?x.checkerCamps?.[(arm+3)%6]:null)||[];
  if(!target.length)return Infinity;
  const map=CHECKER_CAMP_DISTANCES?.[(arm+3)%6];
  return map&&Number.isFinite(map[id])?map[id]:Infinity;
}
function aiCheckersMove(x){
  const p={pid:'ai',name:'電腦',color:x.aiColor||'red'},g=x.g;
  if(!p.color)return null;
  const moves=[],last=x.aiLastMove||null;
  const chainPos=g.chain?.pid==='ai'?g.chain.pos:null;
  const reverseCount=Number(x.aiReverseCount||0);

  const addMovesForPiece=(id,allowStep)=>{
    if(g.board[id]!==p.color)return;
    if(allowStep){
      for(const to of checkerNeighbors(id))if(checkerCanStep(x,'ai',id,to)){
        const d0=checkerGoalDistance(x,id,p.color),d1=checkerGoalDistance(x,to,p.color);
        const progress=Number.isFinite(d0)&&Number.isFinite(d1)?d0-d1:0;
        let score=progress*30-2+Math.random()*2;
        const reversing=!!(last&&last.from===to&&last.to===id);
        if(reversing&&reverseCount>=2)continue;
        if(reversing)score-=220;
        moves.push({from:id,to,kind:'step',score});
      }
    }
    for(const to of checkerJumpTargets(id))if(checkerCanJump(x,id,to)){
      const d0=checkerGoalDistance(x,id,p.color),d1=checkerGoalDistance(x,to,p.color);
      const progress=Number.isFinite(d0)&&Number.isFinite(d1)?d0-d1:0;
      let score=85+progress*36+Math.random()*2;
      if(d1===0)score+=220;
      const reversing=!!(last&&last.from===to&&last.to===id);
      if(reversing&&reverseCount>=2)continue;
      if(reversing)score-=320;
      // 連跳中更偏好能繼續形成跳躍的落點，避免不必要折返。
      if(chainPos && checkerHasAnyJump(x,to))score+=140;
      moves.push({from:id,to,kind:'jump',score});
    }
  };

  if(chainPos){
    // AI 連跳時只能使用同一顆棋，且只能再跳。
    addMovesForPiece(chainPos,false);
  }else{
    for(const [id,occ] of Object.entries(g.board))if(occ===p.color)addMovesForPiece(id,true);
  }

  if(!moves.length)return null;
  moves.sort((a,b)=>b.score-a.score);
  let pick=moves[0];
  if(x.difficulty==='easy')pick=moves[Math.floor(Math.random()*Math.min(6,moves.length))];
  else if(x.difficulty==='normal')pick=moves[Math.floor(Math.random()*Math.min(3,moves.length))];
  const res=applyCheckers(x,p,{from:pick.from,to:pick.to});
  if(res?.ok){
    const reversing=!!(last&&last.from===pick.to&&last.to===pick.from);
    x.aiReverseCount=reversing?reverseCount+1:0;
    x.aiLastMove={from:pick.from,to:pick.to,kind:pick.kind};
  }
  return res;
}

function aiTurn(x){
  if(!x.ai||x.g.winner)return;
  if(Date.now()<(x.aiNextAt||0))return;
  // 防止同一回合被多個延遲任務重入。只要輪到 AI，就重新從當前盤面產生合法動作。
  x.aiTurnStartedAt=Date.now();
  if(isBanqi(x.mode)){
    if(x.g.turn!=='ai')return;
    const res=aiBanqiAction(x);
    if(res?.ok){x.aiTurnRetries=0;x.aiNextAt=Date.now()+(x.g.chain?.pid==='ai'?330:420);broadcast(x);if(x.g.chain?.pid==='ai')setTimeout(()=>aiTurn(x),350);else if(x.g.turn==='ai')setTimeout(()=>aiTurn(x),450);return;}
    x.aiTurnRetries=(x.aiTurnRetries||0)+1;
    if(x.aiTurnRetries<=8&&x.g.turn==='ai'){setTimeout(()=>aiTurn(x),180);return;}
    x.aiTurnRetries=0;
    if(x.g.turn==='ai'&&!x.g.winner){
      x.g.winner=x.players[0]?.color||'red';x.g.winnerPid=x.players[0]?.pid||null;
      x.g.endedReason='電腦無法完成合法行動，你獲勝！';x.g.turn=null;x.g.turnDeadline=null;broadcast(x);
    }
    return;
  }
  if(x.mode==='checkers'){
    if(x.g.turn!=='ai')return;
    const res=aiCheckersMove(x);
    if(res?.ok){x.aiTurnRetries=0;x.aiNextAt=Date.now()+(x.g.chain?.pid==='ai'?330:420);broadcast(x);if(x.g.chain?.pid==='ai')setTimeout(()=>aiTurn(x),350);else if(x.g.turn==='ai')setTimeout(()=>aiTurn(x),450);return;}
    x.aiTurnRetries=(x.aiTurnRetries||0)+1;
    if(x.aiTurnRetries<=8&&x.g.turn==='ai'){setTimeout(()=>aiTurn(x),180);return;}
    x.aiTurnRetries=0;
    if(x.g.turn==='ai'&&!x.g.winner){x.g.winner=x.players[0]?.color||'red';x.g.winnerPid=x.players[0]?.pid||null;x.g.endedReason='電腦無法完成合法行動，你獲勝！';x.g.turn=null;x.g.turnDeadline=null;broadcast(x);}
    return;
  }
  const ac=aiColor(x);if(x.g.turn!==ac)return;const fake={pid:'ai',color:ac};let move=null;
  if(x.mode==='xiangqi'){
    const moves=[];const p={color:'black'};for(let r=0;r<10;r++)for(let c=0;c<9;c++)if(x.g.b[r][c]&&own(x.g.b[r][c].t,'black'))for(let rr=0;rr<10;rr++)for(let cc=0;cc<9;cc++)if(!legalXQ(x.g,p,r,c,rr,cc))moves.push({r1:r,c1:c,r2:rr,c2:cc});
    if(!moves.length){x.g.winner='red';x.g.winnerPid=x.players[0].pid;x.g.endedReason='電腦無合法走法，你獲勝！';x.g.turnDeadline=null;broadcast(x);return;}move=moves[Math.floor(Math.random()*moves.length)];
  } else if(x.mode==='gomoku'){const a=aiGomokuMove(x.g,x.difficulty,ac);if(a)move={r:a[0],c:a[1]};}
  else {const mv=aiGoMove(x,x.difficulty);if(mv)move={r:mv.r,c:mv.c};}
  if(x.mode==='go'&&move===null){passGo(x,fake);broadcast(x);return;}
  const res=applyOnlineMove(x,fake,move);if(res.ok){x.aiNextAt=Date.now()+420;const checkId=x.checkEvent?.id;broadcast(x);if(checkId)setTimeout(()=>{if(x.checkEvent?.id===checkId){x.checkEvent=null;broadcast(x);}},1500);}
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
    if(x.mode==='xiangqi'||isExtraMode(x.mode)){x.g=clone(prev);if(x.mode==='checkers')x.g.holes=CHECKER_HOLES;}else if(x.mode==='go'){restoreGoState(x.g,prev);}else{x.g.board=clone(prev.board);x.g.history=clone(prev.history);x.g.turn=prev.turn;x.g.move=prev.move||Math.max(1,x.g.history.length+1);x.g.winner=null;x.g.winnerPid=null;x.g.endedReason=null;}
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
  const mime={'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8','.png':'image/png','.webp':'image/webp'}[path.extname(file)]||'application/octet-stream';
  res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store'});fs.createReadStream(file).pipe(res);
});
const wss=new WebSocketServer({server});
wss.on('connection',ws=>{
  let x=null,p=null;
  ws.on('message',raw=>{
    let m;try{m=JSON.parse(raw)}catch{return}
    if(m.action==='create'){
      const mode=normalizeMode(m.mode),cap=mode==='checkers'?[2,3,4,6].includes(Number(m.playerCount))?Number(m.playerCount):2:2;x=createRoom(mode,false,false,cap);p={ws,pid:pid(),role:'player',profileId:String(m.profileId||''),name:String(m.name||'玩家1').slice(0,12),avatar:normalizeAvatar(m.avatar),color:null,connected:true};x.players.push(p);if(mode==='banqi'||mode==='darkbanqi')x.g.turn=p.pid;
      send(p,{type:'room',roomId:x.id,pid:p.pid,color:null,mode:'online',gameMode:mode,matchmade:false,spectatorCode:x.id});send(p,publicSnapshot(x,p));broadcastLobbySync(x);
    }else if(m.action==='watch'){
      if(x||p)return send({ws},{type:'error',message:'你目前已有一個連線中的對局，請先離開。'});
      const code=String(m.roomId||'').trim().toUpperCase();
      x=rooms.get(code);
      if(!x)return send({ws},{type:'error',message:'找不到這個觀戰房間。'});
      if(!x.ai&&!isExtraMode(x.mode)&&x.rps?.phase!=='done')return send({ws},{type:'error',message:'這場對局尚未開始，請等雙方完成猜拳與選色後再觀戰。'});
      p={ws,pid:pid(),role:'spectator',profileId:String(m.profileId||''),name:String(m.name||'觀戰者').slice(0,12),avatar:normalizeAvatar(m.avatar),color:null,connected:true};x.spectators.push(p);
      send(p,{type:'room',roomId:x.id,pid:p.pid,color:null,mode:'spectator',gameMode:x.mode,matchmade:!!x.matchmade,spectatorCode:x.id});send(p,publicSnapshot(x,p));broadcast(x);
    }else if(m.action==='matchmake'){
      if(x||p)return send({ws},{type:'error',message:'你已在房間中'});const mode=normalizeMode(m.mode);
      p={ws,pid:pid(),role:'player',profileId:String(m.profileId||''),name:String(m.name||'玩家').slice(0,12),avatar:normalizeAvatar(m.avatar),color:null,connected:true};
      const capacity=mode==='checkers'&&[2,3].includes(Number(m.playerCount))?Number(m.playerCount):2;
      const item={ws,p,mode,capacity,cancelled:false,assign:room=>{x=room;}};matchmakingQueue.push(item);broadcastMatchmakingWaiting(item);tryMatchmaking();
    }else if(m.action==='cancelMatchmake'){
      if(p&&!x){removeFromMatchmaking(p);send(p,{type:'matchmaking',status:'cancelled'});}
    }else if(m.action==='ai'){
      const mode=normalizeMode(m.mode),difficulty=normalizeDifficulty(m.difficulty);x=createRoom(mode,false,true,2);x.difficulty=difficulty;
      p={ws,pid:pid(),role:'player',profileId:String(m.profileId||''),name:String(m.name||'玩家1').slice(0,12),avatar:normalizeAvatar(m.avatar),color:null,connected:true};x.players.push(p);
      armAIWatchdog(x);
      if(mode==='xiangqi'){p.color='red';x.g.turn=p.color;setTurnDeadline(x);} else if(mode==='gomoku'||mode==='go'){p.color='black';x.g.turn=p.color;setTurnDeadline(x);} else if(isBanqi(mode)){initBanqiBoard(x.g);x.g.turn=null;x.g.started=true;} else if(mode==='checkers'){p.color='blue';x.aiColor='red';x.checkerColorByPid={ [p.pid]:'blue', ai:'red' };x.g.board={};x.g.turn=null;x.g.started=false;}
      send(p,{type:'room',roomId:null,pid:p.pid,color:p.color,mode:'ai',gameMode:mode,difficulty,spectatorCode:x.id});send(p,publicSnapshot(x,p));
      if(isExtraMode(mode))setTimeout(()=>aiExtraRpsChoose(x),500);
    }else if(m.action==='join'){
      x=rooms.get(String(m.roomId||'').trim().toUpperCase());
      if(!x||x.ai||x.players.length>=x.maxPlayers)return send({ws},{type:'error',message:'房間不存在、已滿，或這是人機房間'});
      p={ws,pid:pid(),role:'player',profileId:String(m.profileId||''),name:String(m.name||'玩家2').slice(0,12),avatar:normalizeAvatar(m.avatar),color:null,connected:true};x.players.push(p);
      if(x.players.length===x.maxPlayers){ if(x.mode==='checkers'){x.g.board={};x.g.turn=null;x.g.started=false;} else if(isBanqi(x.mode)){x.g.started=true;x.g.turn=null;setTurnDeadline(x);} }
      send(p,{type:'room',roomId:x.id,pid:p.pid,color:null,mode:'online',gameMode:x.mode,matchmade:!!x.matchmade,spectatorCode:x.id});
      broadcast(x);broadcastLobbySync(x);setTimeout(()=>{if(rooms.get(x.id)===x)broadcastLobbySync(x)},250);
    }else if(!x||!p)return;
    if(p.role==='spectator'){
      if(m.action==='leaveWatch'){x.spectators=x.spectators.filter(q=>q!==p);x=x;send(p,{type:'left-watch'});if(!x.players.length&&!x.spectators.length)rooms.delete(x.id);}
      else if(m.action==='chat')send(p,{type:'error',message:'觀戰模式目前僅能觀看，不能發送聊天訊息。'});
      else return;
    }
    else if(m.action==='rps'&&!x.ai){
      if(x.players.length<2)return send(p,{type:'error',message:'請等待另一位玩家加入'});if(x.rps.phase!=='rps')return send(p,{type:'error',message:'目前不是猜拳階段'});
      if(!['剪刀','石頭','布'].includes(m.choice))return send(p,{type:'error',message:'猜拳選項無效'});if(x.rps.choices[p.pid])return send(p,{type:'error',message:'你本輪已經出拳，請等待結果'});
      x.rps.choices[p.pid]=m.choice;if(x.players.every(q=>x.rps.choices[q.pid]))resolveRps(x);else broadcast(x);
    }else if(m.action==='rps'&&x.ai&&isExtraMode(x.mode)){
      if(x.rps.phase!=='rps')return send(p,{type:'error',message:'目前不是猜拳階段'});
      if(!['剪刀','石頭','布'].includes(m.choice))return send(p,{type:'error',message:'猜拳選項無效'});
      if(x.rps.choices[p.pid])return send(p,{type:'error',message:'你本輪已經出拳，請等待結果'});
      x.rps.choices[p.pid]=m.choice;resolveAiExtraRps(x);broadcast(x);
    }else if(m.action==='chooseColor'&&x.mode==='checkers'){const e=chooseCheckerColor(x,p,String(m.color));if(e)send(p,{type:'error',message:e});else {broadcast(x);if(x.ai&&x.rps.phase==='choose-color'&&x.rps.colorTurnPid==='ai')setTimeout(()=>aiChooseCheckerColor(x),150);}}else if(m.action==='chooseColor'&&!x.ai&&!isExtraMode(x.mode)){const e=chooseColor(x,p,m.color);if(e)send(p,{type:'error',message:e});else broadcast(x);}
    else if(m.action==='chat'){
      if(x.ai)return send(p,{type:'error',message:'單人模式沒有聊天室'});if(!isExtraMode(x.mode)&&x.rps?.phase!=='done')return send(p,{type:'error',message:'目前無法聊天'});if(!x.g.turn||x.g.winner)return send(p,{type:'error',message:'目前無法聊天'});
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
    }else if(m.action==='stopChain'){
      const res=x.mode==='darkbanqi'?stopBanqiChain(x,p):x.mode==='checkers'?stopCheckerChain(x,p):{error:'目前沒有可停止的連續行動'};if(res.error)return send(p,{type:'error',message:res.error});broadcast(x);
    }else if(m.action==='resign'){
      if(x.g.winner)return send(p,{type:'error',message:'對局已結束'});
      if(isBanqi(x.mode)){const other= x.ai ? (p.pid==='ai'?x.players[0]:{pid:'ai',color:x.aiColor,name:'電腦'}) : x.players.find(q=>q.pid!==p.pid); if(!other)return send(p,{type:'error',message:'目前沒有對手'});x.g.winner=other.color;x.g.winnerPid=other.pid;x.g.endedReason=`${p.name} 投降，${other.name||'對手'}獲勝！`;x.g.turn=null;x.g.turnDeadline=null;broadcast(x);
      }else if(x.mode==='checkers'){const other=checkerActivePlayers(x).find(q=>q.pid!==p.pid);if(!other)return send(p,{type:'error',message:'目前沒有其他玩家'});x.g.winner=other.color;x.g.winnerPid=other.pid;x.g.endedReason=`${p.name} 投降，${other.name||'下一位玩家'}獲勝！`;x.g.turn=null;x.g.turnDeadline=null;broadcast(x);
      }else{const opp=x.mode==='xiangqi'?(p.color==='red'?'black':'red'):(p.color==='black'?'white':'black');x.g.winner=opp;x.g.winnerPid=x.ai&&opp===x.players[0].color?x.players[0].pid:(!x.ai?x.players.find(q=>q.color===opp)?.pid||null:null);x.g.endedReason=`${p.name} 投降，${opp==='red'?'紅方':opp==='black'?'黑方':'白方'}獲勝！`;x.g.turn=null;x.g.turnDeadline=null;x.g.phase=x.mode==='go'?'ended':x.g.phase;broadcast(x);}
    }else if(m.action==='proposal'){
      if(x.ai&&m.kind==='undo'){
        if(x.g.winner)return send(p,{type:'error',message:'對局已結束，不能悔棋'});if(!x.undoStack.length)return send(p,{type:'error',message:'目前沒有可以悔回的步驟'});
        const steps=Math.min(2,x.undoStack.length);let restored=null;for(let i=0;i<steps;i++)restored=x.undoStack.pop();
        if(x.mode==='xiangqi'||isExtraMode(x.mode))x.g=clone(restored);else if(x.mode==='go')restoreGoState(x.g,restored);else{x.g.board=clone(restored.board);x.g.history=clone(restored.history);x.g.turn=restored.turn;x.g.move=restored.move||Math.max(1,x.g.history.length+1);x.g.winner=null;x.g.winnerPid=null;x.g.endedReason=null;}
        x.checkEvent=null;setTurnDeadline(x);broadcast(x);
      }else if(x.ai&&m.kind==='draw'){
        if(x.g.winner)return send(p,{type:'error',message:'對局已結束'});x.g.winner='draw';x.g.endedReason='你選擇求和，本局以和棋結束。';x.g.turnDeadline=null;broadcast(x);
      }else{const e=proposal(x,p,m.kind);if(e)send(p,{type:'error',message:e});}
    }else if(m.action==='proposalResponse'){const e=handleProposalResponse(x,p,!!m.accept);if(e)send(p,{type:'error',message:e});}
    else if(m.action==='inviteRematch'&&!x.ai){const e=inviteRematch(x,p);if(e)send(p,{type:'error',message:e});else broadcast(x);}
    else if(m.action==='rematchResponse'&&!x.ai){
      const inv=x.rematchInvite;if(!inv||inv.toPid!==p.pid)return send(p,{type:'error',message:'沒有等待中的再戰邀請'});x.rematchInvite=null;if(m.accept){resetOnlineRound(x);broadcast(x);}else{const inviter=x.players.find(q=>q.pid===inv.fromPid);if(inviter)send(inviter,{type:'notice',message:`${p.name} 暫時不進行下一場。`});broadcast(x);}
    }else if(m.action==='aiRematch'&&x.ai){
      x.g=newGame(x.mode);
      armAIWatchdog(x);
      x.undoStack=[];x.checkEvent=null;x.chat=[];x.aiTurnRetries=0;x.aiLastMove=null;x.aiReverseCount=0;
      x.rps=newRps();
      if(isBanqi(x.mode)){
        p.color=null;x.aiColor=null;
        initBanqiBoard(x.g);
        x.g.turn=null;x.g.started=true;
        setTimeout(()=>aiExtraRpsChoose(x),400);
      }else if(x.mode==='checkers'){
        p.color=null;x.aiColor=null;x.g.board={};x.g.turn=null;x.g.started=false;x.checkerColorOrder=[];x.checkerColorByPid={};
        setTimeout(()=>aiExtraRpsChoose(x),400);
      }else{
        x.g.turn=p.color;setTurnDeadline(x);
      }
      broadcast(x);
    }
  });
  ws.on('close',()=>{
    if(x?.ai&&x.aiWatchdogTimer){clearInterval(x.aiWatchdogTimer);x.aiWatchdogTimer=null;} 
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
server.listen(PORT,()=>console.log(`Board Arena Online v3.4.11 multi-game on ${PORT}`));

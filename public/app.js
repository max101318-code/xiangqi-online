let ws=null,state=null,myPid=null,myColor=null,mode='home',selected=null,lastCheckId=null,checkTimer=null,proposalVisible=false,avatar='🧑🏻',soundOn=true,clockTimer=null,lastBoard=null;
const $=id=>document.getElementById(id);
const CH={K:'帥',A:'仕',B:'相',N:'傌',R:'俥',C:'炮',P:'兵',k:'將',a:'士',b:'象',n:'馬',r:'車',c:'炮',p:'卒'};
const AVATARS=['🧑🏻','🧑🏼','🧑🏽','🧑🏾','🧑🏿','🐱','🐼','🦊','🐯','🐸','🤖','👾','🦄','🐲','😎','🥷'];
function loadProfile(){const n=localStorage.getItem('xqName');avatar=localStorage.getItem('xqAvatar')||'🧑🏻';$('home-name').value=n||'玩家';$('avatar-preview').textContent=avatar;const p=$('avatar-picker');p.innerHTML=AVATARS.map(a=>`<button class="avatar-pick ${a===avatar?'selected':''}" data-a="${a}">${a}</button>`).join('');p.querySelectorAll('button').forEach(b=>b.onclick=()=>{avatar=b.dataset.a;localStorage.setItem('xqAvatar',avatar);$('avatar-preview').textContent=avatar;p.querySelectorAll('button').forEach(x=>x.classList.toggle('selected',x===b));});}
function saveProfile(){localStorage.setItem('xqName',$('home-name').value.trim()||'玩家');localStorage.setItem('xqAvatar',avatar);}
function connect(){if(ws&&(ws.readyState===WebSocket.OPEN||ws.readyState===WebSocket.CONNECTING))return;ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host);ws.onopen=()=>toast('已連線到遊戲伺服器');ws.onclose=()=>toast('連線已中斷，請重新整理。','error');ws.onerror=()=>toast('無法連線到遊戲伺服器。','error');ws.onmessage=e=>handle(JSON.parse(e.data));}
function send(o){if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify(o));else toast('尚未連線','error');}
function toast(text,kind=''){const t=$('toast');t.textContent=text;t.className='toast '+kind;t.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>t.hidden=true,2200);}
function showScreen(s){if(s!=='game-screen')hideRematchInvite();['home-screen','lobby-screen','game-screen'].forEach(id=>$(id).hidden=id!==s);window.scrollTo({top:0,behavior:'smooth'});}
function difficultyName(v){return v==='easy'?'簡單':v==='hard'?'困難':'普通';}
function handle(m){
 if(m.type==='error'){toast(m.message,'error');return;}
 if(m.type==='notice'){toast(m.message);return;}
 if(m.type==='proposal'){showProposal(m.kind,m.fromName);return;}
 if(m.type==='rematch-invite'){if(m.ended===true && m.roomId && state?.roomId===m.roomId && state?.mode==='online' && state?.winner){showRematchInvite(m.fromName);}return;}
 if(m.type==='room'){hideRematchInvite();mode=m.mode||'online';myColor=m.color||null;showScreen(mode==='ai'?'game-screen':'lobby-screen');updateLobby();if(mode==='ai')toast(`單人模式：${difficultyName($('difficulty')?.value||'normal')}`);return;}
 if(m.type==='state'){
  if(Array.isArray(m.board)&&m.board.length===10&&m.board.every(r=>Array.isArray(r)&&r.length===9)) lastBoard=m.board;
  else if(lastBoard) m.board=lastBoard;
  else {toast('棋盤資料尚未同步完成，正在重新整理…','error');return;}
  state=m;myColor=m.color||myColor;if(!m.winner)hideRematchInvite();renderState();if(m.checkEvent)showCheck(m.checkEvent);
 }
}
function updateLobby(){const ps=state?.players||[];const p1=ps[0],p2=ps[1];$('lobby-room').textContent=state?.roomId||'——';if(p1){$('lobby-p1-name').textContent=p1.name;$('lobby-p1-avatar').textContent=p1.avatar;$('lobby-p1-side').textContent=p1.color==='red'?'紅方':p1.color==='black'?'黑方':'尚未選色';}if(p2){$('lobby-p2-name').textContent=p2.name;$('lobby-p2-avatar').textContent=p2.avatar;$('lobby-p2-side').textContent=p2.color==='red'?'紅方':p2.color==='black'?'黑方':'尚未選色';}else{$('lobby-p2-name').textContent='等待加入';$('lobby-p2-avatar').textContent='?';$('lobby-p2-side').textContent='—';}
 const players=ps.length;$('lobby-message').textContent=players<2?'把房號分享給朋友即可加入。':state?.rps?.phase==='rps'?'兩位玩家已加入，請開始猜拳。':state?.rps?.phase==='choose-color'?(state.rps.isRpsWinner?'你猜拳獲勝，請選顏色。':'猜拳落敗，等待對方選色。'):'已決定先後手，進入棋局…';
 const list=[];list.push(`玩家：${players}/2`);if(state?.rps?.result)list.push(state.rps.result);$('lobby-state-list').innerHTML=list.map(x=>`<div class="hist">${x}</div>`).join('');
 const rpsPhase=players===2&&state?.rps?.phase==='rps';$('rps-panel').hidden=!rpsPhase;if(rpsPhase){let t=state.rps.result||'請雙方各自出拳。';if(state.rps.youChoice)t='你已出拳，等待對方…';if(state.rps.hasOpponentChoice&&!state.rps.youChoice)t='對方已出拳，請你出拳。';$('rps-status').textContent=t;document.querySelectorAll('[data-choice]').forEach(b=>b.disabled=!!state.rps.youChoice);}
 const cp=players===2&&state?.rps?.phase==='choose-color';$('color-panel').hidden=!cp;if(cp){$('color-status').textContent=state.rps.isRpsWinner?'你是勝者，選紅方或黑方；你會先手。':'你是落敗者，等待對方選色；你會後手。';document.querySelectorAll('[data-color]').forEach(b=>b.disabled=!state.rps.isRpsWinner);}
}
function renderState(){
 if(!state||!Array.isArray(state.board)||state.board.length!==10)return;
 mode=state.mode||mode;
 if(mode==='online'&&state.rps?.phase!=='done'){showScreen('lobby-screen');updateLobby();return;}
 showScreen('game-screen');
 $('game-room-meta').textContent=mode==='ai'?`單人 · ${difficultyName(state.difficulty)}`:`房號 ${state.roomId||'—'}`;
 const me=state.players?.find(p=>p.pid===getMyPid(state));const opp=state.players?.find(p=>p.pid!==getMyPid(state));
 const my=me||{name:'玩家',avatar:avatar,color:myColor},op=opp||{name:'電腦',avatar:'🤖',color:'black'};
 $('you-avatar').textContent=my.avatar||avatar;$('you-name').textContent=my.name;$('you-side').textContent=my.color==='red'?'紅方':my.color==='black'?'黑方':'待定';
 $('opp-avatar').textContent=op.avatar||'🤖';$('opp-name').textContent=op.name;$('opp-side').textContent=op.color==='red'?'紅方':op.color==='black'?'黑方':'待定';
 renderBoard();renderHistory();renderTurn();updateCountdown();updateActions();
}
function getMyPid(st){return st.players?.find(p=>p.pid===myPid)?.pid||st.players?.find(p=>p.color===myColor)?.pid||st.players?.[0]?.pid;}
function renderBoard(){
 const b=$('board-points');
 if(!b||!state||!Array.isArray(state.board)||state.board.length!==10||!state.board.every(r=>Array.isArray(r)&&r.length===9)) return;
 b.innerHTML='';
 const hs=selected?hints(selected[0],selected[1]):[],hm=new Map(hs.map(x=>[`${x[0]},${x[1]}`,x[2]]));
 for(let r=0;r<10;r++)for(let c=0;c<9;c++){
   const el=document.createElement('button');el.type='button';el.className='point';el.style.left=`${c/8*100}%`;el.style.top=`${r/9*100}%`;
   const p=state.board[r][c],key=`${r},${c}`;
   if(selected?.[0]===r&&selected?.[1]===c)el.classList.add('selected');
   if(hm.has(key))el.classList.add('hint',hm.get(key));
   if(p&&CH[p.t]){const sp=document.createElement('span');sp.className=`piece ${p.t===p.t.toUpperCase()?'red':'black'}`;sp.textContent=CH[p.t];el.appendChild(sp);}
   el.onclick=()=>clickCell(r,c);b.appendChild(el);
 }
}
function renderHistory(){ $('history').innerHTML=(state.history||[]).map(x=>`<div class="hist"><b>${x.n}.</b> ${x.color==='red'?'紅':'黑'}${x.piece} <span>(${x.from[0]},${x.from[1]})→(${x.to[0]},${x.to[1]})</span>${x.captured?` <em>吃${x.captured}</em>`:''}</div>`).join('')||'<div class="hist">尚未有走棋紀錄</div>'; $('move-count').textContent=`${state.history?.length||0} 手`;}
function renderTurn(){if(state.winner){$('turn-message').textContent=state.endedReason||`勝者：${state.winner==='red'?'紅方':state.winner==='black'?'黑方':'和棋'}`;return;}$('turn-message').textContent=state.turn===myColor?'輪到你：請選擇棋子':state.turn?`等待${state.turn==='red'?'紅方':'黑方'}走棋`:'等待開始…';}
function updateCountdown(){clearInterval(clockTimer);clockTimer=setInterval(()=>{if(!state?.turnDeadline||state.winner){$('countdown').textContent='—';return;}const sec=Math.max(0,Math.ceil((state.turnDeadline-Date.now())/1000));$('countdown').textContent=String(sec).padStart(2,'0');},250);}
function updateActions(){const locked=!!state.winner||!((state.mode==='ai'||state.rps?.phase==='done')&&state.turn===myColor);$('undo-btn').disabled=locked||!(state.history?.length);$('draw-btn').disabled=locked||state.mode==='ai';$('rematch-btn').disabled=!state.winner;$('sound-btn').textContent=`${soundOn?'🔊 音效：開':'🔇 音效：關'}`;if(state.winner&&state.mode==='ai')$('rematch-btn').textContent='🔁 再來一局';else $('rematch-btn').textContent='🔁 再戰';}
function mine(p){return myColor==='red'?p.t===p.t.toUpperCase():p.t===p.t.toLowerCase();}
function clearPath(r1,c1,r2,c2){const dr=Math.sign(r2-r1),dc=Math.sign(c2-c1);let r=r1+dr,c=c1+dc;while(r!==r2||c!==c2){if(state.board[r][c])return false;r+=dr;c+=dc;}return true;}
function palace(r,c,color){return c>=3&&c<=5&&(color==='red'?r<=2:r>=7);}
function canMove(r1,c1,r2,c2,p){if(r1===r2&&c1===c2)return false;if(!inside(r2,c2)||(state.board[r2][c2]&&mine(state.board[r2][c2])))return false;const t=p.t.toLowerCase(),dr=r2-r1,dc=c2-c1,ar=Math.abs(dr),ac=Math.abs(dc);if(t==='k'){const d=state.board[r2][c2];const fc=d&&d.t.toLowerCase()==='k'&&dc===0&&clearPath(r1,c1,r2,c2);return fc||(ar+ac===1&&palace(r2,c2,myColor));}if(t==='a')return ar===1&&ac===1&&palace(r2,c2,myColor);if(t==='b')return ar===2&&ac===2&&((myColor==='red'&&r2<=4)||(myColor==='black'&&r2>=5))&&!state.board[r1+dr/2][c1+dc/2];if(t==='n'){if(!((ar===2&&ac===1)||(ar===1&&ac===2)))return false;const lr=r1+(ar===2?Math.sign(dr):0),lc=c1+(ac===2?Math.sign(dc):0);return !state.board[lr][lc];}if(t==='r')return(dr===0||dc===0)&&clearPath(r1,c1,r2,c2);if(t==='c'){if(dr!==0&&dc!==0)return false;let n=0,sr=Math.sign(dr),sc=Math.sign(dc),r=r1+sr,c=c1+sc;while(r!==r2||c!==c2){if(state.board[r][c])n++;r+=sr;c+=sc;}return state.board[r2][c2]?n===1:n===0;}if(t==='p'){const f=myColor==='red'?1:-1,crossed=myColor==='red'?r1>=5:r1<=4;return(dr===f&&dc===0)||(crossed&&dr===0&&ac===1);}return false;}
function hints(r,c){const p=state.board[r][c],out=[];if(!p)return out;for(let rr=0;rr<10;rr++)for(let cc=0;cc<9;cc++)if(canMove(r,c,rr,cc,p))out.push([rr,cc,state.board[rr][cc]?'capture':'move']);return out;}
function clickCell(r,c){if(!state||state.winner||state.turn!==myColor||!(state.mode==='ai'||state.rps?.phase==='done'))return;const p=state.board[r][c];if(!selected){if(p&&mine(p)){selected=[r,c];playSound('select');renderBoard();}return;}if(p&&mine(p)){selected=[r,c];renderBoard();return;}const target=state.board[r][c];if(canMove(selected[0],selected[1],r,c,state.board[selected[0]][selected[1]])){send({action:'move',r1:selected[0],c1:selected[1],r2:r,c2:c});playSound(target?'capture':'move');}selected=null;renderBoard();}
function showCheck(ev){if(!ev||ev.id===lastCheckId)return;lastCheckId=ev.id;const o=$('check-overlay'),w=o.querySelector('.check-ink');$('check-target').textContent=ev.target==='red'?'紅方帥受到攻擊':'黑方將受到攻擊';o.hidden=false;w.classList.remove('ink-pop');void w.offsetWidth;w.classList.add('ink-pop');speakCheck();clearTimeout(checkTimer);checkTimer=setTimeout(()=>o.hidden=true,1500);}
function speakCheck(){if(!soundOn||!('speechSynthesis'in window))return;try{speechSynthesis.cancel();const u=new SpeechSynthesisUtterance('將軍');u.lang='zh-TW';u.rate=.7;u.pitch=.55;u.volume=1;const vs=speechSynthesis.getVoices();u.voice=vs.find(v=>/^zh-TW/i.test(v.lang))||vs.find(v=>/^zh/i.test(v.lang))||null;speechSynthesis.speak(u);}catch(e){}}
function playSound(kind){if(!soundOn)return;try{const AC=window.AudioContext||window.webkitAudioContext;const ac=new AC();const o=ac.createOscillator(),g=ac.createGain();o.type=kind==='capture'?'square':'sine';o.frequency.value=kind==='capture'?210:430;g.gain.setValueAtTime(.0001,ac.currentTime);g.gain.exponentialRampToValueAtTime(kind==='capture'?.06:.035,ac.currentTime+.01);g.gain.exponentialRampToValueAtTime(.0001,ac.currentTime+.13);o.connect(g).connect(ac.destination);o.start();o.stop(ac.currentTime+.14);setTimeout(()=>ac.close(),220);}catch(e){}}
function showProposal(kind,fromName){proposalVisible=true;state.pendingProposal={kind};$('confirm-title').textContent=kind==='undo'?'對方要求悔棋':'對方提出和棋';$('confirm-text').textContent=kind==='undo'?`${fromName} 想把棋局退回上一手，是否接受？`:`${fromName} 想與你和棋，是否接受？`;$('confirm-overlay').hidden=false;}
function hideProposal(){$('confirm-overlay').hidden=true;proposalVisible=false;}
function showRematchInvite(name){$('rematch-title').textContent=`${name||'對方'}邀你進行下一場`;$('rematch-panel').hidden=false;}
function hideRematchInvite(){$('rematch-panel').hidden=true;}
function lobbyAvatarForCurrent(){return avatar;}
function copyText(t){navigator.clipboard?.writeText(t).then(()=>toast('已複製')).catch(()=>toast('瀏覽器不允許自動複製，請手動複製房號','error'));}
$('home-online').onclick=()=>{saveProfile();connect();const go=()=>ws.readyState===WebSocket.OPEN?send({action:'create',name:$('home-name').value,avatar}):setTimeout(go,40);go();};
$('home-join').onclick=()=>{const room=$('home-room').value.trim().toUpperCase();if(!room)return toast('請先輸入房號','error');saveProfile();connect();const go=()=>ws.readyState===WebSocket.OPEN?send({action:'join',roomId:room,name:$('home-name').value,avatar}):setTimeout(go,40);go();};
$('home-ai').onclick=()=>{saveProfile();const difficulty=$('home-difficulty').value;connect();const go=()=>ws.readyState===WebSocket.OPEN?send({action:'ai',name:$('home-name').value,avatar,difficulty}):setTimeout(go,40);go();};
$('back-home').onclick=$('game-home').onclick=()=>{if(ws){try{ws.close();}catch{}}state=null;myColor=null;selected=null;showScreen('home-screen');loadProfile();};
$('copy-room').onclick=()=>copyText(state?.roomId||$('lobby-room').textContent);
$('lobby-copy-share').onclick=()=>copyText(`來玩中國象棋 Online！房號：${state?.roomId||$('lobby-room').textContent}`);
document.querySelectorAll('[data-choice]').forEach(b=>b.onclick=()=>{send({action:'rps',choice:b.dataset.choice});playSound('select');});document.querySelectorAll('[data-color]').forEach(b=>b.onclick=()=>{send({action:'chooseColor',color:b.dataset.color});playSound('move');});
$('undo-btn').onclick=()=>send({action:'proposal',kind:'undo'});$('draw-btn').onclick=()=>send({action:'proposal',kind:'draw'});$('rematch-btn').onclick=()=>{if(mode==='ai')send({action:'aiRematch'});else send({action:'inviteRematch'});};$('sound-btn').onclick=()=>{soundOn=!soundOn;$('sound-btn').textContent=`${soundOn?'🔊 音效：開':'🔇 音效：關'}`;if(soundOn)playSound('select');};
$('confirm-yes').onclick=()=>{send({action:'proposalResponse',accept:true});hideProposal();};$('confirm-no').onclick=()=>{send({action:'proposalResponse',accept:false});hideProposal();};$('accept-rematch').onclick=()=>{send({action:'rematchResponse',accept:true});hideRematchInvite();};$('reject-rematch').onclick=()=>{send({action:'rematchResponse',accept:false});hideRematchInvite();};
loadProfile();connect();

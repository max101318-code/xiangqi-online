
let ws=null,state=null,myPid=null,myColor=null,screenMode='home-screen',selected=null,lastCheckId=null,checkTimer=null,avatar='🧑🏻',draftAvatar='🧑🏻',soundOn=true,clockTimer=null,lastBoard=null;
let selectedGameMode='xiangqi';
const $=id=>document.getElementById(id);
const CH={K:'帥',A:'仕',B:'相',N:'傌',R:'俥',C:'炮',P:'兵',k:'將',a:'士',b:'象',n:'馬',r:'車',c:'炮',p:'卒'};
const AVATARS=['🧑🏻','🧑🏼','🧑🏽','🧑🏾','🧑🏿','🐱','🐼','🦊','🐯','🐸','🤖','👾','🦄','🐲','😎','🥷'];
const MODE_NAMES={xiangqi:'中國象棋',gomoku:'五子棋',go:'圍棋',banqi:'明棋',darkbanqi:'暗棋（連吃版）',checkers:'多人跳棋'};
const EXTRA_MODES=['banqi','darkbanqi','checkers'];
const isExtraMode=m=>EXTRA_MODES.includes(m);
const isBanqiMode=m=>m==='banqi'||m==='darkbanqi';

function modeName(m){return MODE_NAMES[m]||MODE_NAMES.xiangqi;}
function localProfile(){
  let p;try{p=JSON.parse(localStorage.getItem('xqProfile')||'null')}catch{}
  if(!p||!p.id)p={id:(crypto.randomUUID?.()||('xq-'+Date.now()+'-'+Math.random().toString(16).slice(2))),name:'玩家',avatar:'🧑🏻',games:0,wins:0,losses:0,draws:0,countedRounds:[]};
  p.name=String(p.name||'玩家').slice(0,12);p.avatar=p.avatar||'🧑🏻';
  p.wins=Number(p.wins||0);p.losses=Number(p.losses||0);p.draws=Number(p.draws||0);
  p.games=Number.isFinite(Number(p.games))?Number(p.games):p.wins+p.losses+p.draws;
  if(!Array.isArray(p.countedRounds))p.countedRounds=[];
  if(p.games<p.wins+p.losses+p.draws)p.games=p.wins+p.losses+p.draws;
  return p;
}
let profile=localProfile();
function persistProfile(){try{profile.countedRounds=(profile.countedRounds||[]).slice(-300);localStorage.setItem('xqProfile',JSON.stringify(profile));}catch{toast('瀏覽器儲存空間不足，無法保存玩家資料。','error');}}
function saveName(){profile.name=($('home-name')?.value||'玩家').trim().slice(0,12)||'玩家';persistProfile();updateProfileSaveState();return profile;}
function saveAvatar(){profile.avatar=draftAvatar||'🧑🏻';avatar=profile.avatar;persistProfile();paintAvatar($('avatar-preview'),profile.avatar);loadAvatarPickerSelection();updateProfileSaveState();toast('頭像已儲存，進入任何模式都會使用這個頭像');return profile;}
function paintAvatar(el,val){if(!el)return;el.replaceChildren();if(typeof val==='string'&&val.startsWith('data:image/')){const img=document.createElement('img');img.src=val;img.alt='玩家頭像';el.appendChild(img);}else el.textContent=val||'🧑🏻';}
function renderStats(){
  profile=localProfile();
  $('stat-games').textContent=profile.games;
  $('stat-wins').textContent=profile.wins;
  $('stat-losses').textContent=profile.losses;
  $('stat-draws').textContent=profile.draws;
  $('stat-rate').textContent=(profile.games?((profile.wins/profile.games)*100).toFixed(1):'0')+'%';
}
function updateStatsOnState(st){
  if(!st?.winner||!st.roundKey)return;
  profile=localProfile();
  if(profile.countedRounds.includes(st.roundKey))return;
  profile.countedRounds.push(st.roundKey);
  profile.games++;
  if(st.winner==='draw'){profile.draws++;toast('本局和棋，戰績已更新！');}
  else if(st.winnerPid===myPid){profile.wins++;toast('本局勝利，戰績已更新！');}
  else{profile.losses++;toast('本局落敗，戰績已更新！');}
  persistProfile();renderStats();
}
async function readAvatarFile(file){
  if(!file||!file.type.startsWith('image/'))throw new Error('請選擇圖片檔');
  if(file.size>5*1024*1024)throw new Error('圖片請小於 5 MB');
  const url=URL.createObjectURL(file);
  try{
    const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(new Error('圖片讀取失敗'));i.src=url});
    const size=256,canvas=document.createElement('canvas');canvas.width=size;canvas.height=size;const ctx=canvas.getContext('2d');
    const scale=Math.max(size/img.width,size/img.height),w=img.width*scale,h=img.height*scale;
    ctx.drawImage(img,(size-w)/2,(size-h)/2,w,h);return canvas.toDataURL('image/jpeg',.82);
  }finally{URL.revokeObjectURL(url);}
}
function updateProfileSaveState(){
  const nb=$('name-save-btn'),ab=$('avatar-save-btn');
  const name=($('home-name')?.value||'玩家').trim().slice(0,12)||'玩家';
  const nameDirty=name!==profile.name;
  if(nb){nb.disabled=!nameDirty;nb.textContent=nameDirty?'💾 儲存名字':'✅ 名字已儲存';}
  const avatarDirty=draftAvatar!==profile.avatar;
  if(ab){ab.disabled=!avatarDirty;ab.textContent=avatarDirty?'💾 儲存頭像':'✅ 頭像已儲存';}
}
function setupProfileUI(){
  $('home-name').addEventListener('input',updateProfileSaveState);
  $('name-save-btn').onclick=saveName;
  $('avatar-upload-btn').onclick=()=>$('avatar-file').click();
  $('avatar-file').onchange=async e=>{try{draftAvatar=await readAvatarFile(e.target.files?.[0]);paintAvatar($('avatar-preview'),draftAvatar);loadAvatarPickerSelection();updateProfileSaveState();toast('自訂頭像已加入預覽，請按「儲存頭像」');}catch(err){toast(err.message||'頭像設定失敗','error')}e.target.value=''};
  $('avatar-reset-btn').onclick=()=>{draftAvatar='🧑🏻';paintAvatar($('avatar-preview'),draftAvatar);loadAvatarPickerSelection();updateProfileSaveState();};
  $('avatar-save-btn').onclick=saveAvatar;
}
function loadProfile(){
  profile=localProfile();avatar=profile.avatar||'🧑🏻';draftAvatar=avatar;
  if($('home-name'))$('home-name').value=profile.name;
  paintAvatar($('avatar-preview'),draftAvatar);
  const p=$('avatar-picker');p.innerHTML='';
  AVATARS.forEach(a=>{const b=document.createElement('button');b.type='button';b.className='avatar-pick'+(a===draftAvatar?' selected':'');b.textContent=a;b.onclick=()=>{draftAvatar=a;paintAvatar($('avatar-preview'),draftAvatar);loadAvatarPickerSelection();updateProfileSaveState()};p.appendChild(b)});
  renderStats();updateProfileSaveState();
}
function loadAvatarPickerSelection(){const p=$('avatar-picker');if(!p)return;p.querySelectorAll('button').forEach(x=>x.classList.toggle('selected',x.textContent===draftAvatar));}

function connect(){
  if(ws&&(ws.readyState===WebSocket.OPEN||ws.readyState===WebSocket.CONNECTING))return;
  ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host);
  ws.onopen=()=>{};
  ws.onclose=()=>{if(screenMode!=='home-screen')toast('連線已中斷，請重新整理。','error');};
  ws.onerror=()=>toast('無法連線到遊戲伺服器。','error');
  ws.onmessage=e=>{try{handle(JSON.parse(e.data))}catch(err){console.error(err)}};
}
function send(o){if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify(o));else toast('尚未連線','error');}
function ensureSavedProfile(){
  if(($('home-name').value.trim()||'玩家').slice(0,12)!==profile.name)saveName();
  if(draftAvatar!==profile.avatar)saveAvatar();
}
function toast(text,kind=''){const t=$('toast');t.textContent=text;t.className='toast '+kind;t.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>t.hidden=true,2200);}
function showScreen(s){
  const changed=screenMode!==s;
  ['home-screen','lobby-screen','game-screen'].forEach(id=>$(id).hidden=id!==s);
  screenMode=s;
  if(changed)window.scrollTo({top:0,behavior:'smooth'});
}
function showMatchmaking(status){
  if(status==='searching'){
    $('lobby-room-wrap').classList.add('matchmaking-hidden');$('matchmaking-panel').hidden=false;$('rps-panel').hidden=true;$('color-panel').hidden=true;
    $('matchmaking-game').textContent=`模式：${modeName(selectedGameMode)}`;$('matchmaking-status').textContent='正在匹配中';showScreen('lobby-screen');
  }else{
    $('matchmaking-panel').hidden=true;$('lobby-room-wrap').classList.remove('matchmaking-hidden');showScreen('home-screen');loadProfile();toast('已取消匹配');
  }
}
function startMatchmaking(){
  ensureSavedProfile();connect();const go=()=>ws.readyState===WebSocket.OPEN?send({action:'matchmake',mode:selectedGameMode,playerCount:selectedGameMode==='checkers'?Number($('checkers-player-count').value):2,name:profile.name,avatar:profile.avatar,profileId:profile.id}):setTimeout(go,40);go();
}
function handle(m){
  if(m.type==='error'){toast(m.message,'error');return}
  if(m.type==='notice'){toast(m.message);return}
  if(m.type==='proposal'){showProposal(m.kind,m.fromName);return}
  if(m.type==='matchmaking'){if(m.status==='searching')showMatchmaking('searching');else showMatchmaking('cancelled');return}
  if(m.type==='rematch-invite'){if(m.ended&&m.roomId&&state?.roomId===m.roomId&&state?.winner)showRematchInvite(m.fromName);else hideRematchInvite();return}
  if(m.type==='room'){
    hideRematchInvite();myPid=m.pid||myPid;myColor=m.color||null;
    state={...state,mode:m.mode,gameMode:m.gameMode||selectedGameMode,difficulty:m.difficulty||null,matchmade:!!m.matchmade,roomId:m.roomId||null,spectatorCode:m.spectatorCode||m.roomId||null,color:m.color||null,players:state?.players||[],spectators:state?.spectators||0};
    if(m.mode==='ai'||m.mode==='spectator')showScreen('game-screen');else showScreen('lobby-screen');
    return;
  }
  if(m.type==='state'){
    const previousBoard=state?.board||null, previousHistory=state?.history||[];
    state=m;
    if(!state.gameMode)state.gameMode=selectedGameMode;
    myColor=m.mode==='spectator'?null:(m.color||myColor);
    if(m.mode==='spectator')myPid=m.pid||myPid;
    else if(!myPid&&m.players?.length)myPid=m.players.find(p=>p.color===myColor)?.pid||m.players[0]?.pid;
    if(m.mode!=='spectator')updateStatsOnState(m); else hideRematchInvite();
    if(m.board){lastBoard=m.board;}
    renderState(previousBoard,previousHistory);
    if(m.checkEvent)showCheck(m.checkEvent);
    return;
  }
}
function lobbyColorButtons(){
  const wrap=$('color-buttons');wrap.innerHTML='';
  if(state?.gameMode==='checkers'){
    const colors=[['red','🔴 紅色'],['blue','🔵 藍色'],['green','🟢 綠色']];
    const picked=state.rps?.colorChoices||{};const myTurn=state.rps?.colorTurnPid===myPid;
    colors.forEach(([c,label])=>{const b=document.createElement('button');b.dataset.color=c;b.textContent=label;b.disabled=(!myTurn)||!!picked[c];b.setAttribute('aria-disabled',String(b.disabled));b.onclick=()=>{send({action:'chooseColor',color:c});playSound('move')};wrap.appendChild(b)});
    return;
  }
  const wrap2=$('color-buttons');const isXQ=state?.gameMode==='xiangqi';
  [['red',isXQ?'🔴 選紅方':'⚫ 選黑方'],['black',isXQ?'⚫ 選黑方':'⚪ 選白方']].forEach(([c,label])=>{
    const b=document.createElement('button');b.dataset.color=c;b.textContent=label;b.onclick=()=>{send({action:'chooseColor',color:c});playSound('move')};wrap2.appendChild(b);
  });
}
function updateLobby(){
  const ps=state?.players||[],g=state?.gameMode||selectedGameMode;
  $('lobby-title').textContent=`${modeName(g)} · 房間大廳`;
  $('lobby-room').textContent=state?.roomId||'——';
  $('lobby-room-wrap').classList.toggle('matchmaking-hidden',state?.matchmade===true);
  if(isExtraMode(g)){
    const wrap=$('.players-card');wrap.innerHTML='';const cap=newModeCapacity();const slots=Math.max(cap,(ps?.length||0));wrap.style.gridTemplateColumns=`repeat(${Math.min(Math.max(slots,2),3)},minmax(0,1fr))`;
    for(let i=0;i<Math.min(Math.max(slots,2),3);i++){
      const p=ps[i];const slot=document.createElement('div');slot.className='slot';const av=document.createElement('div');av.className='avatar';paintAvatar(av,p?.avatar||'❔');const body=document.createElement('div');const name=document.createElement('b');name.textContent=p?.name||'等待玩家';const side=document.createElement('span');side.textContent=p?sideName(p.color,g):(g==='checkers'?`等待第${i+1}位玩家`:'等待翻棋');body.append(name,side);const em=document.createElement('em');em.textContent=`玩家 ${i+1}`;slot.append(av,body,em);wrap.appendChild(slot);
    }
    const realPlayers=ps.length;
    const aiExtra=state.mode==='ai';
    $('lobby-message').textContent=state.rps?.phase==='rps'?`已進入${modeName(g)}猜拳，請所有玩家出拳。`:state.rps?.phase==='done'?(state.rps.result||'猜拳完成，準備開始。'):(g==='checkers'?`等待玩家加入：${Math.min(realPlayers,cap)}/${cap}`:`等待玩家加入：${Math.min(realPlayers,2)}/2`);
    $('lobby-state-list').innerHTML=[`模式：${modeName(g)}`,`玩家：${Math.min(realPlayers,cap)}/${cap}`,state.rps?.result||'',g==='checkers'?`賽制：最多 3 人，本局 ${cap} 人`:'第一位翻開棋子後依棋面決定陣營。'].filter(Boolean).map(x=>`<div class="hist">${x}</div>`).join('');
    const rpsReady=(state.rps?.phase==='rps')&&(state.mode==='ai'||realPlayers>=cap);$('rps-panel').hidden=!rpsReady;
    if(rpsReady){let t=state.rps.result||'請出拳。';if(state.rps.youChoice)t='你已出拳，等待其他玩家…';if(state.rps.hasOpponentChoice&&!state.rps.youChoice)t='對方已出拳，請你出拳。';$('rps-status').textContent=t;document.querySelectorAll('[data-choice]').forEach(b=>b.disabled=!!state.rps.youChoice);}
    const checkColorPhase=g==='checkers'&&state.rps?.phase==='choose-color';
    $('color-panel').hidden=!checkColorPhase;$('matchmaking-panel').hidden=true;
    if(checkColorPhase){$('color-title').textContent='猜拳排名後依序選擇紅／藍／綠';$('color-status').textContent=state.rps.colorTurnPid===myPid?'輪到你選顏色。第三名會自動使用最後剩下的顏色。':`等待 ${ps.find(p=>p.pid===state.rps.colorTurnPid)?.name||'下一位玩家'} 選顏色。`;lobbyColorButtons();}
    $('lobby-room-wrap').classList.add('matchmaking-hidden');
    return;
  }
  // 原有三種模式維持原本流程
  const p1=ps[0],p2=ps[1];
  if(p1){$('lobby-p1-name').textContent=p1.name;paintAvatar($('lobby-p1-avatar'),p1.avatar);$('lobby-p1-side').textContent=sideName(p1.color,g)}else{$('lobby-p1-name').textContent='等待玩家';paintAvatar($('lobby-p1-avatar'),'🧑🏻');$('lobby-p1-side').textContent='—'}
  if(p2){$('lobby-p2-name').textContent=p2.name;paintAvatar($('lobby-p2-avatar'),p2.avatar);$('lobby-p2-side').textContent=sideName(p2.color,g)}else{$('lobby-p2-name').textContent='等待加入';paintAvatar($('lobby-p2-avatar'),'?');$('lobby-p2-side').textContent='—'}
  $('lobby-room-wrap').classList.toggle('matchmaking-hidden',state?.matchmade===true);
  const players=ps.length;
  $('lobby-message').textContent=players<2?'把房號分享給朋友即可加入。':state.rps?.phase==='rps'?`兩位玩家已加入${modeName(g)}，請開始猜拳。`:state.rps?.phase==='choose-color'?(state.rps.isRpsWinner?'你是猜拳勝者，請選擇棋色。':'猜拳落敗，等待對方選擇棋色。'):'已決定先手，進入棋局…';
  const list=[`模式：${modeName(g)}`,`玩家：${players}/2`];if(state.rps?.result)list.push(state.rps.result);$('lobby-state-list').innerHTML=list.map(x=>`<div class="hist">${x}</div>`).join('');
  const rpsPhase=players===2&&state.rps?.phase==='rps';$('rps-panel').hidden=!rpsPhase;
  if(rpsPhase){let t=state.rps.result||'請雙方各自出拳。';if(state.rps.youChoice)t='你已出拳，等待對方…';if(state.rps.hasOpponentChoice&&!state.rps.youChoice)t='對方已出拳，請你出拳。';$('rps-status').textContent=t;document.querySelectorAll('[data-choice]').forEach(b=>b.disabled=!!state.rps.youChoice);}
  const cp=players===2&&state.rps?.phase==='choose-color';$('color-panel').hidden=!cp;
  if(cp){$('color-title').textContent=g==='xiangqi'?'猜拳勝者選擇象棋顏色':'猜拳勝者選擇棋色';$('color-status').textContent=state.rps.isRpsWinner?`你勝出，請選${g==='xiangqi'?'紅方／黑方':'黑方／白方'}；你會先手。`:'你敗於猜拳，等待對方選色；你會後手。';lobbyColorButtons();document.querySelectorAll('#color-buttons button').forEach(b=>b.disabled=!state.rps.isRpsWinner);}
}
function showMatchmakingCleanup(){$('matchmaking-panel').hidden=true;$('lobby-room-wrap').classList.toggle('matchmaking-hidden',!!state?.matchmade);}
function sideName(c,g){if(g==='xiangqi')return c==='red'?'紅方':c==='black'?'黑方':'待定';if(g==='checkers')return c==='red'?'🔴 紅色':c==='blue'?'🔵 藍色':c==='green'?'🟢 綠色':c&&/^p\d+$/.test(c)?`第${Number(c.slice(1))+1}位`:'待定';return c==='black'?'黑方':c==='white'?'白方':'待定';}
function isMyTurn(){if(!state||state.mode==='spectator'||state.winner)return false;return isExtraMode(state.gameMode)?state.turn===myPid:state.turn===myColor;}
function newModeCapacity(){return state?.gameMode==='checkers'?(Number(state?.maxPlayers)||2):2;}
function renderState(previousBoard=null,previousHistory=[]){
  if(!state)return;
  const needsLobby=(state.mode==='online' && (state.rps?.phase!=='done' || (isExtraMode(state.gameMode)&&!state.started)));
  if(needsLobby){showScreen('lobby-screen');updateLobby();return;}
  // AI 對局（包含明棋、暗棋連吃、多人跳棋）直接留在棋局畫面；猜拳在棋局畫面上完成，不再跳進建立房間大廳。
  showScreen('game-screen');
  const g=state.gameMode||'xiangqi';
  $('game-eyebrow').textContent=`${modeName(g)} · ${state.mode==='ai'?'AI 對局':state.mode==='spectator'?'👁 觀戰模式':'ONLINE 對局'}`;
  $('game-title').innerHTML=`${modeName(g)} <span>Online</span>`;
  $('game-room-meta').textContent=state.mode==='ai'?`單人 · ${difficultyName(state.difficulty)}`:state.mode==='spectator'?`👁 觀戰 · 觀戰碼 ${state.spectatorCode||state.roomId||'—'}`:(state.matchmade?'⚡ 快速匹配':'房號 '+(state.roomId||'—'));
  const isSpectator=state.mode==='spectator';
  const me=isSpectator?null:(state.players?.find(p=>p.pid===myPid)||state.players?.find(p=>p.color===myColor));
  const opp=state.mode==='ai'?{name:'電腦',avatar:'🤖',color:g==='xiangqi'?'black':g==='checkers'?'p1':(g==='banqi'||g==='darkbanqi'?(state.players?.[0]?.color===myColor?'black':'red'):'white'),pid:'ai'}:isSpectator?(state.players?.find(p=>p.pid!==state.players?.[0]?.pid)||state.players?.[1]||null):state.players?.find(p=>p.pid!==myPid);
  const specLeft=isSpectator?state.players?.[0]:me;
  const my=specLeft||{name:isSpectator?'等待玩家':'玩家',avatar:isSpectator?'❔':profile.avatar,color:isSpectator?(specLeft?.color||null):myColor};
  paintAvatar($('you-avatar'),my.avatar||'❔');$('you-name').textContent=(isSpectator?'👁 ':'')+(my.name||'玩家');$('you-side').textContent=sideName(my.color,g);
  paintAvatar($('opp-avatar'),opp?.avatar||'❔');$('opp-name').textContent=opp?.name||'等待對手';$('opp-side').textContent=sideName(opp?.color,g);
  $('copy-watch').hidden=!state.spectatorCode;
  if(state.spectatorCode)$('copy-watch').textContent=isSpectator?'複製觀戰碼':'👁 複製觀戰碼';
  renderBoard(previousBoard,previousHistory);renderHistory();renderTurn();updateCountdown();updateActions();renderChat();updateAiRpsPanel();
  $('game-notice').textContent=g==='xiangqi'?'將軍會顯示 1.5 秒毛筆字並播放機械音。':g==='gomoku'?'15×15 五連取勝；三種 AI 難度可選。':g==='go'?'19×19 圍棋：19路、氣、提子、自殺禁著、全盤同形禁重複、兩次停手進入終局結算。':g==='banqi'?'4×8 明棋：翻、走、吃，每回合只能做一種動作。':g==='darkbanqi'?'4×8 暗棋連吃：可連續吃棋並自行停止。':'多人跳棋：可走一步或等距跳躍，跳過的棋子不會被吃掉。';

  if(g==='go'&&state.score){$('game-notice').textContent=`終局：黑 ${Number(state.score.black).toFixed(2)} · 白 ${Number(state.score.white).toFixed(2)}；點選標記死棋並雙方確認。`;}
}
function updateAiRpsPanel(){
  const panel=$('ai-rps-panel');if(!panel)return;
  const active=state?.mode==='ai'&&isExtraMode(state?.gameMode)&&state?.rps?.phase==='rps'&&!state?.winner;
  panel.hidden=!active;
  if(active){
    const r=state.rps||{};let t=r.result||'請出拳。';
    if(r.youChoice)t='你已出拳，等待電腦…';else if(r.hasOpponentChoice)t='電腦已出拳，輪到你出拳。';
    $('ai-rps-status').textContent=t;document.querySelectorAll('[data-ai-rps-choice]').forEach(b=>b.disabled=!!r.youChoice);
  }
  const cp=$('ai-color-panel');if(!cp)return;
  const colorActive=state?.mode==='ai'&&state?.gameMode==='checkers'&&state?.rps?.phase==='choose-color'&&!state?.winner;
  cp.hidden=!colorActive;
  if(colorActive){
    const r=state.rps||{},picked=r.colorChoices||{},myTurn=r.colorTurnPid===myPid;
    $('ai-color-status').textContent=myTurn?'輪到你選顏色（紅／藍／綠）。':`等待${state.players?.find(p=>p.pid===r.colorTurnPid)?.name||'對手'}選顏色。`;
    const wrap=$('ai-color-buttons');wrap.innerHTML='';[['red','🔴 紅色'],['blue','🔵 藍色'],['green','🟢 綠色']].forEach(([c,label])=>{const b=document.createElement('button');b.textContent=label;b.disabled=(!myTurn)||!!picked[c];b.setAttribute('aria-disabled',String(b.disabled));b.onclick=()=>{send({action:'chooseColor',color:c});playSound('move')};wrap.appendChild(b)});
  }
}
function difficultyName(v){return v==='easy'?'簡單':v==='hard'?'困難':'普通';}
function currentBoardCell(r,c){return state?.board?.[r]?.[c]??null;}
function renderBoard(previousBoard=null,previousHistory=[]){
  const board=$('board');board.className='';
  const g=state?.gameMode||'xiangqi';board.dataset.mode=g;
  if(g==='xiangqi')renderXiangqiBoard(board,previousBoard,previousHistory);else if(g==='gomoku'||g==='go')renderGridBoard(board,g,previousHistory);else if(isBanqiMode(g))renderBanqiBoard(board,previousBoard,previousHistory);else renderCheckersBoard(board,previousBoard,previousHistory);
}
function renderXiangqiBoard(board,previousBoard=null,previousHistory=[]){
  board.innerHTML=`<svg class="board-lines" viewBox="0 0 8 9" preserveAspectRatio="none"><path d="M0 0H8 M0 1H8 M0 2H8 M0 3H8 M0 4H8 M0 5H8 M0 6H8 M0 7H8 M0 8H8 M0 9H8 M0 0V9 M1 0V9 M2 0V9 M3 0V9 M4 0V9 M5 0V9 M6 0V9 M7 0V9 M8 0V9"/><path d="M3 0L5 2 M5 0L3 2 M3 7L5 9 M5 7L3 9"/><path d="M0 4.5H8" stroke-dasharray=".09 .09"/></svg><div class="river">楚河 <span>漢界</span></div><div id="board-points"></div>`;
  const points=$('board-points'),hs=selected?hints(selected[0],selected[1]):[],hm=new Map(hs.map(x=>[`${x[0]},${x[1]}`,x[2]]));
  for(let r=0;r<10;r++)for(let c=0;c<9;c++){const el=document.createElement('button');el.type='button';el.className='point';el.dataset.r=r;el.dataset.c=c;el.style.left=`${c/8*100}%`;el.style.top=`${r/9*100}%`;const p=currentBoardCell(r,c),key=`${r},${c}`;if(selected?.[0]===r&&selected?.[1]===c)el.classList.add('selected');if(hm.has(key))el.classList.add('hint',hm.get(key));if(p&&CH[p.t]){const sp=document.createElement('span');sp.className=`piece ${p.t===p.t.toUpperCase()?'red':'black'}`;sp.textContent=CH[p.t];el.appendChild(sp)}el.onclick=()=>clickCell(r,c);points.appendChild(el);}
  const shouldAnimate=previousBoard&&previousHistory&&state.history?.length===previousHistory.length+1&&state.history.length;
  if(shouldAnimate)animateXiangqiMove(board,previousBoard,state.history[state.history.length-1]);
}
function renderGridBoard(board,g,previousHistory=[]){
  const n=Number(state.size)||(g==='gomoku'?15:19);
  board.innerHTML='';board.className='point-board board-'+g;board.style.setProperty('--n',n);
  const lines=document.createElement('div');lines.className='point-board-lines';
  for(let i=0;i<n;i++){
    const h=document.createElement('i');h.style.top=`${i/(n-1)*100}%`;lines.appendChild(h);
    const v=document.createElement('i');v.style.left=`${i/(n-1)*100}%`;lines.appendChild(v);
  }
  board.appendChild(lines);
  const starSet=new Set();
  if(g==='go'){
    for(const r of [3,9,15])for(const c of [3,9,15])starSet.add(`${r},${c}`);
  }else if(g==='gomoku'){
    for(const r of [3,7,11])for(const c of [3,7,11])starSet.add(`${r},${c}`);
  }
  const layer=document.createElement('div');layer.className='point-layer';board.appendChild(layer);
  for(let r=0;r<n;r++)for(let c=0;c<n;c++){
    const el=document.createElement('button');el.type='button';el.className='board-intersection';
    el.style.left=`${c/(n-1)*100}%`;el.style.top=`${r/(n-1)*100}%`;el.dataset.r=r;el.dataset.c=c;
    el.setAttribute('aria-label',`${r+1},${c+1} 交叉點`);
    if(starSet.has(`${r},${c}`))el.classList.add('star');
    const cell=currentBoardCell(r,c);
    if(cell)el.classList.add(cell==='black'?'stone-black':'stone-white');
    if(previousHistory?.length&&state.history?.length===previousHistory.length+1){const lm=state.history[state.history.length-1];if(!lm?.pass&&lm.move?.[0]===r+1&&lm.move?.[1]===c+1)el.classList.add('last-move');}
    if(g==='go' && state.goPhase==='scoring' && state.deadGroups?.some(key=>key.split(';').includes(`${r},${c}`)))el.classList.add('dead-marked');
    if(!cell && state.turn===myColor && !state.winner && (g!=='go'||state.goPhase!=='scoring'))el.classList.add('empty-intersection');
    el.onclick=()=>clickCell(r,c);layer.appendChild(el);
  }
}

function renderBanqiBoard(board,previousBoard=null,previousHistory=[]){
  const rows=Number(state.rows)||8,cols=Number(state.cols)||4;board.innerHTML='';board.className='banqi-board';
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
    const el=document.createElement('button');el.type='button';el.className='banqi-cell';el.dataset.r=r;el.dataset.c=c;
    const p=currentBoardCell(r,c);if(!p)el.classList.add('empty');else if(!p.revealed){el.classList.add('covered');el.innerHTML='<span class="banqi-cover-mark">暗</span>';}else{el.classList.add(p.color);el.textContent=banqiChar(p);if(selected?.[0]===r&&selected?.[1]===c)el.classList.add('selected');}
    const last=state.history?.[state.history.length-1];
    if(last?.reveal&&last.to?.[0]===r+1&&last.to?.[1]===c+1){el.classList.add('reveal-pulse');setTimeout(()=>el.classList.remove('reveal-pulse'),700);}
    el.onclick=()=>clickCell(r,c);board.appendChild(el);
  }
  if(previousBoard&&previousHistory?.length&&state.history?.length===previousHistory.length+1){
    const last=state.history[state.history.length-1];animateBanqiMove(board,previousBoard,last);
  }
}
function animateBanqiMove(board,previousBoard,move){
  if(move?.at&&!move.from)return;
  if(move?.reveal&&!move?.captured)return;
  if(!move?.from||!move?.to)return;
  const [r1,c1]=move.from.map(v=>v-1),[r2,c2]=move.to.map(v=>v-1),src=previousBoard?.[r1]?.[c1];if(!src)return;
  const layer=document.createElement('div');layer.className='banqi-motion-layer';board.appendChild(layer);const rect=board.getBoundingClientRect();
  const center=(r,c)=>({x:(c+.5)/4*rect.width,y:(r+.5)/8*rect.height});const a=center(r1,c1),b=center(r2,c2);const piece=document.createElement('div');piece.className=`banqi-motion-piece ${src.color}`;piece.textContent=banqiChar(src);layer.appendChild(piece);
  const distance=Math.hypot(b.x-a.x,b.y-a.y),capture=!!move.captured,duration=capture?520:360;
  let keyframes;if(capture)keyframes=[{transform:`translate(${a.x}px,${a.y}px) translate(-50%,-50%) scale(.95)`},{transform:`translate(${(a.x+b.x)/2}px,${(a.y+b.y)/2-8}px) translate(-50%,-50%) scale(1.08)`},{transform:`translate(${b.x}px,${b.y}px) translate(-50%,-50%) scale(1)`},{transform:`translate(${b.x}px,${b.y}px) translate(-50%,-50%) scale(1.12)`,offset:.88},{transform:`translate(${b.x}px,${b.y}px) translate(-50%,-50%) scale(1)`,offset:1}];else keyframes=[{transform:`translate(${a.x}px,${a.y}px) translate(-50%,-50%) scale(.96)`},{transform:`translate(${b.x}px,${b.y}px) translate(-50%,-50%) scale(1)` }];
  const anim=piece.animate(keyframes,{duration,easing:'cubic-bezier(.22,.8,.25,1)',fill:'both'});anim.finished.catch(()=>{}).finally(()=>layer.remove());
}
function banqiChar(p){if(!p)return '';const names={king:p.color==='red'?'帥':'將',advisor:p.color==='red'?'仕':'士',elephant:p.color==='red'?'相':'象',rook:p.color==='red'?'俥':'車',cannon:'炮',knight:p.color==='red'?'傌':'馬',pawn:p.color==='red'?'兵':'卒'};return names[p.type]||'暗';}
function checkerNeighborIds(id){const [q,r]=id.split(',').map(Number);return [[1,-1],[1,0],[0,1],[-1,1],[-1,0],[0,-1]].map(([dq,dr])=>`${q+dq},${r+dr}`);}
function renderCheckersBoard(board,previousBoard=null,previousHistory=[]){
  board.innerHTML='';board.className='checkers-board';
  const art=document.createElement('img');
  art.className='checker-reference-image';
  art.src=window.CHECKERS_REFERENCE_DATA_URL||'/checkers-board-reference.png?v=3.4.6';
  art.alt='跳棋棋盤';art.draggable=false;
  art.onerror=()=>{if(art.dataset.fallback!=='1'){art.dataset.fallback='1';art.src='/checkers-board-reference.webp?v=3.4.6';}};
  board.appendChild(art);
  const layer=document.createElement('div');layer.className='checker-hit-layer';board.appendChild(layer);
  for(const h of (state.holes||[])){
    const el=document.createElement('button');el.type='button';el.className='checker-hole';
    el.style.left=`${h.x*100}%`;el.style.top=`${h.y*100}%`;el.dataset.id=h.id;
    const occ=state.board?.[h.id];if(occ)el.classList.add(`stone-${occ}`);
    if(selected===h.id)el.classList.add('selected');
    if(state.chain?.pid===myPid&&state.chain.pos===h.id)el.classList.add('chain-selected');
    el.onclick=()=>clickCheckerHole(h.id);layer.appendChild(el);
  }
  if(previousBoard&&previousHistory?.length&&state.history?.length===previousHistory.length+1){
    animateCheckerMove(board,previousBoard,state.history[state.history.length-1]);
  }
}
function animateCheckerMove(board,previousBoard,move){
  if(!move?.from||!move?.to)return;const holes=new Map((state.holes||[]).map(h=>[h.id,h]));const a=holes.get(move.from),b=holes.get(move.to);if(!a||!b)return;
  const occ=previousBoard?.[move.from];if(!occ)return;const player=state.players?.find(p=>p.color===occ);const color=player?.color||occ;const layer=document.createElement('div');layer.className='checker-motion-layer';board.appendChild(layer);const rect=board.getBoundingClientRect(),p1={x:a.x*rect.width,y:a.y*rect.height},p2={x:b.x*rect.width,y:b.y*rect.height};const piece=document.createElement('div');piece.className=`checker-motion-piece ${color}`;layer.appendChild(piece);
  const jump=move.kind==='jump',duration=jump?460:300,dx=p2.x-p1.x,dy=p2.y-p1.y;let frames;if(jump){const lift=Math.max(18,Math.hypot(dx,dy)*.18);frames=[{transform:`translate(${p1.x}px,${p1.y}px) translate(-50%,-50%) scale(.9)`},{transform:`translate(${p1.x+dx*.5}px,${p1.y+dy*.5-lift}px) translate(-50%,-50%) scale(1.12)`},{transform:`translate(${p2.x}px,${p2.y}px) translate(-50%,-50%) scale(1)`}] }else frames=[{transform:`translate(${p1.x}px,${p1.y}px) translate(-50%,-50%) scale(.95)`},{transform:`translate(${p2.x}px,${p2.y}px) translate(-50%,-50%) scale(1)` }];const anim=piece.animate(frames,{duration,easing:'cubic-bezier(.2,.8,.25,1)',fill:'both'});anim.finished.catch(()=>{}).finally(()=>layer.remove());
}
function clickCheckerHole(id){
  if(!state||state.mode==='spectator'||state.winner||!isMyTurn())return;
  const mineColor=state.players?.find(p=>p.pid===myPid)?.color;
  const occ=state.board?.[id]||null,chainActive=state.chain?.pid===myPid;
  if(!selected){if(occ===mineColor){selected=id;playSound('select');renderBoard();}return;}
  if(selected===id){selected=null;renderBoard();return;}
  if(chainActive&&occ===mineColor){send({action:'stopChain'});selected=null;renderBoard();return;}
  if(chainActive&&!occ){send({action:'stopChain'});selected=null;renderBoard();return;}
  send({action:'move',from:selected,to:id});selected=null;playSound('move');renderBoard();
}
function renderHistory(){
  const hist=state.history||[];$('move-count').textContent=`${hist.length} 手`;
  $('history').innerHTML=hist.map(x=>{
    if(state.gameMode==='xiangqi')return`<div class="hist"><b>${x.n}.</b> ${x.color==='red'?'紅':'黑'}${x.piece} <span>(${x.from[0]},${x.from[1]})→(${x.to[0]},${x.to[1]})</span>${x.captured?` <em>吃${x.captured}</em>`:''}</div>`;
    if(isBanqiMode(state.gameMode))return`<div class="hist"><b>${x.n}.</b> ${x.color==='red'?'紅':'黑'} ${x.move||'動作'}${x.piece?` ${x.piece}`:''}${x.captured?` <em>吃 ${x.captured}</em>`:''}${x.reveal?` <em>翻開 ${x.revealedPiece||''}</em>`:''}</div>`;
    if(state.gameMode==='checkers')return`<div class="hist"><b>${x.n}.</b> 第${Number(String(x.color).slice(1))+1}位 ${x.kind==='jump'?'跳':'走'} ${x.from}→${x.to}</div>`;
    return`<div class="hist"><b>${x.n}.</b> ${x.color==='black'?'黑':'白'} ${x.pass?'停手':`(${x.move[0]},${x.move[1]})`}${x.captured?` <em>吃 ${x.captured}</em>`:''}</div>`;
  }).join('')||'<div class="hist">尚未有走棋紀錄</div>';
}
function renderTurn(){
  if(state.winner){$('turn-message').textContent=state.endedReason||`結果：${state.winner==='draw'?'和棋':sideName(state.winner,state.gameMode)}`;return}
  if(state.gameMode==='go'&&state.goPhase==='scoring'){$('turn-message').textContent='終局結算：點擊你認為的死棋標記，再按「確認結算」。';return}
  if(isExtraMode(state.gameMode)){const tp=state.players?.find(p=>p.pid===state.turn) || (state.mode==='ai'&&state.turn==='ai'?{name:'電腦',color:state.gameMode==='checkers'?'p1':state.gameMode==='banqi'||state.gameMode==='darkbanqi'?state.players?.find(p=>p.pid===myPid)?.color:'black'}:null);$('turn-message').textContent=isMyTurn()?'輪到你：請行動':tp?`等待 ${tp.name} 行動`:'等待開始…';}else $('turn-message').textContent=state.turn===myColor?'輪到你：請走棋':state.turn?`等待${sideName(state.turn,state.gameMode)}走棋`:'等待開始…';
}
function updateCountdown(){
  clearInterval(clockTimer);
  const tick=()=>{if(!state?.turnDeadline||state.winner){$('countdown').textContent='—';return}$('countdown').textContent=String(Math.max(0,Math.ceil((state.turnDeadline-Date.now())/1000))).padStart(2,'0')};
  tick();clockTimer=setInterval(tick,250);
}
function updateActions(){
  const spectator=state?.mode==='spectator';
  const myTurn=isMyTurn()&&state?.goPhase!=='scoring';
  $('undo-btn').disabled=!myTurn||!(state.history?.length);
  $('draw-btn').disabled=!myTurn;
  $('pass-btn').hidden=!(['go','darkbanqi','checkers'].includes(state?.gameMode));
  if(state?.gameMode==='darkbanqi'){ $('pass-btn').disabled=spectator||!(state?.chain?.pid===myPid); $('pass-btn').textContent='⏹ 停止連吃'; }
  else if(state?.gameMode==='checkers'){ $('pass-btn').disabled=spectator||!(state?.chain?.pid===myPid); $('pass-btn').textContent='⏹ 停止連跳'; }
  else if(state?.gameMode==='go'&&state?.goPhase==='scoring'){$('pass-btn').hidden=false;$('pass-btn').disabled=spectator||!!state.scoreConfirm?.[myPid];$('pass-btn').textContent=state.scoreConfirm?.[myPid]?'✅ 已確認':'✅ 確認結算';}
  else{$('pass-btn').textContent='⏸ 停一手';$('pass-btn').disabled=spectator||!myTurn||!!state?.winner;}
  $('rematch-btn').disabled=spectator||!state?.winner;
  $('rematch-btn').textContent=state?.mode==='ai'?(state?.winner?'🔁 再來一局':'🔁 再戰'):'🔁 再戰';
  $('sound-btn').textContent=`${soundOn?'🔊 音效：開':'🔇 音效：關'}`;
  $('actions-card').hidden=spectator;
  const chatDisabled=state?.mode!=='online'||state?.rps?.phase!=='done'||(!state?.turn&&state?.goPhase!=='scoring')||!!state?.winner||spectator;
  $('chat-input').disabled=chatDisabled;$('chat-send').disabled=chatDisabled;
}
function renderChat(){
  const box=$('chat-messages'),messages=state?.chat||[];$('chat-count').textContent=messages.length?`${messages.length} 則`:'';
  box.innerHTML='';
  if(state?.mode==='ai'){const e=document.createElement('div');e.className='chat-empty';e.textContent='單人模式沒有對手聊天室。';box.appendChild(e);return}
  if(state?.mode==='spectator'&&!messages.length){const e=document.createElement('div');e.className='chat-empty';e.textContent='觀戰模式：聊天室僅供閱讀。';box.appendChild(e);return}
  if(!messages.length){const e=document.createElement('div');e.className='chat-empty';e.textContent='和對手說點什麼吧。';box.appendChild(e);return}
  messages.forEach(m=>{const row=document.createElement('div');row.className='chat-row '+(m.pid===myPid?'mine':'');const av=document.createElement('div');av.className='chat-avatar avatar';paintAvatar(av,m.avatar);const wrap=document.createElement('div');wrap.className='chat-bubble-wrap';const name=document.createElement('div');name.className='chat-name';name.textContent=m.name||'玩家';const bubble=document.createElement('div');bubble.className='chat-bubble';bubble.textContent=m.text||'';wrap.append(name,bubble);row.append(av,wrap);box.appendChild(row)});
  box.scrollTop=box.scrollHeight;
}
function sendChat(){const input=$('chat-input'),text=input.value.trim();if(!text||state?.mode!=='online')return;send({action:'chat',text});input.value='';}
function mineXQ(p){return myColor==='red'?p.t===p.t.toUpperCase():p.t===p.t.toLowerCase();}
function clearPathXQ(r1,c1,r2,c2){const dr=Math.sign(r2-r1),dc=Math.sign(c2-c1);let r=r1+dr,c=c1+dc;while(r!==r2||c!==c2){if(currentBoardCell(r,c))return false;r+=dr;c+=dc}return true;}
function insideXQ(r,c){return r>=0&&r<10&&c>=0&&c<9;}
function palaceXQ(r,c,color){return c>=3&&c<=5&&(color==='red'?r<=2:r>=7);}
function canMoveXQ(r1,c1,r2,c2,p){
  if(r1===r2&&c1===c2)return false;if(!insideXQ(r2,c2)||(currentBoardCell(r2,c2)&&mineXQ(currentBoardCell(r2,c2))))return false;
  const t=p.t.toLowerCase(),dr=r2-r1,dc=c2-c1,ar=Math.abs(dr),ac=Math.abs(dc);
  if(t==='k'){const d=currentBoardCell(r2,c2),fc=d&&d.t.toLowerCase()==='k'&&dc===0&&clearPathXQ(r1,c1,r2,c2);return fc||(ar+ac===1&&palaceXQ(r2,c2,myColor));}
  if(t==='a')return ar===1&&ac===1&&palaceXQ(r2,c2,myColor);
  if(t==='b')return ar===2&&ac===2&&((myColor==='red'&&r2<=4)||(myColor==='black'&&r2>=5))&&!currentBoardCell(r1+dr/2,c1+dc/2);
  if(t==='n'){if(!((ar===2&&ac===1)||(ar===1&&ac===2)))return false;const lr=r1+(ar===2?Math.sign(dr):0),lc=c1+(ac===2?Math.sign(dc):0);return !currentBoardCell(lr,lc);}
  if(t==='r')return(dr===0||dc===0)&&clearPathXQ(r1,c1,r2,c2);
  if(t==='c'){if(dr!==0&&dc!==0)return false;let n=0,sr=Math.sign(dr),sc=Math.sign(dc),r=r1+sr,c=c1+sc;while(r!==r2||c!==c2){if(currentBoardCell(r,c))n++;r+=sr;c+=sc}return currentBoardCell(r2,c2)?n===1:n===0;}
  if(t==='p'){const f=myColor==='red'?1:-1,crossed=myColor==='red'?r1>=5:r1<=4;return(dr===f&&dc===0)||(crossed&&dr===0&&ac===1);}
  return false;
}
function hints(r,c){const p=currentBoardCell(r,c),out=[];if(!p)return out;for(let rr=0;rr<10;rr++)for(let cc=0;cc<9;cc++)if(canMoveXQ(r,c,rr,cc,p))out.push([rr,cc,currentBoardCell(rr,cc)?'capture':'move']);return out;}
function clickCell(r,c){
  if(!state||state.mode==='spectator'||state.winner||!isMyTurn())return;
  const g=state.gameMode;
  if(g==='xiangqi'){
    const p=currentBoardCell(r,c);
    if(!selected){if(p&&mineXQ(p)){selected=[r,c];playSound('select');renderBoard()}return}
    if(p&&mineXQ(p)){selected=[r,c];renderBoard();return}
    if(canMoveXQ(selected[0],selected[1],r,c,currentBoardCell(selected[0],selected[1]))){const target=currentBoardCell(r,c);send({action:'move',r1:selected[0],c1:selected[1],r2:r,c2:c});playSound(target?'capture':'move')}
    selected=null;renderBoard();return;
  }
  if(g==='gomoku'){if(currentBoardCell(r,c))return;send({action:'move',r,c});playSound('move');return;}
  if(g==='go'){if(state.goPhase==='scoring'){if(currentBoardCell(r,c)){send({action:'goToggleDead',r,c});playSound('select');}return}if(currentBoardCell(r,c))return;send({action:'move',r,c});playSound('move');return;}
  if(isBanqiMode(g)){
    const p=currentBoardCell(r,c),chainActive=state.chain?.pid===myPid;
    if(!selected){
      if(!p)return;
      if(!p.revealed){send({action:'move',subaction:'flip',r,c});return;}
      if(p.color===myColor){selected=[r,c];playSound('select');renderBoard();}
      return;
    }
    if(chainActive){
      // 連吃中：點任何鄰近／炮可飛到的位置都送 capture；伺服器負責判定。
      // 暗棋若碰到未翻開己方棋，伺服器會揭露並讓攻擊棋留在原位。
      send({action:'move',subaction:'capture',r:selected[0],c:selected[1],toR:r,toC:c});
      selected=null;playSound(p?.color===myColor?'select':'capture');renderBoard();return;
    }
    if(!p){
      send({action:'move',subaction:'move',r:selected[0],c:selected[1],toR:r,toC:c});
      selected=null;playSound('move');renderBoard();return;
    }
    if(p.color===myColor){selected=[r,c];playSound('select');renderBoard();return;}
    send({action:'move',subaction:'capture',r:selected[0],c:selected[1],toR:r,toC:c});
    selected=null;playSound('capture');renderBoard();return;
  }
}

function animateXiangqiMove(board,previousBoard,move){
  if(!move||!move.from||!move.to||!previousBoard)return;
  const r1=move.from[0]-1,c1=move.from[1]-1,r2=move.to[0]-1,c2=move.to[1]-1;
  const src=previousBoard?.[r1]?.[c1];if(!src)return;
  const layer=document.createElement('div');layer.className='motion-layer';board.appendChild(layer);
  const rect=board.getBoundingClientRect(),x1=c1/8*rect.width,y1=r1/9*rect.height,x2=c2/8*rect.width,y2=r2/9*rect.height;
  const dx=x2-x1,dy=y2-y1,dist=Math.hypot(dx,dy),angle=Math.atan2(dy,dx)*180/Math.PI;
  const line=document.createElement('div');line.className='move-trace-line';line.style.left=`${x1}px`;line.style.top=`${y1}px`;line.style.width=`${dist}px`;line.style.transform=`rotate(${angle}deg) scaleX(0)`;layer.appendChild(line);
  const piece=document.createElement('div');piece.className=`motion-piece ${src.t===src.t.toUpperCase()?'red':'black'}`;piece.textContent=CH[src.t]||'';layer.appendChild(piece);
  const targetEl=board.querySelector(`.point[data-r="${r2}"][data-c="${c2}"]`);if(targetEl)targetEl.classList.add('anim-target');
  const type=src.t.toLowerCase();
  let duration=430,keyframes;
  if(type==='c'&&move.captured){duration=650;const hop=-Math.min(26,Math.max(10,dist*.08));const nx=-dy/(dist||1)*hop,ny=dx/(dist||1)*hop;keyframes=[{transform:`translate(${x1}px,${y1}px) translate(-50%,-50%) rotate(0deg) scale(.94)`},{transform:`translate(${x1+dx*.45+nx}px,${y1+dy*.45+ny}px) translate(-50%,-50%) rotate(${angle+8}deg) scale(1.12)`},{transform:`translate(${x1+dx*.72-nx*.45}px,${y1+dy*.72-ny*.45}px) translate(-50%,-50%) rotate(${angle-5}deg) scale(1.06)`},{transform:`translate(${x2}px,${y2}px) translate(-50%,-50%) rotate(0deg) scale(1)`}]}
  else if(type==='n'){duration=520;keyframes=[{transform:`translate(${x1}px,${y1}px) translate(-50%,-50%) scale(.92) rotate(-8deg)`},{transform:`translate(${x1+dx*.5}px,${y1+dy*.5-Math.min(18,dist*.05)}px) translate(-50%,-50%) scale(1.08) rotate(8deg)`},{transform:`translate(${x2}px,${y2}px) translate(-50%,-50%) scale(1) rotate(0deg)`}]}
  else if(type==='p'){duration=300;keyframes=[{transform:`translate(${x1}px,${y1}px) translate(-50%,-50%) scale(.9)`},{transform:`translate(${x1+dx}px,${y1+dy}px) translate(-50%,-50%) scale(1.03)`},{transform:`translate(${x2}px,${y2}px) translate(-50%,-50%) scale(1)`}]}
  else{duration=460;keyframes=[{transform:`translate(${x1}px,${y1}px) translate(-50%,-50%) scale(.98)`},{transform:`translate(${x2}px,${y2}px) translate(-50%,-50%) scale(1)`}]}
  const anim=piece.animate(keyframes,{duration,easing:type==='c'&&move.captured?'cubic-bezier(.2,.85,.25,1)':'cubic-bezier(.22,.75,.28,1)',fill:'both'});
  line.animate([{transform:`rotate(${angle}deg) scaleX(0)`,opacity:0},{transform:`rotate(${angle}deg) scaleX(1)`,opacity:.85},{transform:`rotate(${angle}deg) scaleX(.98)`,opacity:0}],{duration:Math.min(430,duration),easing:'ease-out',fill:'both'});
  anim.finished.catch(()=>{}).finally(()=>{if(targetEl)targetEl.classList.remove('anim-target');layer.remove();});
}
function showCheck(ev){
  if(!ev||ev.id===lastCheckId)return;lastCheckId=ev.id;
  const o=$('check-overlay'),w=o.querySelector('.check-ink');$('check-target').textContent=ev.target==='red'?'紅方帥受到攻擊':'黑方將受到攻擊';o.hidden=false;w.classList.remove('ink-pop');void w.offsetWidth;w.classList.add('ink-pop');speakCheck();clearTimeout(checkTimer);checkTimer=setTimeout(()=>o.hidden=true,1500);
}
function speakCheck(){if(!soundOn||!('speechSynthesis'in window))return;try{speechSynthesis.cancel();const u=new SpeechSynthesisUtterance('將軍');u.lang='zh-TW';u.rate=.7;u.pitch=.55;u.volume=1;const vs=speechSynthesis.getVoices();u.voice=vs.find(v=>/^zh-TW/i.test(v.lang))||vs.find(v=>/^zh/i.test(v.lang))||null;speechSynthesis.speak(u)}catch{}}
function playSound(kind){if(!soundOn)return;try{const AC=window.AudioContext||window.webkitAudioContext,ac=new AC(),o=ac.createOscillator(),gn=ac.createGain();o.type=kind==='capture'?'square':'sine';o.frequency.value=kind==='capture'?210:430;gn.gain.setValueAtTime(.0001,ac.currentTime);gn.gain.exponentialRampToValueAtTime(kind==='capture'?.06:.035,ac.currentTime+.01);gn.gain.exponentialRampToValueAtTime(.0001,ac.currentTime+.13);o.connect(gn).connect(ac.destination);o.start();o.stop(ac.currentTime+.14);setTimeout(()=>ac.close(),220)}catch{}}
function showProposal(kind,fromName){$('confirm-title').textContent=kind==='undo'?'對方要求悔棋':'對方提出和棋';$('confirm-text').textContent=kind==='undo'?`${fromName} 想把棋局退回上一手，是否接受？`:`${fromName} 想與你和棋，是否接受？`;$('confirm-overlay').hidden=false;}
function showRematchInvite(name){$('rematch-title').textContent=`${name||'對方'}邀你進行下一場`;$('rematch-panel').hidden=false;}
function hideRematchInvite(){$('rematch-panel').hidden=true;}
function copyText(t){navigator.clipboard?.writeText(t).then(()=>toast('已複製')).catch(()=>toast('瀏覽器不允許自動複製，請手動複製','error'));}

document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{selectedGameMode=b.dataset.mode;document.querySelectorAll('.game-mode').forEach(x=>x.classList.toggle('selected',x.dataset.mode===selectedGameMode));$('checkers-player-wrap').hidden=selectedGameMode!=='checkers';toast(`已選擇：${modeName(selectedGameMode)}`)});
$('matchmaking-cancel').onclick=()=>send({action:'cancelMatchmake'});
$('home-watch').onclick=()=>{const room=$('home-watch-room').value.trim().toUpperCase();if(!room)return toast('請先輸入觀戰碼','error');ensureSavedProfile();connect();const go=()=>ws.readyState===WebSocket.OPEN?send({action:'watch',roomId:room,name:profile.name,avatar:profile.avatar,profileId:profile.id}):setTimeout(go,40);go()};
$('home-match').onclick=startMatchmaking;
$('home-online').onclick=()=>{ensureSavedProfile();connect();const go=()=>ws.readyState===WebSocket.OPEN?send({action:'create',mode:selectedGameMode,playerCount:selectedGameMode==='checkers'?Number($('checkers-player-count').value):2,name:profile.name,avatar:profile.avatar,profileId:profile.id}):setTimeout(go,40);go()};
$('home-join').onclick=()=>{const room=$('home-room').value.trim().toUpperCase();if(!room)return toast('請先輸入房號','error');ensureSavedProfile();connect();const go=()=>ws.readyState===WebSocket.OPEN?send({action:'join',roomId:room,name:profile.name,avatar:profile.avatar,profileId:profile.id}):setTimeout(go,40);go()};
$('home-ai').onclick=()=>{ensureSavedProfile();const difficulty=$('home-difficulty').value;connect();const go=()=>ws.readyState===WebSocket.OPEN?send({action:'ai',mode:selectedGameMode,name:profile.name,avatar:profile.avatar,profileId:profile.id,difficulty}):setTimeout(go,40);go()};
$('back-home').onclick=$('game-home').onclick=()=>{try{ws?.close()}catch{}state=null;selected=null;myColor=null;myPid=null;hideRematchInvite();showScreen('home-screen');loadProfile()};
$('copy-room').onclick=()=>copyText(state?.roomId||$('lobby-room').textContent);
$('copy-watch').onclick=()=>copyText(state?.spectatorCode||state?.roomId||'');
$('lobby-copy-share').onclick=()=>copyText(`來玩${modeName(state?.gameMode||selectedGameMode)} Online！房號：${state?.roomId||$('lobby-room').textContent}`);
document.querySelectorAll('[data-choice]').forEach(b=>b.onclick=()=>{send({action:'rps',choice:b.dataset.choice});playSound('select')});
document.querySelectorAll('[data-ai-rps-choice]').forEach(b=>b.onclick=()=>{if(state?.mode==='ai'&&state?.rps?.phase==='rps'&&!state.rps.youChoice){send({action:'rps',choice:b.dataset.aiRpsChoice});playSound('select')}});
$('undo-btn').onclick=()=>send({action:'proposal',kind:'undo'});
$('draw-btn').onclick=()=>send({action:'proposal',kind:'draw'});
$('pass-btn').onclick=()=>{if(state?.gameMode==='go'&&state?.goPhase==='scoring')send({action:'goConfirmScore'});else if(state?.gameMode==='darkbanqi')send({action:'stopChain'});else if(state?.gameMode==='checkers')send({action:'stopChain'});else send({action:'pass'});};
$('resign-btn').onclick=()=>{if(state?.winner)return;if(confirm('確定要投降嗎？投降後本局立即判負。'))send({action:'resign'});};
$('rematch-btn').onclick=()=>{if(state?.mode==='ai')send({action:'aiRematch'});else send({action:'inviteRematch'})};
$('sound-btn').onclick=()=>{soundOn=!soundOn;$('sound-btn').textContent=`${soundOn?'🔊 音效：開':'🔇 音效：關'}`;if(soundOn)playSound('select')};
$('confirm-yes').onclick=()=>{send({action:'proposalResponse',accept:true});$('confirm-overlay').hidden=true};$('confirm-no').onclick=()=>{send({action:'proposalResponse',accept:false});$('confirm-overlay').hidden=true};
$('accept-rematch').onclick=()=>{send({action:'rematchResponse',accept:true});hideRematchInvite()};$('reject-rematch').onclick=()=>{send({action:'rematchResponse',accept:false});hideRematchInvite()};
$('chat-send').onclick=sendChat;$('chat-input').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendChat()}});
hideRematchInvite();$('rps-panel').hidden=true;$('color-panel').hidden=true;$('confirm-overlay').hidden=true;$('checkers-player-wrap').hidden=selectedGameMode!=='checkers';setupProfileUI();loadProfile();connect();

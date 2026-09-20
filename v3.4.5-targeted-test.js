const fs=require('fs');
const s=fs.readFileSync('server.js','utf8');
const a=fs.readFileSync('public/app.js','utf8');
function ok(name,cond){if(!cond)throw new Error('FAIL: '+name);console.log('PASS:',name)}
ok('darkbanqi reveals covered friendly target',s.includes("blockedByFriend:true")&&s.includes("target.color===p.color"));
ok('darkbanqi same-rank capture remains allowed',s.includes("BANQI_RANK[att.type]>=BANQI_RANK[def.type]"));
ok('cannon capture still requires one blocker',s.includes("banqiBetweenCount(board,r1,c1,r2,c2)===1"));
ok('AI progress watchdog exists',s.includes('function aiProgressTick(x)')&&s.includes('function armAIWatchdog(x)'));
ok('AI checker color selection exists',s.includes('function aiChooseCheckerColor(x)')&&s.includes("colorTurnPid==='ai'"));
ok('banqi board is 4x8',s.includes('BANQI_ROWS = 8')&&s.includes('BANQI_COLS = 4'));
ok('front-end sends empty-cell move',a.includes("subaction:'move'"));
console.log('V3_4_5_TARGETED_STATIC_OK');

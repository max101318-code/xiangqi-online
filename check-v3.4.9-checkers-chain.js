const fs=require('fs');
const server=fs.readFileSync(require('path').join(__dirname,'server.js'),'utf8');
const app=fs.readFileSync(require('path').join(__dirname,'public','app.js'),'utf8');
const checks=[
  ['server keeps jump chain when another jump exists',/kind==='jump' && checkerHasAnyJump\(x,to\)\)\{[\s\S]*?g\.chain=\{pid:p\.pid,pos:to\};[\s\S]*?return\{ok:true\};/],
  ['server switches turn after chain ends',/g\.chain=null;\s*g\.turn=nextCheckerPid\(x,p\.pid\);\s*setTurnDeadline\(x\);/],
  ['server forbids changing piece during chain',/if\(chain && from!==g\.chain\.pos\)return\{error:'連跳中必須使用同一顆棋子'\}/],
  ['AI chain only jumps from current chain position',/const chainPos=g\.chain\?\.pid==='ai'\?g\.chain\.pos:null;[\s\S]*?if\(chainPos\)\{[\s\S]*?addMovesForPiece\(chainPos,false\)/],
  ['client does not stop chain by clicking empty point',/if\(chainActive\)\{[\s\S]*?if\(!occ\)\{send\(\{action:'move',from:state\.chain\.pos,to:id\}\)/],
  ['client exposes explicit stop-chain action',/send\(\{action:'stopChain'\}\)/]
];
for(const [name,re] of checks){if(!re.test(server+app))throw new Error('FAIL: '+name);}
console.log('V3_4_9_CHECKERS_CHAIN_REGRESSION_OK');

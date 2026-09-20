const fs=require('fs'),path=require('path');
const server=fs.readFileSync(path.join(__dirname,'server.js'),'utf8');
const app=fs.readFileSync(path.join(__dirname,'public','app.js'),'utf8');
const checks=[
  ['server stores previous jump endpoints in chain',/g\.chain=\{pid:p\.pid,pos:to,from,to\}/],
  ['server forbids immediate reverse during chain',/chain&&kind==='jump'&&g\.chain\.from===to/],
  ['server only continues when another non-reverse jump exists',/checkerHasAnyJump\(x,to,from\)/],
  ['AI skips immediate reverse during chain',/if\(chainPos&&to===forbiddenBack\)continue/],
  ['AI evaluates another jump without immediate reverse',/checkerHasAnyJump\(x,to,id\)/],
  ['no checkers stalemate loss from no jump',/if\(!moves\.length\)return null/]
];
for(const [name,re] of checks)if(!re.test(server+app))throw new Error('FAIL '+name);
console.log('V3_4_13_CHECKERS_DIRECTION_REGRESSION_OK');

const fs=require('fs'), vm=require('vm'), path=require('path'), crypto=require('crypto');
const source=fs.readFileSync(path.join(__dirname,'server.js'),'utf8');
const req=(name)=>name==='ws'?{}:require(name);
const logic=source.slice(0, source.indexOf('const server=http.createServer'));
const ctx={require:req,console,process:{env:{}},crypto,Array,Math,JSON,Date,Set,Map,__dirname:__dirname};
vm.createContext(ctx);vm.runInContext(logic,ctx);
function boardWith(k1,k2,extra=[]){
  const b=Array.from({length:10},()=>Array(9).fill(null));
  b[k1[0]][k1[1]]={t:'K'};b[k2[0]][k2[1]]={t:'k'};
  for(const [t,r,c] of extra)b[r][c]={t};
  return {b};
}
let g=boardWith([0,4],[9,4]);
if(ctx.legal(g,{color:'red'},0,4,9,4)!==null) throw new Error('red king capture should be legal');
if(ctx.legal(g,{color:'black'},9,4,0,4)!==null) throw new Error('black king capture should be legal');
if(ctx.isAttacked(g,'red',9,4)!==true) throw new Error('facing kings should count as attack/check');
if(ctx.isAttacked(g,'black',0,4)!==true) throw new Error('facing kings should count both ways');
let g2=boardWith([0,4],[7,4]);
if(ctx.legal(g2,{color:'red'},0,4,3,4)===null) throw new Error('king must not leave palace without facing-king capture');
let g3=boardWith([0,4],[9,4],[['P',3,4]]);
if(ctx.legal(g3,{color:'red'},0,4,9,4)===null) throw new Error('blocked kings must not capture through a piece');
console.log('KING_FACING_TEST_OK');

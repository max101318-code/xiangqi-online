const fs=require('fs');
const vm=require('vm');
const src=fs.readFileSync(require('path').join(__dirname,'server.js'),'utf8');
const prefix=src.slice(0,src.indexOf("const server=http.createServer"));
const code=prefix+`\n;globalThis.__T={applyBanqi,aiBanqiAction,banqiAIAllCandidates,aiCheckersMove};\n`;
const ctx={require,console,Buffer,process,Date,Math,JSON,Set,Map,Object,Array,String,Number,RegExp,Infinity};
vm.createContext(ctx);vm.runInContext(code,ctx);
const T=ctx.__T;
function freshBanqi(){return {mode:'darkbanqi',ai:false,players:[],g:{board:Array.from({length:8},()=>Array(4).fill(null)),turn:'human',winner:null,turnDeadline:null,history:[],move:1,chain:null},undoStack:[]};}
{
  const x=freshBanqi();
  x.players=[{pid:'human',color:'red',connected:true},{pid:'enemy',color:'black',connected:true}];
  const attacker={color:'red',type:'rook',revealed:true,id:'a'};
  const friendHidden={color:'red',type:'pawn',revealed:false,id:'h'};
  x.g.board[0][0]=attacker; x.g.board[0][1]=friendHidden;
  const res=T.applyBanqi(x,x.players[0],{action:'capture',r:0,c:0,toR:0,toC:1});
  if(!res.ok||!x.g.board[0][1]?.revealed||x.g.board[0][0]!==attacker||x.g.turn!=='enemy')throw new Error('darkbanqi friendly covered reveal failed');
}
{
  const x=freshBanqi(); x.ai=true; x.aiColor='red';
  x.players=[{pid:'human',color:'black',connected:true},{pid:'ai',color:'red',connected:true}]; x.g.turn='ai';
  // One revealed AI rook is trapped by four enemy pieces; another revealed AI pawn has an open square.
  x.g.board[0][0]={color:'red',type:'rook',revealed:true,id:'trap'};
  x.g.board[1][0]={color:'black',type:'rook',revealed:true,id:'b1'};
  x.g.board[0][1]={color:'black',type:'rook',revealed:true,id:'b2'};
  x.g.board[1][1]={color:'black',type:'rook',revealed:true,id:'b3'};
  x.g.board[7][3]={color:'red',type:'pawn',revealed:true,id:'mobile'};
  const c=T.banqiAIAllCandidates(x,{pid:'ai',color:'red'});
  if(!c.some(m=>m.action==='move'&&m.r===7&&m.c===3))throw new Error('AI did not inspect other movable piece');
  const before=JSON.stringify(x.g.board); const res=T.aiBanqiAction(x); if(!res.ok)throw new Error('AI failed despite another legal piece');
}
// Static guard for the anti-bounce rule.
if(!/reverseCount>=2/.test(prefix))throw new Error('AI reverse limit missing');
if(!/x\.aiReverseCount=reversing\?reverseCount\+1:0/.test(prefix))throw new Error('AI reverse counter update missing');
console.log('V3_4_11_TARGETED_REGRESSION_OK');

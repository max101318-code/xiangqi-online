// static regression checks for v3.4.14
const fs=require('fs');
const s=fs.readFileSync(require('path').join(__dirname,'server.js'),'utf8');
if(!/function checkerDestinationAllowed\(x,pid,to\)/.test(s)) throw new Error('missing checkerDestinationAllowed');
if(!/return target\.includes\(to\)/.test(s)) throw new Error('target camp rule missing');
if(!/checkerCanStep\(x,pid,from,to\).*checkerDestinationAllowed/.test(s)) throw new Error('step restriction missing');
if(!/checkerCanJump\(x,from,to,p\.pid\)/.test(s)) throw new Error('human jump destination restriction missing');
if(!/checkerCanJump\(x,id,to,'ai'\)/.test(s)) throw new Error('AI jump destination restriction missing');
console.log('V3_4_14_CHECKERS_CAMP_BOUNDARY_REGRESSION_OK');

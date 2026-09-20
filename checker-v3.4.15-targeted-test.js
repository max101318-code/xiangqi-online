const fs=require('fs'),path=require('path');
const s=fs.readFileSync(path.join(__dirname,'server.js'),'utf8');
const required=[
 /const CHECKER_FRONT_ROWS=\[/,
 /const CHECKER_FRONT_ROW_SET=CHECKER_FRONT_ROWS\.map\(row=>new Set\(row\)\)/,
 /if\(\(p\.camp\|\|\[\]\)\.includes\(to\) \|\| \(p\.targetCamp\|\|\[\]\)\.includes\(to\)\)return true/,
 /q\.camp\|\|\[\]\)\.includes\(to\)/,
 /CHECKER_FRONT_ROW_SET\[arm\]/,
 /Board Arena Online v3\.4\.15 multi-game/
];
for(const r of required)if(!r.test(s))throw new Error('missing rule '+r);
console.log('V3_4_15_CHECKER_FRONT_ROW_RULE_OK');

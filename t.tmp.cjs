const os=require('os'),path=require('path'),fs=require('fs');
const H={};const ipc={handle:(c,f)=>H[c]=f};const home=fs.mkdtempSync(path.join(os.tmpdir(),'mmrh-'));
require('./src/main/clouds.cjs').registerClouds(ipc,home);
(async()=>{const f='C:/Users/GClin/AppData/Local/Temp/claude/ba4570d2a4075cf0/92bd6225-68ae-40e9-b1fe-d816f093ee06/scratchpad/building.copc.laz';
const o=await H['cloud:open'](null,{file:f});const n=o.root.children.find(Boolean);
const b=await H['cloud:read-node'](null,{file:f,byteOffset:n.byteOffset,byteSize:n.byteSize});
const L=await import('./src/core/laz.js');const LP=await L.loadLazPerf();const d=L.decodeChunk(LP,o.header,new Uint8Array(b),n.numPoints);
const orig=await L.parseLaz(fs.readFileSync('C:/Users/GClin/Documents/Sketchup/23 Te ara Crescent/23 te ara crescent_Building.laz'));
const ref=orig.parts[1];let diff=0,cls=0;for(let i=0;i<d.count;i++){diff=Math.max(diff,Math.abs(d.x[i]-ref.x[i]),Math.abs(d.z[i]-ref.z[i]),Math.abs(d.gpsTime[i]-ref.gpsTime[i]));cls+=d.classification[i]!==ref.classification[i];}
console.log(n.name,d.count,'max diff vs LAZ chunk',diff,'class mismatches',cls);
fs.rmSync(home,{recursive:true,force:true});})().catch(e=>console.log('ERR',e.message));

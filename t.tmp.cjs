const os=require('os'),path=require('path'),fs=require('fs');
const H={};const ipc={handle:(c,f)=>H[c]=f};
const home=fs.mkdtempSync(path.join(os.tmpdir(),'mmrh-'));
require('./src/main/clouds.cjs').registerClouds(ipc,home);
(async()=>{const file=process.argv[2];const t=Date.now();let j=await H['cloud:convert'](null,{path:file});
while(j.status==='running'){await new Promise(r=>setTimeout(r,500));j=await H['cloud:job'](null,j.id);process.stdout.write(`${j.stage} ${(j.fraction*100).toFixed(0)}% `);}
console.log('\n',j.status,j.error||'',j.points,Date.now()-t,'ms', process.memoryUsage().rss/1e6|0);
const p=await H['cloud:job'](null,j.id,{preview:true});console.log('preview',p.preview?.count);
const o=await H['cloud:open'](null,{folder:j.folder});console.log(o.kind,o.metadata.points,o.root.numPoints);
const b=await H['cloud:read-node'](null,{folder:j.folder,byteOffset:o.root.byteOffset,byteSize:o.root.byteSize});console.log('root bytes',b.byteLength);
const j2=await H['cloud:convert'](null,{path:file});console.log('again',j2.status,j2.points);
fs.rmSync(home,{recursive:true,force:true});})();

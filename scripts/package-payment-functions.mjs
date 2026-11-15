import fs from 'node:fs/promises';
const base='.vercel/output';
const config=JSON.parse(await fs.readFile(base+'/config.json','utf8'));
const core=await fs.readFile('server/payments.mjs','utf8');
for(const name of ['payments','payment-oauth','stripe-webhook']){
 const dir=base+'/functions/api/'+name+'.func';await fs.mkdir(dir,{recursive:true});
 const entry=(await fs.readFile('api/'+name+'.js','utf8')).replace('../server/payments.mjs','./payments.mjs');
 await fs.writeFile(dir+'/index.js',entry);await fs.writeFile(dir+'/payments.mjs',core);
 await fs.writeFile(dir+'/package.json',JSON.stringify({type:'module'}));
 await fs.writeFile(dir+'/.vc-config.json',JSON.stringify({runtime:'nodejs24.x',handler:'index.js',launcherType:'Nodejs',shouldAddHelpers:false}));
}
config.routes.unshift(...['payments','payment-oauth','stripe-webhook'].map(n=>({src:'^/api/'+n+'$',dest:'/api/'+n})));
await fs.writeFile(base+'/config.json',JSON.stringify(config,null,2));
console.log('Packaged authenticated payment APIs and raw-body webhook for Vercel.');

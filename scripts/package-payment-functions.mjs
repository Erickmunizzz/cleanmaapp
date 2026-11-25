import fs from 'node:fs/promises';
const base='.vercel/output';
const config=JSON.parse(await fs.readFile(base+'/config.json','utf8'));
const core=await fs.readFile('server/payments.mjs','utf8');
const routes = ['payments', 'employee-invite', 'payment-oauth', 'xero/callback', 'stripe/connect/callback', 'stripe-webhook', 'client-subscriptions', 'client-subscriptions-webhook', 'custom-subscriptions', 'custom-subscriptions-webhook'];
for(const name of routes){
 const dir=base+'/functions/api/'+name+'.func';await fs.mkdir(dir,{recursive:true});
 const entry=(await fs.readFile('api/'+(name === 'xero/callback' ? 'payment-oauth' : name)+'.js','utf8')).replace(/(?:\.\.\/)+server\/payments\.mjs/,'./payments.mjs');
 await fs.writeFile(dir+'/index.js',entry);await fs.writeFile(dir+'/payments.mjs',core);
 if(name.startsWith('client-subscriptions')){
  const recurring=(await fs.readFile('server/client-recurring.mjs','utf8'));
  await fs.writeFile(dir+'/index.js',entry.replace('../server/client-recurring.mjs','./client-recurring.mjs'));
  await fs.writeFile(dir+'/client-recurring.mjs',recurring);
 }
 if(name.startsWith('custom-subscriptions')){
  const custom=(await fs.readFile('server/custom-subscriptions.mjs','utf8'));
  await fs.writeFile(dir+'/index.js',entry.replace('../server/custom-subscriptions.mjs','./custom-subscriptions.mjs'));
  await fs.writeFile(dir+'/custom-subscriptions.mjs',custom);
 }
 await fs.writeFile(dir+'/package.json',JSON.stringify({type:'module'}));
 await fs.writeFile(dir+'/.vc-config.json',JSON.stringify({runtime:'nodejs24.x',handler:'index.js',launcherType:'Nodejs',shouldAddHelpers:false}));
}
config.routes.unshift(...routes.map(n=>({src:'^/api/'+n+'$',dest:'/api/'+n})));
await fs.writeFile(base+'/config.json',JSON.stringify(config,null,2));
console.log('Packaged authenticated payment APIs and raw-body webhook for Vercel.');

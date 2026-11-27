import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
const url=process.env.VITE_SUPABASE_URL||'https://eymkowczlmbrfxlxcwdm.supabase.co';
const key=process.env.VITE_SUPABASE_ANON_KEY||process.env.VITE_SUPABASE_PUBLISHABLE_KEY||'sb_publishable_MQz1s2hIcpM-w83-akFCPA_TJDDgYjG';
if(!url.startsWith('https://')||!key.startsWith('sb_publishable_'))throw Error('Expected HTTPS Supabase URL and public publishable key');
execFileSync('npx',['--yes','esbuild@0.25.12','cleaner/src/app.js','--bundle','--loader:.png=dataurl','--define:CLEANER_SUPABASE_URL='+JSON.stringify(url),'--define:CLEANER_SUPABASE_KEY='+JSON.stringify(key),'--minify','--format=iife','--outfile=cleaner/bundle.js'],{stdio:'inherit'});
const css=readFileSync('cleaner/styles.css','utf8'),js=readFileSync('cleaner/bundle.js','utf8').replaceAll('</script','<\\/script');
const html=`<!doctype html><html lang="en-GB" translate="no"><head><meta charset="UTF-8"><meta name="google" content="notranslate"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="theme-color" content="#0f172a"><meta name="apple-mobile-web-app-capable" content="yes"><title>CleanMa</title><link rel="manifest" href="/manifest-cleaner.webmanifest"><link rel="apple-touch-icon" href="/pwa/apple-touch-icon.png" sizes="180x180"><script defer src="/pwa/install.js"></script><link rel="icon" href="/favicon.ico?v=cm-1"><link rel="icon" type="image/png" href="/favicon.png?v=cm-1"><style>${css}</style><script>window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments)};window.va('beforeSend',function(e){e.url=location.origin+'/';return e});</script><script defer src="/_vercel/insights/script.js"></script><script defer src="/_vercel/speed-insights/script.js"></script></head><body><div id="root"></div><cleanma-install data-portal="cleaner"></cleanma-install><script>${js}</script></body></html>`;
writeFileSync('public/cleaner.html',html);mkdirSync('cleaner/netlify',{recursive:true});writeFileSync('cleaner/netlify/index.html',html);

// Keep the independent Cleaner build usable at the same launch path.
writeFileSync('cleaner/netlify/cleaner.html',html);
mkdirSync('cleaner/netlify/pwa',{recursive:true});
for(const name of ['favicon.ico','favicon.png','cleanma-logo.png','manifest-cleaner.webmanifest','sw.js','pwa/install.js','pwa/icon-192.png','pwa/icon-512.png','pwa/apple-touch-icon.png'])copyFileSync('public/'+name,'cleaner/netlify/'+name);

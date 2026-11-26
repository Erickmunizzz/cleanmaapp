import {createFileRoute} from '@tanstack/react-router';
import {useEffect,useState} from 'react';
import {roleDestination} from '@/lib/role-destination';
import {supabase} from '@/integrations/supabase/client';

export const Route=createFileRoute('/suspended')({component: Suspended});

function Suspended(){
 const [attempt,setAttempt]=useState(0);
 const [error,setError]=useState('');
 useEffect(()=>{
  let active=true,running=false;
  async function check(){
   if(!active||running)return;
   running=true;
   try{
    const destination=await roleDestination();
    if(!active)return;
    setError('');
    if(destination!=='/suspended')location.replace(destination==='/auth'?'/cleaner/login':destination);
   }catch{
    if(active)setError('Could not verify access. Please try again.');
   }finally{running=false;}
  }
  void check();
  const timer=setInterval(()=>void check(),15000);
  return()=>{active=false;clearInterval(timer);};
 },[attempt]);
 async function signOut(){
  const {error}=await supabase.auth.signOut({scope:'local'});
  if(error){setError('Could not sign out. Please try again.');return;}
  location.replace('/cleaner/login');
 }
 return <main className="space-y-4 p-8">
  <h1>Workspace access suspended</h1>
  <p>Contact your manager to renew the company subscription. Your access returns after payment is confirmed.</p>
  {error&&<p role="alert">{error}</p>}
  <button type="button" className="mr-4 underline" onClick={()=>setAttempt(attempt+1)}>Check access</button>
  <button type="button" className="underline" onClick={()=>void signOut()}>Sign out</button>
 </main>;
}

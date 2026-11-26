import {createElement} from 'react';
import {render,screen,cleanup,fireEvent,waitFor} from '@testing-library/react';
import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({getUser:vi.fn(),getSession:vi.fn(),rpc:vi.fn(),signIn:vi.fn(),signUp:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{auth:{getUser:mocks.getUser,getSession:mocks.getSession,signInWithPassword:mocks.signIn,signUp:mocks.signUp,onAuthStateChange:()=>({data:{subscription:{unsubscribe:()=>{}}}})},rpc:mocks.rpc}}));
import {AuthPage} from '@/components/auth/AuthPage';
import {roleDestination,RoleGate} from '@/lib/role-access';
describe('Role and subscription routing',()=>{
 beforeEach(()=>{mocks.getSession.mockResolvedValue({data:{session:null}});mocks.getUser.mockResolvedValue({data:{user:{id:'user'}}});});
 it.each([
  ['owner',true,'/admin'],['cleaner',true,'/cleaner'],
  ['owner',false,'/planos'],['cleaner',false,'/suspended'],
  ['unexpected',true,'/auth'],
 ])('routes %s with active=%s to %s',async(role,active,path)=>{
  mocks.rpc.mockResolvedValue({data:{role,active}});
  expect(await roleDestination()).toBe(path);
 });
 it('rejects unauthenticated access',async()=>{
  mocks.getUser.mockResolvedValue({data:{user:null}});
  expect(await roleDestination()).toBe('/auth');
 });
 it('does not redirect identities without a workspace to a checkout they cannot use',async()=>{
  mocks.rpc.mockResolvedValue({data:null});
  expect(await roleDestination()).toBe('/auth');
 });
 it('keeps invalid credentials on the dedicated cleaner login',async()=>{
  mocks.signIn.mockResolvedValue({error:{message:'Invalid login credentials'}});
  render(createElement(AuthPage,{role:'cleaner'}));
  fireEvent.change(screen.getByPlaceholderText('Email'),{target:{value:'invalid@example.invalid'}});
  fireEvent.change(screen.getByPlaceholderText('Password'),{target:{value:'invalid-password'}});
  fireEvent.click(screen.getByRole('button',{name:'Sign in'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Invalid login credentials');
  expect(screen.queryByText('Private dashboard')).toBeNull();cleanup();
 });
 it('marks only an owner signup and preserves the selected annual billing preference',async()=>{
  window.history.replaceState(null,'','/admin/login?mode=signup&plan=growth&interval=year');
  mocks.signUp.mockResolvedValue({data:{session:null}});
  try{
   render(createElement(AuthPage,{role:'owner'}));
   fireEvent.change(screen.getByPlaceholderText('Email'),{target:{value:'owner@example.invalid'}});
   fireEvent.change(screen.getByPlaceholderText('Password'),{target:{value:'isolated-password'}});
   fireEvent.click(screen.getByRole('button',{name:'Create account'}));
   await waitFor(()=>expect(mocks.signUp).toHaveBeenCalledWith({
    email:'owner@example.invalid',password:'isolated-password',
    options:{emailRedirectTo:'https://cleanmaapp.com/admin/login?confirmed=1',data:{cleanma_owner_signup:{version:1,plan:'growth',interval:'year'}}},
   }));
   expect(screen.queryByRole('alert')).toBeNull();
  }finally{
   cleanup();
   window.history.replaceState(null,'','/');
  }
 });
 it('does not grant access when the backend verification fails',async()=>{
  mocks.rpc.mockResolvedValue({error:new Error('Unavailable')});
  await expect(roleDestination()).rejects.toThrow('Unavailable');
 });
});

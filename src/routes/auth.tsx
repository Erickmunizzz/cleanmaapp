import {createFileRoute,redirect} from '@tanstack/react-router';
export const Route=createFileRoute('/auth')({beforeLoad:({location})=>{throw redirect({href:'/login/admin'+location.searchStr+(location.hash?'#'+location.hash.replace(/^#/,''):'')})}});

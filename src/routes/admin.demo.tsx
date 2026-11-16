import {createFileRoute} from '@tanstack/react-router';
import {DemoWorkspacePage} from '@/components/admin/DemoWorkspacePage';
export const Route=createFileRoute('/admin/demo')({component:DemoWorkspacePage,head:()=>({meta:[{title:'Demo Workspace — CleanMa'}]})});

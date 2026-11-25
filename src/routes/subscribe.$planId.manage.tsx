import {createFileRoute} from '@tanstack/react-router';
import {CustomManage} from '@/components/subscriptions/CustomManage';

export const Route=createFileRoute('/subscribe/$planId/manage')({component:ManageSubscriptionPage});

function ManageSubscriptionPage(){
  const {planId}=Route.useParams();
  return <CustomManage slug={planId}/>;
}

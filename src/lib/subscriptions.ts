import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";

export const LIMIT_MESSAGE = "You’ve reached your plan limit. View your upgrade options or contact support for more capacity.";
export const plans = [
  { id: "starter", name: "Starter", price: "£89.99", staff: 5, jobs: 230 },
  { id: "growth", name: "Growth", price: "£179.99", staff: 12, jobs: 570 },
  { id: "scale", name: "Scale", price: "£299.99", staff: 20, jobs: 1000 },
] as const;
export type Feature = "payroll" | "recurring" | "reports" | "payments" | "integrations";
export type Resource = "staff" | "jobs";
export const normalizePlan = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase() : value;
export const planSchema = z.preprocess(normalizePlan, z.enum(["trial", "starter", "growth", "scale"]));
export const subscriptionSchema = z.object({
  plan: planSchema,
  month: z.string(), staffUsed: z.number(), jobsUsed: z.number(),
  staffLimit: z.number(), jobsLimit: z.number(), pendingPlan: z.string().nullable(),
});
export type Subscription = z.infer<typeof subscriptionSchema>;
export function allowsFeature(plan: string, _feature: Feature) {
  const normalized = normalizePlan(plan);
  return normalized === "growth" || normalized === "scale";
}
export async function loadSubscription(companyId: string, month?: string) {
  const { data, error } = await supabase.rpc("subscription_status", {
    target_company: companyId, ...(month ? { target_month: `${month.slice(0, 7)}-01` } : {}),
  });
  if (error) throw new Error(error.message);
  const result=subscriptionSchema.parse(data);
  const access=await supabase.rpc('current_subscription_access' as never);
  if(access.error)throw access.error;
  const entitlement=z.object({active:z.boolean(),plan:planSchema,status:z.enum(['trial','active','blocked']),trialEndsAt:z.string().nullable()}).nullable().parse(access.data);
  if(!entitlement?.active)throw new Error('Subscription expired. Choose a plan to continue.');
  return {...result,plan:entitlement.plan,trialStatus:entitlement.status,trialEndsAt:entitlement.trialEndsAt,staffLimit:entitlement.plan==='scale'?20:entitlement.plan==='growth'?12:5,jobsLimit:entitlement.plan==='scale'?1000:entitlement.plan==='growth'?570:230};
}
export function isPlanError(error: unknown) {
  return Boolean(error && typeof error === "object" && "message" in error &&
    /PLAN_LIMIT|PLAN_FEATURE/.test(String(error.message)));
}

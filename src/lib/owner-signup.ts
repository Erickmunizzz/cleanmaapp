export type SignupPlan = "starter" | "growth" | "scale";
export type SignupInterval = "month" | "year";
export type SignupChoice = {plan: SignupPlan; interval: SignupInterval};
export const ownerSignupKey = "cleanma_owner_signup";

export function readSignupChoice(value: unknown): SignupChoice | null {
  if (!value || typeof value !== "object") return null;
  const {plan, interval} = value as {plan?: unknown; interval?: unknown};
  if (plan !== "starter" && plan !== "growth" && plan !== "scale") return null;
  if (interval !== "month" && interval !== "year") return null;
  return {plan, interval};
}

export function ownerSignupParameters(query: URLSearchParams) {
  const choice = readSignupChoice({plan: query.get("plan"), interval: query.get("interval") === "year" ? "year" : "month"});
  const callback = new URL("https://cleanmaapp.com/admin/login");
  callback.searchParams.set("confirmed", "1");
  return {emailRedirectTo: callback.href, data: {[ownerSignupKey]: {version: 1, ...choice}}};
}

export function ownerLanding(destination: "/admin" | "/planos", query: URLSearchParams, signup: unknown) {
  const explicit = readSignupChoice({plan: query.get("plan"), interval: query.get("interval") === "year" ? "year" : "month"});
  if (explicit) return planPath(explicit);
  const next = query.get("next");
  if (next && /^\/planos(?:\?|$)/.test(next) && !/[\\\u0000-\u001f]/.test(next)) return next;
  const choice = readSignupChoice(signup);
  return choice && (destination === "/planos" || query.get("confirmed") === "1") ? planPath(choice) : destination;
}

function planPath(choice: SignupChoice) {
  return "/planos?" + new URLSearchParams(choice).toString();
}

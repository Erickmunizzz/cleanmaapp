import { supabase } from "@/integrations/supabase/client";

export async function inviteEmployee(id: string) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Sign in again to invite employees.");
  const response = await fetch("/api/employee-invite", {
    method: "POST",
    headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
    cache: "no-store",
  });
  const result = await response.json() as {
    status?: "sent" | "already_active" | "email_unconfigured";
    error?: string;
  };
  if (!response.ok) throw new Error(result.error ?? "Invitation failed.");
  return result;
}

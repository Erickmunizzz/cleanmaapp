import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Tables } from "@/integrations/supabase/types";
import { inviteEmployee } from "@/lib/employee-invite";

export function InviteEmployee({ employees, refresh }: {
  employees: Tables<"staff">[];
  refresh: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const pending = employees.filter(row => row.is_active && row.email && !row.invitation_sent_at);

  async function sendAll() {
    setBusy(true);
    setResult("");
    let sent = 0;
    const issues: string[] = [];
    try {
      for (const employee of pending) {
        try {
          const invitation = await inviteEmployee(employee.id);
          if (invitation.status === "sent") sent++;
          if (invitation.status === "email_unconfigured") issues.push(employee.name + " (email delivery needs setup)");
        } catch (error) {
          issues.push(employee.name + " (" + (error instanceof Error ? error.message : "delivery failed") + ")");
        }
      }
      setResult(`${sent} invitation(s) emailed.${issues.length ? " Pending: " + issues.join(", ") : ""}`);
      await refresh();
    } finally { setBusy(false); }
  }

  return <section className="space-y-2">
    <Button type="button" variant="outline" disabled={busy || !pending.length} onClick={sendAll}>
      {busy ? "Sending…" : "Invite All"}
    </Button>
    {result && <p role="status" className="text-sm">{result}</p>}
  </section>;
}

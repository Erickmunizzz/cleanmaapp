import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Tables } from "@/integrations/supabase/types";
import { inviteEmployee } from "@/lib/employee-invite";

export function InviteEmployee({ employees, refresh }: {
  employees: Tables<"staff">[];
  refresh: () => Promise<unknown>;
}) {
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [share, setShare] = useState<{ message: string; phone: string }>();
  const eligible = employees.filter(row => row.is_active && (row.email || row.phone));
  const pending = eligible.filter(row => row.email && !row.invitation_sent_at);

  async function sendAll() {
    setBusy(true);
    setShare(undefined);
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

  async function prepareShare() {
    setBusy(true);
    setShare(undefined);
    setResult("");
    try {
      const invitation = await inviteEmployee(selected, true);
      if (invitation.message) setShare({ message: invitation.message, phone: invitation.phone ?? "" });
      else setResult("This employee already has an active login.");
      await refresh();
    } catch (error) {
      setResult(error instanceof Error ? error.message : "Could not prepare an invitation.");
    } finally { setBusy(false); }
  }

  const phone = share?.phone.replace(/[^\d+]/g, "") ?? "";
  const message = encodeURIComponent(share?.message ?? "");
  return <section className="space-y-2">
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" disabled={busy || !pending.length} onClick={sendAll}>Invite All</Button>
      <select aria-label="Employee to invite" className="rounded-lg border bg-card px-3" value={selected}
        onChange={event => { setSelected(event.target.value); setShare(undefined); }}>
        <option value="">Select an employee to invite</option>
        {eligible.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
      </select>
      <Button type="button" variant="outline" disabled={busy || !selected} onClick={prepareShare}>Prepare SMS / WhatsApp</Button>
    </div>
    {share && <div className="flex gap-3 text-sm">
      <a className="underline" href={`sms:${phone}?body=${message}`}>Open SMS</a>
      <a className="underline" href={`https://wa.me/${phone.startsWith("+") ? phone.slice(1) : ""}?text=${message}`}
        target="_blank" rel="noreferrer">Open WhatsApp</a>
    </div>}
    {result && <p role="status" className="text-sm">{result}</p>}
  </section>;
}

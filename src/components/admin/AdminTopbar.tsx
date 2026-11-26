import { useRef, useState } from "react";
import { GlobalSearch } from "./GlobalSearch";
import { CircleHelp, LogOut, Menu } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { NotificationBell } from "./NotificationBell";
import { useAdminAccount } from "./AdminSession";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { copySupportEmail, SUPPORT_EMAIL, SUPPORT_MAILTO } from "@/lib/support-contact";

export function AdminTopbar({ onToggleMenu }: { onToggleMenu: () => void }) {
  const account = useAdminAccount();
  const supportLink = useRef<HTMLAnchorElement>(null);
  const [copyStatus, setCopyStatus] = useState("");

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Signed out");
  };

  const initials = account?.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "O";

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-card/80 px-4 backdrop-blur-xl lg:px-6">
      <Button variant="ghost" size="icon" onClick={onToggleMenu} className="-ml-2 shrink-0 rounded-xl p-2 hover:bg-secondary lg:hidden" aria-label="Open menu">
        <Menu className="h-5 w-5" />
      </Button>
      <GlobalSearch />

      <div className="flex shrink-0 items-center gap-1">
        <Popover onOpenChange={() => setCopyStatus("")}>
          <PopoverTrigger
            type="button"
            title="Help & support"
            aria-label="Help & support"
            className="grid h-9 w-9 place-items-center rounded-xl text-muted-foreground transition hover:bg-secondary"
          >
            <CircleHelp className="h-5 w-5" />
          </PopoverTrigger>
          <PopoverContent align="end" className="max-w-[calc(100vw-2rem)]">
            <p className="text-sm font-medium">Contact support</p>
            <a ref={supportLink} href={SUPPORT_MAILTO} className="mt-2 block select-text text-sm text-primary underline">
              {SUPPORT_EMAIL}
            </a>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={async () => setCopyStatus(
                await copySupportEmail(supportLink.current) ? "Email copied." : "Copy the email address manually."
              )}
            >
              Copy email
            </Button>
            <p role="status" className="mt-1 text-xs text-muted-foreground">{copyStatus}</p>
          </PopoverContent>
        </Popover>

        <NotificationBell />
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-full bg-primary text-[12px] font-bold text-primary-foreground">{initials}</div>
          <span className="hidden max-w-32 truncate text-[13px] font-medium sm:block">{account?.name || "Signed out"}</span>
        </div>
        {account && <Button variant="ghost" size="icon" aria-label="Sign out" title="Sign out" onClick={() => void signOut()}><LogOut className="h-4 w-4" /></Button>}
      </div>
    </header>
  );
}

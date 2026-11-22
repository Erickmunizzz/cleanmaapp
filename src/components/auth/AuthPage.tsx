import { authTimeout } from "@/lib/auth-timeout";
import { roleDestination } from "@/lib/role-destination";
import { AuthLegalFooter } from "@/components/legal/LegalDocuments";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const input =
  "h-10 w-full rounded-xl border border-border bg-card px-3 text-[13.5px] outline-none focus:border-primary";

type AuthRole = "owner" | "cleaner";
type AuthMode = "signin" | "signup";

export function AuthPage({
  role = "owner",
  initialMode = "signin",
}: {
  role?: AuthRole;
  initialMode?: AuthMode;
}) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState("");
  const [remember, setRemember] = useState(true);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      setEmail(localStorage.getItem("cleanma:last-email") || "");
      setRemember(localStorage.getItem("cleanma:remember-email") !== "false");
    } catch {
      // Storage may be unavailable in private browsing; authentication still works.
    }
  }, []);

  // Supabase email confirmations return to the URL supplied in emailRedirectTo.
  // Complete the role-based redirect after Supabase restores the session from
  // the callback URL. All app callbacks therefore remain on this app origin.
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const isAuthCallback =
      searchParams.has("code") ||
      searchParams.has("token_hash") ||
      hashParams.has("access_token") ||
      hashParams.has("error_code");

    if (!isAuthCallback) return;

    let active = true;
    void (async () => {
      try {
        const { data, error: sessionError } = await authTimeout(
          supabase.auth.getSession(),
        );
        if (sessionError) throw sessionError;
        if (!active || !data.session) return;

        const destination = await authTimeout(roleDestination());
        if (!active || destination === "/auth") return;

        const plan = searchParams.get("plan");
        const interval = searchParams.get("interval") === "year" ? "year" : "month";
        if (
          role === "owner" &&
          ["/admin", "/planos"].includes(destination) &&
          plan &&
          ["starter", "growth", "scale"].includes(plan)
        ) {
          window.location.replace(
            `/planos?plan=${encodeURIComponent(plan)}&interval=${interval}`,
          );
          return;
        }

        window.location.replace(destination);
      } catch (callbackError) {
        if (active) {
          setError(
            callbackError instanceof Error
              ? callbackError.message
              : "Unable to complete email confirmation. Please sign in.",
          );
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [role]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      localStorage.setItem("cleanma:remember-email", String(remember));
      if (remember) {
        localStorage.setItem("cleanma:last-email", email.trim());
      } else {
        localStorage.removeItem("cleanma:last-email");
      }
    } catch {
      // Do not block sign-in if browser storage is unavailable.
    }

    try {
      const result =
        mode === "signin"
          ? await authTimeout(
              supabase.auth.signInWithPassword({ email: email.trim(), password }),
            )
          : await authTimeout(
              supabase.auth.signUp({
                email: email.trim(),
                password,
                options: {
                  // Keep confirmation on whichever cleanmaapp.online app route
                  // initiated registration, including its selected plan/invite.
                  emailRedirectTo: new URL(
                    window.location.pathname + window.location.search,
                    window.location.origin,
                  ).toString(),
                },
              }),
            );

      if (result.error) {
        if (result.error.code === "invalid_credentials") {
          throw new Error("Email ou senha incorretos");
        }
        throw result.error;
      }

      if (!result.data.session) {
        toast.success("Check your email to confirm your account.");
        return;
      }

      const inviteToken = new URLSearchParams(window.location.search).get("invite");
      if (inviteToken) {
        const inviteResult = await authTimeout(
          supabase.rpc(
            "accept_staff_invite" as never,
            { invite_token: inviteToken } as never,
          ),
        );
        if (inviteResult.error) throw inviteResult.error;
      }

      const { data: profile, error: profileError } = await authTimeout(
        supabase
          .from("profiles")
          .select("company_id,is_active")
          .eq("id", result.data.session.user.id)
          .maybeSingle(),
      );
      if (profileError) throw profileError;
      if (!profile?.company_id || !profile.is_active) {
        throw new Error("Sem empresa vinculada, fale com seu patrão");
      }

      const destination = await authTimeout(roleDestination());
      if (destination === "/auth") {
        throw new Error("Your account does not have an active workspace profile.");
      }

      if (
        (role === "owner" && ["/cleaner", "/suspended"].includes(destination)) ||
        (role === "cleaner" && ["/admin", "/planos"].includes(destination))
      ) {
        throw new Error(
          "This account belongs to the other workspace. Please use the correct sign-in page.",
        );
      }

      const query = new URLSearchParams(window.location.search);
      const plan = query.get("plan");
      const next = query.get("next");
      if (role === "owner" && ["/admin", "/planos"].includes(destination)) {
        if (plan && ["starter", "growth", "scale"].includes(plan)) {
          window.location.replace(
            "/planos?plan=" +
              encodeURIComponent(plan) +
              "&interval=" +
              (query.get("interval") === "year" ? "year" : "month"),
          );
          return;
        }
        if (next && /^\/planos(?:\?|$)/.test(next) && !next.includes("\\")) {
          window.location.replace(next);
          return;
        }
      }

      // Relative role destinations preserve the cleanmaapp.online origin.
      window.location.replace(destination);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to sign in. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-card)]"
      >
        <div className="flex items-center gap-3">
          <img
            src="/cleanma-logo.png"
            alt="CleanMa logo"
            className="h-8 w-12 shrink-0 rounded object-contain"
          />
          <div className="text-[17px] font-bold tracking-tight">
            {mode === "signin"
              ? role === "owner"
                ? "Owner sign in"
                : "Cleaner sign in"
              : "Create account"}
          </div>
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <input
          className={input}
          type="email"
          required
          autoComplete="username"
          placeholder="Email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <input
          className={input}
          type="password"
          required
          minLength={6}
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          placeholder="Password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
          />
          Remember me
        </label>

        <button
          disabled={busy}
          className="h-10 w-full rounded-xl bg-primary text-[13.5px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {busy
            ? "Please wait…"
            : mode === "signin"
              ? "Sign in"
              : "Create account"}
        </button>

        {(role === "owner" ||
          (typeof window !== "undefined" &&
            new URLSearchParams(window.location.search).has("invite"))) && (
          <button
            type="button"
            onClick={() =>
              setMode((current) => (current === "signin" ? "signup" : "signin"))
            }
            className="w-full text-[12.5px] text-muted-foreground hover:text-foreground"
          >
            {mode === "signin"
              ? "No account yet? Create one"
              : "Already have an account? Sign in"}
          </button>
        )}

        <AuthLegalFooter />
      </form>
    </div>
  );
}

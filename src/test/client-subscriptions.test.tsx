import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, test, vi } from "vitest";
import { ClientSubscriptions } from "@/components/admin/ClientSubscriptions";
import type { StripeReadiness } from "@/components/admin/PaymentConnections";

const { paymentApi, readAllRows } = vi.hoisted(() => ({ paymentApi: vi.fn(), readAllRows: vi.fn() }));
vi.mock("@/lib/payment-api", () => ({ paymentApi }));
vi.mock("@/lib/supabase-pages", () => ({ readAllRows }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const companyId = "00000000-0000-4000-8000-000000000001";
const clientId = "00000000-0000-4000-8000-000000000002";

function setup(canUse = true, stripeReadiness: StripeReadiness = "unknown") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><ClientSubscriptions companyId={companyId} canUse={canUse} stripeReadiness={stripeReadiness} /></QueryClientProvider>);
}

beforeEach(() => { vi.resetAllMocks(); });

test("recurring Checkout is clearly unavailable until enabled; existing one-time flow is named", async () => {
  paymentApi.mockResolvedValue({ enabled: false });
  setup();
  expect(await screen.findByText(/Recurring checkout is not enabled yet/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Create subscription link" })).toBeNull();
  expect(readAllRows).not.toHaveBeenCalled();
});

test("owner selects client and period, creates a recurring link, and can share the hosted Checkout", async () => {
  paymentApi.mockImplementation(({ action }) => Promise.resolve(action === "client-subscription-options"
    ? { enabled: true } : { url: "https://checkout.stripe.com/test-only" }));
  readAllRows.mockResolvedValue([{ id: clientId, name: "Office customer" }]);
  setup();
  await screen.findByRole("option", { name: "Office customer" });
  fireEvent.change(screen.getByLabelText("Client", { selector: "select" }), { target: { value: clientId } });
  fireEvent.change(screen.getByLabelText("Amount (GBP)"), { target: { value: "125.50" } });
  fireEvent.change(screen.getByLabelText("Billing period"), { target: { value: "year" } });
  fireEvent.change(screen.getByLabelText("Service description"), { target: { value: "Office cleaning" } });
  fireEvent.click(screen.getByRole("button", { name: "Create subscription link" }));
  await waitFor(() => expect(paymentApi).toHaveBeenLastCalledWith({
    action: "client-subscription-link", client_id: clientId, amount: 12550, interval: "year",
    description: "Office cleaning", request_id: expect.stringMatching(/^[\da-f-]{36}$/i),
  }));
  expect((await screen.findByRole("link", { name: "Open client checkout" })).getAttribute("href")).toBe("https://checkout.stripe.com/test-only");
  expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
});


test.each([
  ["not-connected", /Connect your cleaning company/],
  ["needs-onboarding", /Finish setting up your connected Stripe account/],
] as const)("recurring checkout provides a setup path instead of generating a link when Stripe is %s", async (readiness, message) => {
  paymentApi.mockResolvedValue({ enabled: true });
  setup(true, readiness);
  expect(await screen.findByText(message)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Go to Stripe connection" }).getAttribute("href")).toBe("#payment-connections");
  expect(screen.queryByRole("button", { name: "Create subscription link" })).toBeNull();
  expect(paymentApi).toHaveBeenCalledTimes(1);
  expect(readAllRows).not.toHaveBeenCalled();
});

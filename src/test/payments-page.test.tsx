import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, test, vi } from "vitest";
import { PaymentsPage } from "@/components/admin/PaymentsPage";

const { paymentApi } = vi.hoisted(() => ({ paymentApi: vi.fn() }));
vi.mock("@/lib/payment-api", () => ({ paymentApi }));
vi.mock("@/lib/supabase-pages", () => ({ readAllRows: async () => [{ id: "client", name: "Office customer" }] }));
vi.mock("@/components/admin/SubscriptionProvider", () => ({
  useSubscription: () => ({ canUse: () => true, requireFeature: () => true }),
}));
vi.mock("@/lib/owner-context", () => ({
  ownerContextOptions: { queryKey: ["owner"], queryFn: async () => ({ companyId: "company" }) },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { plan: "growth" } }) }) }) }),
    rpc: () => ({ order: () => ({ order: () => ({ range: async () => ({ data: [] }) }) }) }),
  },
}));

test("one-off link stays blocked until Stripe connects, then renders QR and recurring cards above the FAQ", async () => {
  let connected = false;
  paymentApi.mockImplementation(async ({ action }) => {
    if (action === "status") return [{ provider: "stripe", connected, charges_enabled: connected, details_submitted: connected }];
    if (action === "client-subscription-options") return { enabled: true };
    if (action === "quick-link") return { url: "https://checkout.stripe.com/test-only" };
    throw new Error("Unexpected action: " + action);
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}><PaymentsPage /></QueryClientProvider>);
  const collectCard = (await screen.findByRole("heading", { name: "Collect from Client" })).closest("section")!;
  const client = await within(collectCard).findByRole("option", { name: "Office customer" });
  await within(collectCard).findByText(/Connect your cleaning company/);
  const find = (selector: string) => collectCard.querySelector(selector)!;
  expect(client.closest("section")).toBe(collectCard);
  fireEvent.change(find("select"), { target: { value: "client" } });
  fireEvent.change(find("input[type=number]"), { target: { value: "100" } });
  fireEvent.change(find("input[maxlength]"), { target: { value: "Office cleaning" } });
  const generate = screen.getByRole<HTMLButtonElement>("button", { name: "Generate Stripe Payment Link + QR" });
  expect(generate.disabled).toBe(true);
  expect(collectCard.querySelector('a[href="#payment-connections"]')).toBeTruthy();
  expect(collectCard.textContent).toContain("Platform Fee 1%£1.00");
  expect(paymentApi.mock.calls.some(([request]) => request.action === "quick-link")).toBe(false);

  connected = true;
  fireEvent.click(screen.getByRole("button", { name: "Check status" }));
  await waitFor(() => expect(generate.disabled).toBe(false));
  fireEvent.click(generate);
  const linkCard = await screen.findByRole("region", { name: "Stripe payment link ready" });
  const recurringCard = screen.getByRole("region", { name: "Client subscriptions" });
  const faq = screen.getByRole("region", { name: "Frequently asked questions" });
  expect(collectCard.nextElementSibling).toBe(linkCard);
  expect(linkCard.nextElementSibling).toBe(recurringCard);
  expect(recurringCard.compareDocumentPosition(faq) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(paymentApi).toHaveBeenCalledWith(expect.objectContaining({ action: "quick-link", amount: 10000 }));
  expect(linkCard.querySelector('a[href="https://checkout.stripe.com/test-only"]')).toBeTruthy();
});

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Plans } from "@/routes/planos";

const { paymentApi, getUser, rpc } = vi.hoisted(() => ({
  paymentApi: vi.fn(),
  getUser: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("@/lib/payment-api", () => ({ paymentApi }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getUser }, rpc } }));

const assign = vi.fn();
const replace = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  getUser.mockResolvedValue({ data: { user: { user_metadata: {} } } });
  rpc.mockResolvedValue({ data: { role: "owner", status: "trialing", active: true } });
  vi.stubGlobal("location", { search: "", assign, replace });
});
afterEach(() => vi.unstubAllGlobals());

test("lists all three cards, switches Annual pricing and opens Stripe for the card and period clicked", async () => {
  paymentApi.mockResolvedValue({ url: "https://checkout.stripe.com/c/pay/example" });
  render(<Plans />);
  const cards = screen.getAllByRole("article");
  expect(cards.map(card => within(card).getByRole("heading").textContent)).toEqual(["Starter", "Growth", "Scale"]);
  expect(within(cards[1]!).getByText("Most popular")).toBeTruthy();
  for (const price of ["£89.99", "£179.99", "£299.99"]) expect(screen.getByText(price)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Annual/ }));
  for (const price of ["£928.70", "£1,857.50", "£3,095.90"]) expect(screen.getByText(price)).toBeTruthy();
  const choose = screen.getByRole<HTMLButtonElement>("button", { name: "Choose Growth plan" });
  await waitFor(() => expect(choose.disabled).toBe(false));
  fireEvent.click(choose);
  await waitFor(() => expect(assign).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay/example"));
  expect(paymentApi).toHaveBeenCalledExactlyOnceWith({ action: "checkout", plan: "growth", interval: "year" });
});

test("a new selection opens its own checkout with no previous-checkout option", async () => {
  paymentApi.mockResolvedValueOnce({ url: "https://checkout.stripe.com/c/pay/new" });
  render(<Plans />);
  const choose = screen.getByRole<HTMLButtonElement>("button", { name: "Choose Starter plan" });
  await waitFor(() => expect(choose.disabled).toBe(false));
  fireEvent.click(choose);
  await waitFor(() => expect(assign).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay/new"));
  expect(screen.queryByText(/previous checkout/i)).toBeNull();
  expect(paymentApi).toHaveBeenCalledExactlyOnceWith({ action: "checkout", plan: "starter", interval: "month" });
});

test("reports in-progress payment without offering another link", async () => {
  paymentApi.mockRejectedValueOnce(new Error("CHECKOUT_PROCESSING"));
  render(<Plans />);
  const choose = screen.getByRole<HTMLButtonElement>("button", { name: "Choose Scale plan" });
  await waitFor(() => expect(choose.disabled).toBe(false));
  fireEvent.click(choose);
  expect((await screen.findByRole("alert")).textContent).toMatch(/payment is being confirmed/);
  expect(screen.queryByText(/previous checkout/i)).toBeNull();
  expect(assign).not.toHaveBeenCalled();
});

test("preserves the login redirect and selected-plan query for signed-out visitors", async () => {
  vi.stubGlobal("location", { search: "?plan=growth&interval=year", assign, replace });
  getUser.mockResolvedValue({ data: { user: null } });
  render(<Plans />);
  await waitFor(() => expect(replace).toHaveBeenCalledWith("/admin/login?next=" + encodeURIComponent("/planos?plan=growth&interval=year")));
  expect(paymentApi).not.toHaveBeenCalled();
});

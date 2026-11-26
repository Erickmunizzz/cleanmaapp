import { describe, expect, it } from "vitest";
import { ownerLanding, ownerSignupParameters, readSignupChoice } from "@/lib/owner-signup";

describe("owner onboarding", () => {
  it("preserves annual plan intent independently of the fixed canonical Auth return", () => {
    const signup=ownerSignupParameters(new URLSearchParams("plan=scale&interval=year"));
    expect(signup).toEqual({
      emailRedirectTo:"https://cleanmaapp.com/admin/login?confirmed=1",
      data:{cleanma_owner_signup:{version:1,plan:"scale",interval:"year"}},
    });
    expect(ownerLanding("/admin",new URLSearchParams("confirmed=1"),signup.data.cleanma_owner_signup))
      .toBe("/planos?plan=scale&interval=year");
    expect(ownerLanding("/admin",new URLSearchParams(),signup.data.cleanma_owner_signup)).toBe("/admin");
    expect(ownerLanding("/planos",new URLSearchParams(),signup.data.cleanma_owner_signup))
      .toBe("/planos?plan=scale&interval=year");
  });

  it("does not forward unsafe redirects or accept unknown plans or intervals", () => {
    for (const redirect of ["//example.invalid","/planos/other","/planos?x=back\\slash"]) {
      expect(ownerLanding("/admin",new URLSearchParams({next:redirect}),null)).toBe("/admin");
    }
    expect(readSignupChoice({plan:"constructor",interval:"year"})).toBeNull();
    expect(readSignupChoice({plan:"growth",interval:"weekly"})).toBeNull();
    expect(ownerLanding("/admin",new URLSearchParams({next:"/planos?checkout=returned"}),null)).toBe("/planos?checkout=returned");
  });
});

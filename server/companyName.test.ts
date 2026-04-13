import { describe, expect, it } from "vitest";
import {
  normalizeCompanyKey,
  resolveCanonicalCompanyName,
} from "./companyName";

describe("companyName normalization", () => {
  it("maps mirait variants to one canonical key", () => {
    const k1 = normalizeCompanyKey("ミライト・ワン");
    const k2 = normalizeCompanyKey("株式会社ミライト・ワン");
    const k3 = normalizeCompanyKey("（株）ミライト・ワン");
    expect(k1).toBeTruthy();
    expect(k1).toBe(k2);
    expect(k2).toBe(k3);
  });

  it("resolves mirait variants to canonical display name", () => {
    expect(resolveCanonicalCompanyName("ミライト・ワン")).toBe("株式会社ミライト・ワン");
    expect(resolveCanonicalCompanyName("（株）ミライト・ワン")).toBe("株式会社ミライト・ワン");
    expect(resolveCanonicalCompanyName("株式会社ミライト・ワン")).toBe("株式会社ミライト・ワン");
  });
});

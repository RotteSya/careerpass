import { describe, expect, it } from "vitest";
import { createCompanyBatchDeduper, sortMailItemsByTsDesc } from "./gmail_dedup";

describe("sortMailItemsByTsDesc", () => {
  it("sorts by mailTs desc and keeps deterministic order for ties", () => {
    const items = sortMailItemsByTsDesc([
      { messageId: "b", mailTs: 1000, value: 1 },
      { messageId: "a", mailTs: 2000, value: 2 },
      { messageId: "c", mailTs: 2000, value: 3 },
    ]);
    expect(items.map((x) => x.messageId)).toEqual(["a", "c", "b"]);
  });

  it("treats invalid timestamps as oldest", () => {
    const items = sortMailItemsByTsDesc([
      { messageId: "a", mailTs: Number.NaN, value: 1 },
      { messageId: "b", mailTs: 100, value: 2 },
    ]);
    expect(items.map((x) => x.messageId)).toEqual(["b", "a"]);
  });
});

describe("createCompanyBatchDeduper", () => {
  it("returns true only for the first seen companyKey (case-insensitive)", () => {
    const isFirst = createCompanyBatchDeduper();
    expect(isFirst("Acme")).toBe(true);
    expect(isFirst("acme")).toBe(false);
    expect(isFirst("ACME")).toBe(false);
  });

  it("does not dedupe when companyKey is null", () => {
    const isFirst = createCompanyBatchDeduper();
    expect(isFirst(null)).toBe(true);
    expect(isFirst(null)).toBe(true);
  });

  it("combined: after sorting, only the newest mail per company is eligible", () => {
    const sorted = sortMailItemsByTsDesc([
      { messageId: "old", mailTs: 1000, value: { companyKey: "acme" } },
      { messageId: "new", mailTs: 2000, value: { companyKey: "acme" } },
      { messageId: "other", mailTs: 1500, value: { companyKey: "beta" } },
    ]);
    const isFirst = createCompanyBatchDeduper();
    const eligible = sorted
      .filter((x) => isFirst(x.value.companyKey))
      .map((x) => x.messageId);
    expect(eligible).toEqual(["new", "other"]);
  });
});

import { describe, expect, it } from "vitest";
import { createCompanyBatchDeduper, sortMailItemsByTsAsc } from "./gmail_dedup";

describe("sortMailItemsByTsAsc", () => {
  it("sorts by mailTs asc and keeps deterministic order for ties", () => {
    const items = sortMailItemsByTsAsc([
      { messageId: "b", mailTs: 1000, value: 1 },
      { messageId: "a", mailTs: 2000, value: 2 },
      { messageId: "c", mailTs: 2000, value: 3 },
    ]);
    expect(items.map((x) => x.messageId)).toEqual(["b", "a", "c"]);
  });

  it("treats invalid timestamps as oldest (Infinity → last in ASC)", () => {
    const items = sortMailItemsByTsAsc([
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

  it("combined: after sorting ASC, first seen per company is eligible", () => {
    const sorted = sortMailItemsByTsAsc([
      { messageId: "old", mailTs: 1000, value: { companyKey: "acme" } },
      { messageId: "new", mailTs: 2000, value: { companyKey: "acme" } },
      { messageId: "other", mailTs: 1500, value: { companyKey: "beta" } },
    ]);
    // ASC order: old(1000), other(1500), new(2000)
    // deduper keeps first seen per company → old for acme, other for beta
    const isFirst = createCompanyBatchDeduper();
    const eligible = sorted
      .filter((x) => isFirst(x.value.companyKey))
      .map((x) => x.messageId);
    expect(eligible).toEqual(["old", "other"]);
  });
});

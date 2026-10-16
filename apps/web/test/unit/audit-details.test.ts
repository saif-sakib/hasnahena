import { describe, it, expect } from "vitest";
import { readableDetails, isRetiredId } from "@/lib/audit-details";

/** A real pre-ADR-044 audit row that names one loan by its new number and its old key. */
const REAL_ROW = {
  entityId: "LOAN-2026-000002",
  details:
    "Repayment 19000 BDT on loan 8f7ade16-7e3f-4706-8928-d238091d2aa7 " +
    "by member ACC-KH-33003, receipt REP-2026-000002",
};

describe("a retired identifier in an older audit sentence", () => {
  it("is resolved to the name the row already carries", () => {
    expect(readableDetails(REAL_ROW.details, REAL_ROW.entityId)).toBe(
      "Repayment 19000 BDT on loan LOAN-2026-000002 " +
        "by member ACC-KH-33003, receipt REP-2026-000002",
    );
  });

  it("leaves the identifiers that are already readable alone", () => {
    // Current identifiers must survive untouched.
    const out = readableDetails(REAL_ROW.details, REAL_ROW.entityId)!;
    expect(out).toContain("ACC-KH-33003");
    expect(out).toContain("REP-2026-000002");
    expect(out).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });

  it("resolves a cuid as well as a uuid", () => {
    expect(
      readableDetails(
        "Posted against cmob97efh0000abcdefghijkl now",
        "DEP-2026-000004",
      ),
    ).toBe("Posted against DEP-2026-000004 now");
  });
});

describe("what it refuses to touch", () => {
  it("a sentence naming two retired ids, because nothing says which is which", () => {
    // Substituting here would put the loan's number where the member's belongs.
    const details =
      "Loan 8f7ade16-7e3f-4706-8928-d238091d2aa7 for 61211ea6-7fb3-4739-9663-391e757204d3";
    expect(readableDetails(details, "LOAN-2026-000002")).toBe(details);
  });

  it("a row whose own entityId is still a retired id", () => {
    // There is no current name to put in, so the sentence stands as written.
    const details = "Something about 8f7ade16-7e3f-4706-8928-d238091d2aa7";
    expect(
      readableDetails(details, "61211ea6-7fb3-4739-9663-391e757204d3"),
    ).toBe(details);
  });

  it("a sentence with nothing retired in it", () => {
    const details =
      "Deposit 500 BDT by member ACC-KH-33003, receipt DEP-2026-000009";
    expect(readableDetails(details, "DEP-2026-000009")).toBe(details);
  });

  it("null details, and a row with no entity", () => {
    expect(readableDetails(null, "LOAN-2026-000002")).toBeNull();
    expect(readableDetails("anything", null)).toBe("anything");
  });

  it("an account number that merely contains hex", () => {
    // ACC-KH-33001 must never be mistaken for a retired key.
    expect(isRetiredId("ACC-KH-33001")).toBe(false);
    expect(isRetiredId("LOAN-2026-000002")).toBe(false);
    expect(isRetiredId("8f7ade16-7e3f-4706-8928-d238091d2aa7")).toBe(true);
    expect(isRetiredId("cmob97efh0000abcdefghijkl")).toBe(true);
  });
});

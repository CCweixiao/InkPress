import { describe, expect, it } from "vitest";
import { isLicenseServiceNetworkError } from "../../src/lib/license/client";

describe("license client error classification", () => {
  it("allows offline grace only for fetch/network style failures", () => {
    expect(isLicenseServiceNetworkError(new TypeError("fetch failed"))).toBe(true);
    expect(isLicenseServiceNetworkError(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }))).toBe(true);
  });

  it("does not treat ordinary program errors as network outages", () => {
    expect(isLicenseServiceNetworkError(new Error("bad activation secret"))).toBe(false);
    expect(isLicenseServiceNetworkError(new SyntaxError("broken state"))).toBe(false);
  });
});

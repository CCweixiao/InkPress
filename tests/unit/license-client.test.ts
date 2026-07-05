import { describe, expect, it } from "vitest";
import {
  isLicenseServiceNetworkError,
  isLocalLicenseUsable,
} from "../../src/lib/license/client";

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

describe("license client local status gate", () => {
  const now = Date.parse("2026-07-05T12:00:00.000Z");

  it("allows only active, unexpired local license state", () => {
    expect(
      isLocalLicenseUsable(
        { status: "ACTIVE", effectiveExpiresAt: "2026-07-05T12:00:01.000Z" },
        now
      )
    ).toBe(true);
    expect(isLocalLicenseUsable({ status: "ACTIVE", effectiveExpiresAt: null }, now)).toBe(
      true
    );
  });

  it("blocks cached active state after effective expiry", () => {
    expect(
      isLocalLicenseUsable(
        { status: "ACTIVE", effectiveExpiresAt: "2026-07-05T12:00:00.000Z" },
        now
      )
    ).toBe(false);
  });

  it("does not allow offline grace for known non-active states", () => {
    expect(isLocalLicenseUsable({ status: "DISABLED", effectiveExpiresAt: null }, now)).toBe(
      false
    );
    expect(isLocalLicenseUsable({ status: "REVOKED", effectiveExpiresAt: null }, now)).toBe(
      false
    );
  });
});

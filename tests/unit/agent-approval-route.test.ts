import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique, update, updateMany, addAllowedDomain, resolveApproval } =
  vi.hoisted(() => ({
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    addAllowedDomain: vi.fn(),
    resolveApproval: vi.fn(),
  }));

vi.mock("@/lib/db", () => ({
  prisma: {
    toolActionGrant: { findUnique, update, updateMany },
  },
}));
vi.mock("@/lib/ai/web-allowlist", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/ai/web-allowlist")>()),
  addAllowedDomain,
}));
vi.mock("@/lib/ai/pending-approvals", () => ({
  PENDING_APPROVAL_TTL_MS: 110_000,
  resolveApproval,
}));

import { POST } from "../../src/app/api/ai/agent-approvals/[id]/route";

describe("single tool approval claim ordering", () => {
  beforeEach(() => {
    findUnique.mockReset();
    update.mockReset();
    updateMany.mockReset();
    addAllowedDomain.mockReset();
    resolveApproval.mockReset();
  });

  it("does not trust a domain when a concurrent rejection wins the grant claim", async () => {
    const approvalToken = "approval-token-with-enough-length";
    const grant = {
      id: "grant-1",
      sessionId: "session-1",
      toolName: "web_fetch",
      status: "pending",
      createdAt: new Date(),
      approvalTokenHash: crypto
        .createHash("sha256")
        .update(approvalToken)
        .digest("hex"),
      decisionJson: JSON.stringify({ input: { url: "https://example.com/a" } }),
    };
    findUnique
      .mockResolvedValueOnce(grant)
      .mockResolvedValueOnce({ status: "rejected" });
    updateMany.mockResolvedValue({ count: 0 });

    const response = await POST(
      new Request("http://localhost/api/ai/agent-approvals/grant-1", {
        method: "POST",
        body: JSON.stringify({ approvalToken, action: "approve" }),
      }),
      { params: Promise.resolve({ id: "grant-1" }) }
    );

    expect(response.status).toBe(409);
    expect(addAllowedDomain).not.toHaveBeenCalled();
    expect(resolveApproval).not.toHaveBeenCalled();
  });
});

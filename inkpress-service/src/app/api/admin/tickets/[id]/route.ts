import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/admin-guard";
import { getTicketForAdmin, adminUpdateStatus } from "@/lib/tickets/service";
import { updateTicketStatusSchema } from "@/lib/validation/schemas";
import { readJsonBody } from "@/lib/http";
import { ok, fail, failFromError, getRequestId } from "@/lib/api-response";
import { ErrorCode } from "@/lib/errors";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(req.headers);
  try {
    await requireAdmin();
    const { id } = await params;
    const ticket = await getTicketForAdmin(id);
    return ok(ticket, { requestId });
  } catch (err) {
    return failFromError(err, requestId);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(req.headers);
  try {
    await requireAdmin();
    const { id } = await params;
    let body: unknown;
    try {
      body = await readJsonBody(req, { limitBytes: 8 * 1024 });
    } catch (err) {
      return failFromError(err, requestId);
    }
    const parsed = updateTicketStatusSchema.safeParse(body);
    if (!parsed.success) {
      return fail(ErrorCode.VALIDATION_ERROR, {
        message: parsed.error.issues[0]?.message ?? "参数错误",
        details: parsed.error.issues,
        requestId,
      });
    }
    const updated = await adminUpdateStatus(id, parsed.data.status, parsed.data.priority);
    return ok(updated, { requestId });
  } catch (err) {
    return failFromError(err, requestId);
  }
}

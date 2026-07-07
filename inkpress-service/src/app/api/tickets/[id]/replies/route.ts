import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { userReply } from "@/lib/tickets/service";
import { createTicketReplySchema } from "@/lib/validation/schemas";
import { readJsonBody } from "@/lib/http";
import { ok, fail, failFromError, getRequestId } from "@/lib/api-response";
import { ErrorCode } from "@/lib/errors";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(req.headers);
  try {
    const session = await requireSession();
    const { id } = await params;
    let body: unknown;
    try {
      body = await readJsonBody(req, { limitBytes: 64 * 1024 });
    } catch (err) {
      return failFromError(err, requestId);
    }
    const parsed = createTicketReplySchema.safeParse(body);
    if (!parsed.success) {
      return fail(ErrorCode.VALIDATION_ERROR, {
        message: parsed.error.issues[0]?.message ?? "参数错误",
        details: parsed.error.issues,
        requestId,
      });
    }
    const reply = await userReply(session.user.id, id, parsed.data);
    return ok({ id: reply.id }, { status: 201, requestId });
  } catch (err) {
    return failFromError(err, requestId);
  }
}

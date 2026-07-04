import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createTicket, listUserTickets } from "@/lib/tickets/service";
import {
  createTicketSchema,
  TicketStatusSchema,
  paginationSchema,
} from "@/lib/validation/schemas";
import { readJsonBody } from "@/lib/http";
import { ok, fail, failFromError, getRequestId } from "@/lib/api-response";
import { ErrorCode } from "@/lib/errors";

export async function POST(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  try {
    const session = await requireSession();
    let body: unknown;
    try {
      body = await readJsonBody(req, { limitBytes: 64 * 1024 });
    } catch (err) {
      return failFromError(err, requestId);
    }
    const parsed = createTicketSchema.safeParse(body);
    if (!parsed.success) {
      return fail(ErrorCode.VALIDATION_ERROR, {
        message: parsed.error.issues[0]?.message ?? "参数错误",
        details: parsed.error.issues,
        requestId,
      });
    }
    const ticket = await createTicket(session.user.id, parsed.data);
    return ok({ id: ticket.id }, { status: 201, requestId });
  } catch (err) {
    return failFromError(err, requestId);
  }
}

export async function GET(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  try {
    const session = await requireSession();
    const params = req.nextUrl.searchParams;
    const { page, pageSize } = paginationSchema.parse({
      page: params.get("page") ?? 1,
      pageSize: params.get("pageSize") ?? 20,
    });
    const statusRaw = params.get("status") ?? undefined;
    if (statusRaw) {
      const parsed = TicketStatusSchema.safeParse(statusRaw);
      if (!parsed.success) {
        return fail(ErrorCode.VALIDATION_ERROR, {
          message: "status 参数错误",
          requestId,
        });
      }
    }
    const result = await listUserTickets(session.user.id, {
      page,
      pageSize,
      status: statusRaw,
      q: params.get("q") ?? undefined,
    });
    return ok(result, { requestId });
  } catch (err) {
    return failFromError(err, requestId);
  }
}

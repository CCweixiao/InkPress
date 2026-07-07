import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/admin-guard";
import { listAdminTickets } from "@/lib/tickets/service";
import {
  TicketStatusSchema,
  TicketTypeSchema,
  paginationSchema,
} from "@/lib/validation/schemas";
import { ok, fail, failFromError, getRequestId } from "@/lib/api-response";
import { ErrorCode } from "@/lib/errors";

export async function GET(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  try {
    await requireAdmin();
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

    const typeRaw = params.get("type") ?? undefined;
    if (typeRaw) {
      const parsed = TicketTypeSchema.safeParse(typeRaw);
      if (!parsed.success) {
        return fail(ErrorCode.VALIDATION_ERROR, {
          message: "type 参数错误",
          requestId,
        });
      }
    }

    const result = await listAdminTickets({
      page,
      pageSize,
      status: statusRaw,
      type: typeRaw,
      q: params.get("q") ?? undefined,
    });
    return ok(result, { requestId });
  } catch (err) {
    return failFromError(err, requestId);
  }
}

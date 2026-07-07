import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { getTicketForUser } from "@/lib/tickets/service";
import { ok, failFromError, getRequestId } from "@/lib/api-response";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(req.headers);
  try {
    const session = await requireSession();
    const { id } = await params;
    const ticket = await getTicketForUser(session.user.id, id);
    return ok(ticket, { requestId });
  } catch (err) {
    return failFromError(err, requestId);
  }
}

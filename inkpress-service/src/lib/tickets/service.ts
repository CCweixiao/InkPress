import { prisma } from "@/lib/db";
import { AppError, ErrorCode } from "@/lib/errors";
import { moduleLogger } from "@/lib/logger";
import { sendMail } from "@/lib/email";
import {
  renderNewTicketAdminEmail,
  renderTicketRepliedUserEmail,
  renderTicketRepliedAdminEmail,
  renderTicketClosedUserEmail,
} from "@/lib/email/templates/ticket-emails";
import type { Attachment } from "./attach";

const log = moduleLogger("tickets");

export interface CreateTicketInput {
  type: string;
  subject: string;
  description: string;
  attachments: Attachment[];
}

export interface CreateReplyInput {
  content: string;
  attachments: Attachment[];
}

export interface ListTicketsOpts {
  page: number;
  pageSize: number;
  status?: string;
  type?: string;
  q?: string;
}

function notifyInBackground(p: Promise<void>, label: string): void {
  p.catch((err) => log.error({ err, label }, "邮件通知失败（已忽略）"));
}

/** 用户创建工单 */
export async function createTicket(userId: string, input: CreateTicketInput) {
  const ticket = await prisma.ticket.create({
    data: {
      userId,
      type: input.type,
      subject: input.subject,
      description: input.description,
      status: "OPEN",
      priority: "NORMAL",
      attachments: JSON.stringify(input.attachments),
    },
  });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });

  if (user?.email) {
    notifyInBackground(
      sendMail(
        renderNewTicketAdminEmail(
          {
            id: ticket.id,
            type: ticket.type,
            subject: ticket.subject,
            description: ticket.description,
          },
          user.email
        )
      ),
      "new-ticket-admin"
    );
  }

  return ticket;
}

/** 用户工单列表 */
export async function listUserTickets(
  userId: string,
  opts: ListTicketsOpts
): Promise<{ items: Awaited<ReturnType<typeof prisma.ticket.findMany>>; total: number }> {
  const where = {
    userId,
    ...(opts.status ? { status: opts.status } : {}),
    ...(opts.type ? { type: opts.type } : {}),
    ...(opts.q
      ? {
          OR: [
            { subject: { contains: opts.q } },
            { description: { contains: opts.q } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.ticket.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
    }),
    prisma.ticket.count({ where }),
  ]);
  return { items, total };
}

/** 获取用户单个工单（含 replies） */
export async function getTicketForUser(userId: string, ticketId: string) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: {
      replies: {
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!ticket || ticket.userId !== userId) {
    throw new AppError(ErrorCode.NOT_FOUND, "工单不存在");
  }
  return ticket;
}

/** 用户追加回复（含自动重开逻辑） */
export async function userReply(
  userId: string,
  ticketId: string,
  input: CreateReplyInput
) {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket || ticket.userId !== userId) {
    throw new AppError(ErrorCode.NOT_FOUND, "工单不存在");
  }
  if (ticket.status === "CLOSED") {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "工单已关闭，请新建工单");
  }

  const reply = await prisma.ticketReply.create({
    data: {
      ticketId,
      authorId: userId,
      authorRole: "USER",
      content: input.content,
      attachments: JSON.stringify(input.attachments),
    },
  });

  // RESOLVED → 用户回复后自动重开为 ANSWERED；OPEN 保持不变
  const newStatus = ticket.status === "RESOLVED" ? "ANSWERED" : ticket.status;
  await prisma.ticket.update({
    where: { id: ticketId },
    data: { status: newStatus },
  });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });

  if (user?.email) {
    notifyInBackground(
      sendMail(
        renderTicketRepliedAdminEmail(
          {
            id: ticket.id,
            type: ticket.type,
            subject: ticket.subject,
          },
          {
            content: reply.content,
            authorRole: "USER",
            createdAt: reply.createdAt,
          },
          user.email
        )
      ),
      "user-reply-admin"
    );
  }

  return reply;
}

/** 管理员工单列表 */
export async function listAdminTickets(opts: ListTicketsOpts) {
  const where = {
    ...(opts.status ? { status: opts.status } : {}),
    ...(opts.type ? { type: opts.type } : {}),
    ...(opts.q
      ? {
          OR: [
            { subject: { contains: opts.q } },
            { description: { contains: opts.q } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.ticket.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
      include: {
        user: {
          select: { id: true, email: true },
        },
      },
    }),
    prisma.ticket.count({ where }),
  ]);
  return { items, total };
}

/** 管理员获取工单详情 */
export async function getTicketForAdmin(ticketId: string) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: {
      replies: {
        orderBy: { createdAt: "asc" },
      },
      user: {
        select: { id: true, email: true },
      },
    },
  });
  if (!ticket) {
    throw new AppError(ErrorCode.NOT_FOUND, "工单不存在");
  }
  return ticket;
}

/** 管理员回复（自动置 ANSWERED + 通知用户） */
export async function adminReply(
  adminId: string,
  ticketId: string,
  input: CreateReplyInput
) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: {
      user: { select: { email: true } },
    },
  });
  if (!ticket) {
    throw new AppError(ErrorCode.NOT_FOUND, "工单不存在");
  }

  const reply = await prisma.ticketReply.create({
    data: {
      ticketId,
      authorId: adminId,
      authorRole: "ADMIN",
      content: input.content,
      attachments: JSON.stringify(input.attachments),
    },
  });

  await prisma.ticket.update({
    where: { id: ticketId },
    data: { status: "ANSWERED" },
  });

  if (ticket.user.email) {
    notifyInBackground(
      sendMail(
        renderTicketRepliedUserEmail(
          ticket.user.email,
          {
            id: ticket.id,
            type: ticket.type,
            subject: ticket.subject,
          },
          {
            content: reply.content,
            authorRole: "ADMIN",
            createdAt: reply.createdAt,
          }
        )
      ),
      "admin-reply-user"
    );
  }

  return reply;
}

/** 管理员更新状态/优先级 */
export async function adminUpdateStatus(
  ticketId: string,
  status: string,
  priority?: string
) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: {
      user: { select: { email: true } },
    },
  });
  if (!ticket) {
    throw new AppError(ErrorCode.NOT_FOUND, "工单不存在");
  }

  const updated = await prisma.ticket.update({
    where: { id: ticketId },
    data: {
      status,
      ...(priority ? { priority } : {}),
    },
  });

  // 关闭/解决时通知用户
  if ((status === "RESOLVED" || status === "CLOSED") && ticket.user.email) {
    notifyInBackground(
      sendMail(
        renderTicketClosedUserEmail(ticket.user.email, {
          id: ticket.id,
          type: ticket.type,
          subject: ticket.subject,
          status,
        })
      ),
      "ticket-closed-user"
    );
  }

  return updated;
}

import { randomInt } from "node:crypto";
import { prisma } from "@/lib/db";
import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("invite-code");

/** 字符集：0-9 A-Z a-z（62 字符，大小写敏感） */
const ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const CODE_LENGTH = 6;
const MAX_COLLISION_RETRIES = 10;

/**
 * 生成 6 位大小写敏感邀请码，查重冲突重试。
 * 超过 MAX_COLLISION_RETRIES 仍冲突时报警并抛出（极小概率，需人工介入）。
 */
export async function generateUniqueInvitationCode(): Promise<string> {
  for (let attempt = 1; attempt <= MAX_COLLISION_RETRIES; attempt++) {
    const code = randomCode();
    const exists = await prisma.invitationCode.findUnique({
      where: { code },
      select: { id: true },
    });
    if (!exists) return code;
    log.warn({ attempt }, "邀请码冲突，重试");
  }
  log.error("邀请码连续冲突超过阈值，疑似空间耗尽");
  throw new Error("INVITATION_CODE_GENERATION_FAILED");
}

function randomCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[randomInt(0, ALPHABET.length)];
  }
  return code;
}

/**
 * 幂等为指定用户补发邀请码。
 * 注册端与 OAuth createUser 事件均调用；并发竞争时回查复用，保证每用户唯一。
 */
export async function ensureUserInvitationCode(userId: string): Promise<string> {
  const existing = await prisma.invitationCode.findUnique({
    where: { userId },
    select: { code: true },
  });
  if (existing) return existing.code;

  try {
    const code = await generateUniqueInvitationCode();
    const created = await prisma.invitationCode.create({
      data: { code, userId },
    });
    return created.code;
  } catch {
    // 并发：userId 或 code 唯一冲突 → 回查复用
    const again = await prisma.invitationCode.findUnique({
      where: { userId },
      select: { code: true },
    });
    if (again) return again.code;
    throw new Error("INVITATION_CODE_CREATE_FAILED");
  }
}

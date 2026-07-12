import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto/secret-store";
import { getAccessToken } from "@/lib/wechat/token";
import { ensureOk, wxJson } from "@/lib/wechat/client";
const schema = z.object({ name: z.string().trim().min(1).max(60).optional(), appId: z.string().trim().min(1).max(100).optional(), secret: z.string().trim().min(1).max(300).optional(), tags: z.array(z.string().trim().min(1).max(30)).max(20).optional(), isDefault: z.boolean().optional(), status: z.enum(["active", "disabled"]).optional() });
export async function PATCH(req: NextRequest, { params }: { params: Promise<{id:string}> }) { const p=schema.safeParse(await req.json().catch(()=>({}))); if(!p.success)return NextResponse.json({error:p.error.flatten()},{status:400}); const id=(await params).id; const d=p.data; const account=await prisma.$transaction(async tx=>{if(d.isDefault) await tx.wechatAccount.updateMany({where:{id:{not:id}},data:{isDefault:false}}); return tx.wechatAccount.update({where:{id},data:{name:d.name,appId:d.appId,secret:d.secret?encryptSecret(d.secret):undefined,tagsJson:d.tags!==undefined?JSON.stringify(d.tags):undefined,isDefault:d.isDefault,status:d.status}})}).catch(()=>null); if(!account)return NextResponse.json({error:"账号不存在或 AppID 已被使用"},{status:404}); const {secret: _secret,...safe}=account; return NextResponse.json({account:safe}); }
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{id:string}> }) { const id=(await params).id; await prisma.wechatAccount.delete({where:{id}}).catch(()=>null); return NextResponse.json({ok:true}); }

/** 强制刷新 token 后再调用基础接口：既验证 AppID/AppSecret，也验证服务器出口 IP 白名单。 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{id:string}> }) {
  const id = (await params).id;
  const account = await prisma.wechatAccount.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!account) return NextResponse.json({ error: "公众号不存在。" }, { status: 404 });
  if (account.status !== "active") return NextResponse.json({ error: "该公众号已停用，请先恢复后再测试。" }, { status: 400 });
  try {
    await getAccessToken(id, true);
    const result = await wxJson("/getcallbackip", {}, { method: "GET", accountId: id });
    ensureOk(result, "验证公众号接口");
    await prisma.wechatAccount.update({ where: { id }, data: { status: "active", lastError: null, lastCheckedAt: new Date() } });
    return NextResponse.json({ ok: true, message: "连接正常：凭证有效，服务器出口 IP 已获公众号平台授权。" });
  } catch (error) {
    const raw = error instanceof Error ? error.message : "连接测试失败";
    const isIpDenied = /40164|IP 白名单/i.test(raw);
    const isCredentialError = /40001|40013|40125|invalid appid|invalid appsecret|获取 access_token 失败/i.test(raw);
    const isInvalidResponse = /非 JSON 响应|响应为空/i.test(raw);
    const guidance = isIpDenied
      ? "请前往微信公众平台 → 设置与开发 → 基本配置 → IP 白名单，添加当前部署服务器的出口公网 IP；保存后重新测试。"
      : isCredentialError
        ? "请核对 AppID 与 AppSecret 是否属于同一个公众号。若刚重置过密钥，请在此重新编辑并保存新 AppSecret 后再次测试。"
        : isInvalidResponse
          ? "微信接口没有返回有效数据。请检查服务器是否经过代理、网关或安全软件拦截；确认可直接访问 https://api.weixin.qq.com 后重试。"
          : "请检查网络是否能访问 api.weixin.qq.com，并确认公众号接口权限可用后重试。";
    await prisma.wechatAccount.update({ where: { id }, data: { lastError: raw, lastCheckedAt: new Date() } }).catch(() => {});
    return NextResponse.json({ ok: false, kind: isIpDenied ? "ip_whitelist" : isCredentialError ? "credentials" : isInvalidResponse ? "invalid_response" : "network", error: raw, guidance }, { status: 400 });
  }
}

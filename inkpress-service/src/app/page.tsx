import { redirect } from "next/navigation";
import { auth } from "@/auth";

/** 落地页：已登录跳 /dashboard，否则跳 /login */
export default async function Home() {
  const session = await auth();
  redirect(session?.user ? "/dashboard" : "/login");
}

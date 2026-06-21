import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { logsDir } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 列出日志文件（inkpress.log + 滚动历史 .1 ~ .4），按时间倒序 */
function listLogFiles() {
  const dir = logsDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("inkpress.log") || f === "electron.log")
    .map((f) => {
      const full = path.join(dir, f);
      const stat = fs.statSync(full);
      return { name: f, size: stat.size, mtime: stat.mtime.toISOString() };
    })
    .sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
}

/** 读取文件尾部 N 行 */
function readTail(filePath: string, lines: number, level?: string, query?: string): string[] {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, "utf8");
  let allLines = content.split("\n").filter(Boolean);
  // 筛选
  if (level) {
    const lv = level.toLowerCase();
    allLines = allLines.filter((l) => {
      try {
        const obj = JSON.parse(l);
        return String(obj.level).toLowerCase() === lv;
      } catch {
        return false;
      }
    });
  }
  if (query) {
    const q = query.toLowerCase();
    allLines = allLines.filter((l) => l.toLowerCase().includes(q));
  }
  return allLines.slice(-lines);
}

/**
 * GET /api/logs
 * - 无参数：返回文件列表 + 最新文件尾部 500 行
 * - ?file=xxx&lines=500：指定文件尾部
 * - ?level=error&q=keyword：筛选
 * - ?stream=1：SSE 实时推送新增行
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const stream = searchParams.get("stream");

  // SSE 实时流
  if (stream === "1") {
    return streamLogs(req);
  }

  const files = listLogFiles();
  const file = searchParams.get("file") || files[0]?.name;
  const lines = Math.min(Number(searchParams.get("lines") || 500), 5000);
  const level = searchParams.get("level") || undefined;
  const q = searchParams.get("q") || undefined;

  let tail: string[] = [];
  if (file) {
    const filePath = path.join(logsDir(), file);
    // 安全：文件名不得含路径分隔（防穿越）
    if (path.basename(file) !== file || !fs.existsSync(filePath)) {
      return NextResponse.json({ error: "日志文件不存在" }, { status: 404 });
    }
    tail = readTail(filePath, lines, level, q);
  }

  return NextResponse.json({ files, currentFile: file, lines: tail });
}

/** SSE：实时推送日志新增行（tail -f 效果） */
function streamLogs(req: NextRequest): Response {
  const { searchParams } = new URL(req.url);
  const file = searchParams.get("file") || "inkpress.log";
  const level = searchParams.get("level") || undefined;
  const q = searchParams.get("q") || undefined;

  const filePath = path.join(logsDir(), path.basename(file));
  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    start(controller) {
      // SSE 头
      controller.enqueue(encoder.encode(": connected\n\n"));

      let size = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
      const matches = (line: string) => {
        if (level) {
          try {
            if (String(JSON.parse(line).level).toLowerCase() !== level.toLowerCase()) return false;
          } catch {
            return false;
          }
        }
        if (q && !line.toLowerCase().includes(q.toLowerCase())) return false;
        return true;
      };

      const poll = () => {
        try {
          if (!fs.existsSync(filePath)) return;
          const newSize = fs.statSync(filePath).size;
          if (newSize <= size) return;
          const fd = fs.openSync(filePath, "r");
          const buf = Buffer.alloc(newSize - size);
          fs.readSync(fd, buf, 0, buf.length, size);
          fs.closeSync(fd);
          size = newSize;
          const newLines = buf.toString("utf8").split("\n").filter(Boolean);
          for (const line of newLines) {
            if (matches(line)) {
              controller.enqueue(encoder.encode(`data: ${line}\n\n`));
            }
          }
        } catch {
          // 忽略读取错误
        }
      };

      const interval = setInterval(poll, 1000);

      // 清理：客户端断开
      req.signal.addEventListener("abort", () => {
        clearInterval(interval);
        try {
          controller.close();
        } catch {
          // 已关闭
        }
      });
    },
  });

  return new Response(readable, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}

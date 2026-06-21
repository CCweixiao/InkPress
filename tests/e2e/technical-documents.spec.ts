import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import fs from "node:fs/promises";
import path from "node:path";

let documentId = "";

test.afterEach(async () => {
  if (!documentId) return;
  const db = new Database("dev.db");
  db.pragma("foreign_keys = ON");
  db.prepare("DELETE FROM TechnicalDocument WHERE id = ?").run(documentId);
  db.close();
  await fs.rm(path.join("storage", "technical-documents", `${documentId}.md`), {
    force: true,
  });
  documentId = "";
});

test("renders Mermaid, source evidence and applies a technical document proposal", async ({
  page,
}) => {
  documentId = `techdoc-${Date.now()}`;
  const db = new Database("dev.db");
  db.prepare(
    `INSERT INTO TechnicalDocument
      (id, title, documentType, projectId, contentPath, snapshotHash, status, createdAt, updatedAt)
     VALUES (?, ?, 'call-chain', 'inkpress', ?, '', 'draft', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
  ).run(
    documentId,
    "调用链文档",
    `technical-documents/${documentId}.md`
  );
  db.close();
  await fs.mkdir(path.join("storage", "technical-documents"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join("storage", "technical-documents", `${documentId}.md`),
    "# 调用链\n\n`src/app/page.tsx#L1-L20`\n\n```mermaid\nflowchart LR\nA --> B\n```\n",
    "utf8"
  );

  await page.route(
    `**/api/ai/chat?targetKind=technical-document&targetId=${documentId}`,
    (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          session: { id: "tech-session" },
          messages: [
            {
              id: "assistant-tech",
              role: "assistant",
              parts: [
                {
                  type: "data-code-explore-step",
                  id: "explore",
                  data: {
                    title: "代码探索工具调用",
                    detail: "project_symbols、project_call_hierarchy",
                  },
                },
                {
                  type: "data-project-snapshot",
                  id: "snapshot",
                  data: {
                    snapshotHash: "abc123",
                    symbols: 12,
                    edges: 8,
                  },
                },
              ],
            },
          ],
          proposals: [
            {
              id: "tech-proposal",
              proposalKind: "technical-document",
              summary: "补充调用链说明",
              status: "pending",
            },
          ],
        }),
      })
  );
  await page.route("**/api/ai/proposals/tech-proposal", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        proposal: {
          id: "tech-proposal",
          proposalKind: "technical-document",
          targetId: documentId,
          baseTitle: "调用链文档",
          baseMarkdown: "# 调用链",
          baseDigest: "",
          title: "调用链文档",
          markdown: "# 调用链\n\n更新后的技术文档。",
          digest: "abc123",
          summary: "补充调用链说明",
          status: "pending",
          stats: { oldLines: 1, newLines: 3, changedLines: 2 },
        },
      }),
    })
  );
  await page.route("**/api/ai/proposals/tech-proposal/apply", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        technicalDocument: {
          title: "调用链文档",
          markdown: "# 调用链\n\n更新后的技术文档。",
          snapshotHash: "abc123",
        },
      }),
    })
  );

  await page.goto(`/technical-documents/${documentId}`);
  await expect(page.getByText("代码探索工具调用")).toBeVisible();
  await expect(page.getByText(/12 个符号/)).toBeVisible();
  await expect(page.getByText("A")).toBeVisible();
  await expect(page.getByRole("link", { name: "src/app/page.tsx#L1-L20" })).toBeVisible();
  await expect(page.getByText("技术文档修改提案")).toBeVisible();
  await page.getByRole("button", { name: "应用修改" }).click();
  await expect(
    page.getByPlaceholder("让 Agent 探索项目并生成技术文档，或在这里直接编辑 Markdown…")
  ).toHaveValue("# 调用链\n\n更新后的技术文档。");
  await expect(page.getByText("已应用")).toBeVisible();
});

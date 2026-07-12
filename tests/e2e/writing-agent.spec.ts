import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

let createdArticleId = "";
const execFileAsync = promisify(execFile);
const temporaryRoots: string[] = [];
const e2eDb = path.join(".e2e-data", "database", "inkpress.db");
const e2eStorage = path.join(".e2e-data", "storage");

test.afterEach(async () => {
  if (!createdArticleId) return;
  const db = new Database(e2eDb);
  db.pragma("foreign_keys = ON");
  db.prepare("DELETE FROM Article WHERE id = ?").run(createdArticleId);
  db.close();
  await fs
    .rm(path.join(e2eStorage, "articles", `${createdArticleId}.md`), {
      force: true,
    })
    .catch(() => {});
  createdArticleId = "";
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true }))
  );
});

test("authorizes a direct local path and exposes read-only git change APIs", async ({
  request,
}) => {
  const created = await request.post("/api/articles", {
    data: { title: "Dynamic Source E2E" },
  });
  expect(created.ok()).toBeTruthy();
  const articleId = (await created.json()).article.id as string;
  createdArticleId = articleId;

  const root = await fs.mkdtemp(path.join("/tmp", "inkpress-e2e-source-"));
  temporaryRoots.push(root);
  const git = async (args: string[]) =>
    (
      await execFileAsync("git", args, {
        cwd: root,
      })
    ).stdout.trim();
  await git(["init"]);
  await git(["config", "user.name", "InkPress E2E"]);
  await git(["config", "user.email", "e2e@inkpress.local"]);
  await fs.writeFile(path.join(root, "feature.ts"), "export const value = 1;\n");
  await git(["add", "feature.ts"]);
  await git(["commit", "-m", "feat: initial"]);
  const base = await git(["rev-parse", "HEAD"]);
  await fs.writeFile(
    path.join(root, "feature.ts"),
    "export const value = 2;\nexport const enabled = true;\n"
  );
  await git(["add", "feature.ts"]);
  await git(["commit", "-m", "feat: enable behavior"]);
  const head = await git(["rev-parse", "HEAD"]);

  const resolved = await request.post("/api/ai/code-sources/resolve", {
    data: {
      target: { kind: "article", id: articleId },
      message: `分析本地项目 ${root} 的提交变化`,
    },
  });
  expect(resolved.ok()).toBeTruthy();
  const sourceBody = await resolved.json();
  expect(sourceBody.source.status).toBe("pending");
  expect(sourceBody.approvalToken).toBeTruthy();

  const invalid = await request.post(
    `/api/ai/code-sources/${sourceBody.source.id}/approve`,
    {
      data: {
        approvalToken: "invalid-invalid-invalid",
        action: "approve",
        scope: "session",
      },
    }
  );
  expect(invalid.status()).toBe(409);

  const approved = await request.post(
    `/api/ai/code-sources/${sourceBody.source.id}/approve`,
    {
      data: {
        approvalToken: sourceBody.approvalToken,
        action: "approve",
        scope: "session",
      },
    }
  );
  expect(approved.ok()).toBeTruthy();

  const commits = await request.get(
    `/api/ai/code-sources/${sourceBody.source.id}/commits?base=${base}&head=${head}`
  );
  expect(commits.ok()).toBeTruthy();
  expect((await commits.json()).commits).toHaveLength(1);

  const changes = await request.post(
    `/api/ai/code-sources/${sourceBody.source.id}/changes`,
    { data: { base, head, includeDiff: true, file: "feature.ts" } }
  );
  expect(changes.ok()).toBeTruthy();
  const changesBody = await changes.json();
  expect(changesBody.changedFiles[0].path).toBe("feature.ts");
  expect(changesBody.diff.diff).toContain("enabled = true");
  expect(await git(["status", "--porcelain"])).toBe("");
});

test("shows a persisted proposal and applies it to the editor", async ({ page, request }) => {
  const created = await request.post("/api/articles", {
    data: { title: "Agent E2E" },
  });
  expect(created.ok()).toBeTruthy();
  const body = await created.json();
  const articleId = body.article.id as string;
  createdArticleId = articleId;

  await page.route(
    `**/api/ai/chat?targetKind=article&targetId=${articleId}`,
    async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        session: { id: "session-e2e", selectedProjectId: null },
        messages: [
          {
            id: "user-e2e",
            role: "user",
            parts: [{ type: "text", text: "润色当前文章" }],
          },
          {
            id: "assistant-e2e",
            role: "assistant",
            parts: [
              {
                type: "data-agent-step",
                id: "intent",
                data: {
                  title: "识别写作意图",
                  detail: "polish · 自动路由",
                  status: "completed",
                },
              },
              {
                type: "reasoning",
                text: "先检查文章结构与表达。",
                state: "done",
              },
              { type: "text", text: "已完成文章润色。" },
            ],
          },
        ],
        proposals: [
          {
            id: "proposal-e2e",
            title: "新的文章标题",
            markdown: "# 新的文章标题\n\n这是 Agent 调整后的正文。",
            digest: "新的摘要",
            summary: "重写标题与正文结构",
            status: "pending",
          },
        ],
      }),
    });
    }
  );
  await page.route("**/api/ai/projects", (route) =>
    route.fulfill({ contentType: "application/json", body: '{"projects":[]}' })
  );
  await page.route("**/api/ai/skills", (route) =>
    route.fulfill({ contentType: "application/json", body: '{"skills":[]}' })
  );
  await page.route("**/api/ai/proposals/proposal-e2e/apply", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        article: {
          title: "新的文章标题",
          contentMd: "# 新的文章标题\n\n这是 Agent 调整后的正文。",
          digest: "新的摘要",
          contentRevision: 1,
        },
      }),
    });
  });
  await page.route("**/api/ai/proposals/proposal-e2e", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        proposal: {
          id: "proposal-e2e",
          proposalKind: "article",
          targetId: articleId,
          baseTitle: "Agent E2E",
          baseMarkdown: "# Agent E2E\n\n旧正文。",
          baseDigest: "旧摘要",
          title: "新的文章标题",
          markdown: "# 新的文章标题\n\n这是 Agent 调整后的正文。",
          digest: "新的摘要",
          summary: "重写标题与正文结构",
          status: "pending",
          stats: { oldLines: 3, newLines: 3, changedLines: 2 },
        },
      }),
    });
  });

  await page.goto(`/editor/${articleId}`);
  await page.getByRole("button", { name: "写作助手" }).click();
  await expect(page.getByText("识别写作意图")).toBeVisible();
  await expect(page.getByText("模型思考")).toBeVisible();
  await expect(page.getByText("文章修改提案")).toBeVisible();
  await expect(page.getByText("不使用本地项目")).toHaveCount(0);
  await expect(page.getByText(/可按需加载/)).toHaveCount(0);
  await page.getByRole("button", { name: "全屏审查" }).click();
  await expect(page.getByText("文章修改审查")).toBeVisible();
  await expect(page.getByText("原内容")).toBeVisible();
  await expect(page.getByText("新内容")).toBeVisible();
  await page.getByRole("button", { name: "关闭" }).click();
  await page.getByRole("button", { name: "应用修改" }).click();
  await expect(page.locator('input[placeholder="文章标题"]')).toHaveValue(
    "新的文章标题"
  );
  await expect(page.getByText("已应用")).toBeVisible();
  await expect(page.getByRole("button", { name: "放弃" })).toHaveCount(0);
});

test("proposal apply and reject are mutually exclusive", async ({ request }) => {
  const created = await request.post("/api/articles", {
    data: { title: "Agent Concurrency" },
  });
  expect(created.ok()).toBeTruthy();
  const body = await created.json();
  const articleId = body.article.id as string;
  createdArticleId = articleId;
  const proposalId = `proposal-${Date.now()}`;
  const baseVersionHash = createHash("sha256")
    .update(
      JSON.stringify({
        title: "Agent Concurrency",
        markdown: "",
        digest: "",
      })
    )
    .digest("hex");
  const db = new Database(e2eDb);
  db.prepare(
    `INSERT INTO AgentArticleProposal
      (id, articleId, baseVersionHash, baseTitle, baseMarkdown, baseDigest,
       title, markdown, digest, summary, status, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
  ).run(
    proposalId,
    articleId,
    baseVersionHash,
    "Agent Concurrency",
    "",
    "",
    "并发修改",
    "# 并发修改\n\n正文",
    "摘要",
    "并发状态测试"
  );
  db.close();

  const [apply, reject] = await Promise.all([
    request.post(`/api/ai/proposals/${proposalId}/apply`),
    request.patch(`/api/ai/proposals/${proposalId}`, {
      data: { status: "rejected" },
    }),
  ]);
  expect([apply.status(), reject.status()].sort()).toEqual([200, 409]);

  const detail = await request.get(`/api/ai/proposals/${proposalId}`);
  const detailBody = await detail.json();
  expect(["applied", "rejected"]).toContain(detailBody.proposal.status);
});

test("rejected proposal remains visible without action buttons", async ({
  page,
  request,
}) => {
  const created = await request.post("/api/articles", {
    data: { title: "Agent Rejected" },
  });
  const body = await created.json();
  const articleId = body.article.id as string;
  createdArticleId = articleId;
  await page.route(
    `**/api/ai/chat?targetKind=article&targetId=${articleId}`,
    (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        session: { id: "session-rejected" },
        messages: [],
        proposals: [
          {
            id: "proposal-rejected",
            summary: "已放弃的修改",
            status: "rejected",
          },
        ],
      }),
    })
  );
  await page.route("**/api/ai/proposals/proposal-rejected", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        proposal: {
          id: "proposal-rejected",
          baseTitle: "旧标题",
          baseMarkdown: "旧正文",
          baseDigest: "",
          title: "新标题",
          markdown: "新正文",
          digest: "",
          summary: "已放弃的修改",
          status: "rejected",
          stats: { oldLines: 1, newLines: 1, changedLines: 1 },
        },
      }),
    })
  );

  await page.goto(`/editor/${articleId}`);
  await page.getByRole("button", { name: "写作助手" }).click();
  await expect(page.getByText("已放弃", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "应用修改" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "放弃" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "全屏审查" })).toBeVisible();
});

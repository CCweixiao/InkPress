import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { Node, Project, SyntaxKind } from "ts-morph";
import { parser as pythonParser } from "@lezer/python";
import { cacheDir } from "@/lib/paths";
import { moduleLogger } from "@/lib/logger";
import type { AgentProjectConfig } from "@/lib/ai/agent-config";

const log = moduleLogger("project-index");
import type {
  CodeRelation,
  ProjectIndex,
  SourceEvidence,
  SymbolEvidence,
} from "@/lib/ai/code-evidence";
import {
  listProjectFiles,
  readProjectFile,
  resolveProjectRoot,
} from "@/lib/ai/project-access";

const INDEX_VERSION = 1;
const MAX_INDEX_FILES = 3_000;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_SYMBOLS = 8_000;
const MAX_EDGES = 12_000;
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function languageFor(file: string) {
  const extension = path.extname(file).toLowerCase();
  if ([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"].includes(extension)) {
    return "typescript";
  }
  if (extension === ".java") return "java";
  if (extension === ".py") return "python";
  if (extension === ".go") return "go";
  if (extension === ".rs") return "rust";
  if ([".c", ".h"].includes(extension)) return "c";
  if ([".cc", ".cpp", ".cxx", ".hpp", ".hh", ".hxx"].includes(extension)) return "cpp";
  return "text";
}

function lineAt(text: string, offset: number) {
  return text.slice(0, Math.max(0, offset)).split("\n").length;
}

function symbolId(pathname: string, name: string, line: number) {
  return `${pathname}#${name}:${line}`;
}

function evidence(
  pathname: string,
  startLine: number,
  endLine: number,
  summary: string,
  symbol?: string
): SourceEvidence {
  return { path: pathname, startLine, endLine, summary, ...(symbol ? { symbol } : {}) };
}

function nodeLines(node: Node) {
  return {
    startLine: node.getStartLineNumber(),
    endLine: node.getEndLineNumber(),
  };
}

function cachePath(projectId: string) {
  const safe = projectId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(cacheDir(), "code-index", safe, "index.json");
}

async function cleanupOldIndexes() {
  const root = path.join(cacheDir(), "code-index");
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const file = path.join(root, entry.name, "index.json");
        const stat = await fs.stat(file).catch(() => null);
        if (stat && Date.now() - stat.mtimeMs > CACHE_MAX_AGE_MS) {
          await fs.rm(path.dirname(file), { recursive: true, force: true });
        }
      })
  );
}

function addSymbol(
  symbols: SymbolEvidence[],
  item: Omit<SymbolEvidence, "id">
) {
  if (symbols.length >= MAX_SYMBOLS) return;
  symbols.push({
    ...item,
    id: symbolId(item.path, item.name, item.startLine),
  });
}

function addEdge(edges: CodeRelation[], item: CodeRelation) {
  if (edges.length < MAX_EDGES) edges.push(item);
}

function parseTypeScript(
  root: string,
  files: string[],
  symbols: SymbolEvidence[],
  edges: CodeRelation[],
  errors: ProjectIndex["parseErrors"]
) {
  // ts-morph 会把每个 TS 文件装载为常驻 AST。超大项目一次性全部装载会导致内存峰值过高。
  // 分批处理：每批独立 Project，循环结束后即可被 GC，把 AST 驻留约束在单批规模。
  // 代价：跨批次的 call/import 符号解析会降级为 syntactic（符号清单本身仍完整）。
  // 批大小 400：TS 文件数 ≤ 400 的项目（绝大多数）行为与单 Project 完全一致。
  const TS_PARSE_CHUNK = 400;
  const fileSet = new Set(files);
  for (let start = 0; start < files.length; start += TS_PARSE_CHUNK) {
    const batch = files.slice(start, start + TS_PARSE_CHUNK);
    const project = new Project({
      compilerOptions: { allowJs: true, checkJs: false },
      skipAddingFilesFromTsConfig: true,
    });
    try {
      project.addSourceFilesAtPaths(
        batch
          .map((file) => path.join(root, file))
          .filter((file) => !file.endsWith(".d.ts"))
      );
    } catch (error) {
      errors.push({
        path: "tsconfig.json",
        message: error instanceof Error ? error.message : "TypeScript 项目加载失败",
      });
    }

  for (const source of project.getSourceFiles()) {
    const relative = path.relative(root, source.getFilePath()).replaceAll(path.sep, "/");
    if (relative.startsWith("..") || !fileSet.has(relative)) continue;

    for (const declaration of [
      ...source.getFunctions(),
      ...source.getClasses(),
      ...source.getInterfaces(),
      ...source.getTypeAliases(),
      ...source.getEnums(),
    ]) {
      const name = declaration.getName();
      if (!name) continue;
      const lines = nodeLines(declaration);
      addSymbol(symbols, {
        name,
        kind: declaration.getKindName(),
        language: "typescript",
        path: relative,
        ...lines,
      });
      if (Node.isClassDeclaration(declaration)) {
        for (const method of declaration.getMethods()) {
          const methodLines = nodeLines(method);
          addSymbol(symbols, {
            name: method.getName(),
            kind: "Method",
            language: "typescript",
            path: relative,
            container: name,
            ...methodLines,
          });
        }
      }
    }

    for (const declaration of source.getImportDeclarations()) {
      const target = declaration.getModuleSpecifierSourceFile();
      const targetRelative = target
        ? path.relative(root, target.getFilePath()).replaceAll(path.sep, "/")
        : declaration.getModuleSpecifierValue();
      const line = declaration.getStartLineNumber();
      addEdge(edges, {
        from: relative,
        to: targetRelative,
        kind: "imports",
        confidence: target && !targetRelative.startsWith("..") ? "resolved" : "syntactic",
        evidence: evidence(relative, line, line, `导入 ${targetRelative}`),
      });
    }

    for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expression = call.getExpression();
      const caller =
        call.getFirstAncestorByKind(SyntaxKind.MethodDeclaration)?.getName() ??
        call.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration)?.getName() ??
        relative;
      const definitions = expression.getSymbol()?.getDeclarations() ?? [];
      const definition = definitions.find((node: Node) => {
        const file = path.relative(root, node.getSourceFile().getFilePath());
        return !file.startsWith("..");
      });
      const targetName = definition
        ? `${path.relative(root, definition.getSourceFile().getFilePath()).replaceAll(path.sep, "/")}#${expression.getText()}`
        : expression.getText().slice(0, 160);
      const line = call.getStartLineNumber();
      addEdge(edges, {
        from: `${relative}#${caller}`,
        to: targetName,
        kind: "calls",
        confidence: definition ? "resolved" : "syntactic",
        evidence: evidence(relative, line, call.getEndLineNumber(), `调用 ${expression.getText()}`),
      });
    }
  }
  }
}

function parseJavaFile(
  pathname: string,
  text: string,
  symbols: SymbolEvidence[],
  edges: CodeRelation[],
  errors: ProjectIndex["parseErrors"]
) {
  const lines = text.split("\n");
  let container = "";
  lines.forEach((lineText, index) => {
    const line = index + 1;
    const type = lineText.match(/\b(class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/);
    if (type) {
      container = type[2];
      addSymbol(symbols, {
        name: container,
        kind: type[1],
        language: "java",
        path: pathname,
        startLine: line,
        endLine: line,
      });
    }
    const method = lineText.match(
      /(?:public|protected|private|static|final|synchronized|abstract|native|\s)+[\w<>\[\], ?]+\s+([A-Za-z_$][\w$]*)\s*\([^;]*\)\s*(?:throws [^{]+)?\{?\s*$/
    );
    if (method && !["if", "for", "while", "switch", "catch"].includes(method[1])) {
      addSymbol(symbols, {
        name: method[1],
        kind: "Method",
        language: "java",
        path: pathname,
        startLine: line,
        endLine: line,
        ...(container ? { container } : {}),
      });
    }
    const imported = lineText.match(/^\s*import\s+(?:static\s+)?([^;]+);/);
    if (imported) {
      addEdge(edges, {
        from: pathname,
        to: imported[1],
        kind: "imports",
        confidence: "syntactic",
        evidence: evidence(pathname, line, line, `导入 ${imported[1]}`),
      });
    }
    for (const match of lineText.matchAll(/\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/g)) {
      const name = match[1];
      if (["if", "for", "while", "switch", "catch", "return", "new", "super", "this"].includes(name)) continue;
      addEdge(edges, {
        from: `${pathname}#${container || "file"}`,
        to: name,
        kind: "calls",
        confidence: "syntactic",
        evidence: evidence(pathname, line, line, `调用 ${name}`),
      });
    }
  });
}

async function validateJavaSyntax(
  pathname: string,
  text: string,
  errors: ProjectIndex["parseErrors"]
) {
  try {
    const mod = await import("java-parser");
    mod.parse(text);
  } catch (error) {
    errors.push({
      path: pathname,
      message: error instanceof Error ? error.message : "Java 解析失败",
    });
  }
}

function parsePythonFile(
  pathname: string,
  text: string,
  symbols: SymbolEvidence[],
  edges: CodeRelation[],
  errors: ProjectIndex["parseErrors"]
) {
  const tree = pythonParser.parse(text);
  if (tree.type.isError || tree.topNode.toString().includes("⚠")) {
    errors.push({ path: pathname, message: "Python 语法树包含错误节点" });
  }
  const lines = text.split("\n");
  const containers: Array<{ indent: number; name: string }> = [];
  lines.forEach((lineText, index) => {
    const line = index + 1;
    const indent = lineText.match(/^\s*/)?.[0].replaceAll("\t", "    ").length ?? 0;
    while (containers.length && containers.at(-1)!.indent >= indent && lineText.trim()) {
      containers.pop();
    }
    const declaration = lineText.match(/^\s*(async\s+)?(def|class)\s+([A-Za-z_][\w]*)/);
    if (declaration) {
      const name = declaration[3];
      addSymbol(symbols, {
        name,
        kind: declaration[2] === "class" ? "Class" : "Function",
        language: "python",
        path: pathname,
        startLine: line,
        endLine: line,
        ...(containers.length ? { container: containers.at(-1)!.name } : {}),
      });
      containers.push({ indent, name });
    }
    const imported = lineText.match(/^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/);
    if (imported) {
      const target = imported[1] ?? imported[2];
      addEdge(edges, {
        from: pathname,
        to: target,
        kind: "imports",
        confidence: "syntactic",
        evidence: evidence(pathname, line, line, `导入 ${target}`),
      });
    }
    for (const match of lineText.matchAll(/\b([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*)\s*\(/g)) {
      const name = match[1];
      if (["if", "for", "while", "def", "class", "with", "return"].includes(name)) continue;
      addEdge(edges, {
        from: `${pathname}#${containers.at(-1)?.name ?? "module"}`,
        to: name,
        kind: "calls",
        confidence: "syntactic",
        evidence: evidence(pathname, line, line, `调用 ${name}`),
      });
    }
  });
}

function parseGoFile(
  pathname: string,
  text: string,
  symbols: SymbolEvidence[],
  edges: CodeRelation[]
) {
  let inImportBlock = false;
  text.split("\n").forEach((lineText, index) => {
    const line = index + 1;
    const type = lineText.match(/\b(type)\s+([A-Za-z_]\w*)\s+(struct|interface)\b/);
    if (type) {
      addSymbol(symbols, {
        name: type[2],
        kind: type[3] === "struct" ? "Struct" : "Interface",
        language: "go",
        path: pathname,
        startLine: line,
        endLine: line,
      });
    }
    const fn = lineText.match(/\bfunc\s+(?:\([^)]+\)\s*)?([A-Za-z_]\w*)\s*\(/);
    if (fn) {
      addSymbol(symbols, {
        name: fn[1],
        kind: "Function",
        language: "go",
        path: pathname,
        startLine: line,
        endLine: line,
      });
    }
    if (/^\s*import\s*\(/.test(lineText)) inImportBlock = true;
    const singleImport = lineText.match(/^\s*import\s+(?:[.\w]+\s+)?["`]([^"`]+)["`]/);
    const blockImport = inImportBlock
      ? lineText.match(/^\s*(?:[.\w]+\s+)?["`]([^"`]+)["`]/)
      : null;
    const imported = singleImport?.[1] ?? blockImport?.[1];
    if (imported) {
      addEdge(edges, {
        from: pathname,
        to: imported,
        kind: "imports",
        confidence: "syntactic",
        evidence: evidence(pathname, line, line, `导入 ${imported}`),
      });
    }
    if (inImportBlock && lineText.includes(")")) inImportBlock = false;
  });
}

function parseRustFile(
  pathname: string,
  text: string,
  symbols: SymbolEvidence[],
  edges: CodeRelation[]
) {
  text.split("\n").forEach((lineText, index) => {
    const line = index + 1;
    const declaration = lineText.match(/\b(?:pub\s+)?(fn|struct|enum|trait|impl)\s+([A-Za-z_]\w*)/);
    if (declaration) {
      addSymbol(symbols, {
        name: declaration[2],
        kind: declaration[1] === "fn" ? "Function" : declaration[1],
        language: "rust",
        path: pathname,
        startLine: line,
        endLine: line,
      });
    }
    const imported = lineText.match(/^\s*(?:pub\s+)?(?:use|mod)\s+([^;{]+)[;{]/);
    if (imported) {
      addEdge(edges, {
        from: pathname,
        to: imported[1].trim(),
        kind: "imports",
        confidence: "syntactic",
        evidence: evidence(pathname, line, line, `导入 ${imported[1].trim()}`),
      });
    }
  });
}

function parseCStyleFile(
  pathname: string,
  text: string,
  language: "c" | "cpp",
  symbols: SymbolEvidence[],
  edges: CodeRelation[]
) {
  text.split("\n").forEach((lineText, index) => {
    const line = index + 1;
    const type = lineText.match(/\b(class|struct|enum)\s+([A-Za-z_]\w*)/);
    if (type) {
      addSymbol(symbols, {
        name: type[2],
        kind: type[1],
        language,
        path: pathname,
        startLine: line,
        endLine: line,
      });
    }
    const fn = lineText.match(/^\s*(?:[\w:*&<>\[\]\s]+)\s+([A-Za-z_]\w*(?:::[A-Za-z_]\w*)?)\s*\([^;]*\)\s*(?:const\s*)?\{/);
    if (fn && !["if", "for", "while", "switch"].includes(fn[1])) {
      addSymbol(symbols, {
        name: fn[1],
        kind: "Function",
        language,
        path: pathname,
        startLine: line,
        endLine: line,
      });
    }
    const included = lineText.match(/^\s*#\s*include\s+[<"]([^>"]+)[>"]/);
    if (included) {
      addEdge(edges, {
        from: pathname,
        to: included[1],
        kind: "imports",
        confidence: "syntactic",
        evidence: evidence(pathname, line, line, `包含 ${included[1]}`),
      });
    }
  });
}

export async function buildProjectIndex(project: AgentProjectConfig): Promise<ProjectIndex> {
  const root = await resolveProjectRoot(project);
  const listed = await listProjectFiles(project, { limit: MAX_INDEX_FILES });
  const sourceFiles = listed.files.filter((file) => languageFor(file) !== "text");
  const files: ProjectIndex["files"] = [];
  const parseErrors: ProjectIndex["parseErrors"] = [];

  // 第一遍只 stat，不读正文：snapshot 基于 (path,size,mtime)，与 getProjectSnapshotHash 同公式。
  // 不再为计算哈希而读取全部源码——超大项目缓存命中时省去整轮文件读，I/O 从 O(N reads) 降到 O(N stats)。
  const fingerprintParts: string[] = [];
  for (const relative of sourceFiles) {
    const absolute = path.join(root, relative);
    const stat = await fs.stat(absolute).catch(() => null);
    if (!stat?.isFile() || stat.size > MAX_FILE_BYTES) continue;
    files.push({
      path: relative,
      language: languageFor(relative),
      hash: "",
      size: stat.size,
    });
    fingerprintParts.push(`${relative}:${stat.size}:${stat.mtimeMs}`);
  }

  const snapshotHash = crypto
    .createHash("sha256")
    .update(fingerprintParts.sort().join("\n"))
    .digest("hex");
  const symbols: SymbolEvidence[] = [];
  const edges: CodeRelation[] = [];
  // TypeScript 由 ts-morph 自行从磁盘读取并构建 AST，无需我们持有正文。
  parseTypeScript(
    root,
    files.filter((file) => file.language === "typescript").map((file) => file.path),
    symbols,
    edges,
    parseErrors
  );

  // 非 TS：流式按需读取——每个文件读完即解析即释放，不再用 contents Map 常驻全部正文。
  // 内存峰值从「全部源码正文 + ts-morph 全部 AST」收敛到「单文件正文 + ts-morph 单批 AST」。
  let skippedUnreadable = 0;
  for (const file of files) {
    if (file.language === "typescript") continue;
    const absolute = path.join(root, file.path);
    let text: string;
    try {
      const buffer = await fs.readFile(absolute);
      // 二进制文件（含 NUL 字节）跳过：文本解析器无法处理，且会污染符号表。
      if (buffer.includes(0)) {
        skippedUnreadable++;
        continue;
      }
      text = buffer.toString("utf8");
    } catch (error) {
      // 单文件读取失败（权限拒绝、坏符号链接、特殊文件）只跳过该文件，
      // 不让超大项目里一个不可读文件触发整次 failed → 1h 冷却。
      skippedUnreadable++;
      parseErrors.push({
        path: file.path,
        message: `读取失败：${error instanceof Error ? error.message.split("\n")[0] : "未知错误"}`,
      });
      continue;
    }
    if (file.language === "java") {
      await validateJavaSyntax(file.path, text, parseErrors);
      parseJavaFile(file.path, text, symbols, edges, parseErrors);
    } else if (file.language === "python") {
      parsePythonFile(file.path, text, symbols, edges, parseErrors);
    } else if (file.language === "go") {
      parseGoFile(file.path, text, symbols, edges);
    } else if (file.language === "rust") {
      parseRustFile(file.path, text, symbols, edges);
    } else if (file.language === "c" || file.language === "cpp") {
      parseCStyleFile(file.path, text, file.language, symbols, edges);
    }
  }
  if (skippedUnreadable > 0) {
    log.warn(
      { projectId: project.id, skippedUnreadable, totalCandidates: sourceFiles.length },
      "buildProjectIndex: 跳过部分不可读/二进制文件，继续对剩余文件建立索引"
    );
  }

  const now = new Date().toISOString();
  const index: ProjectIndex = {
    version: INDEX_VERSION,
    projectId: project.id,
    root,
    snapshotHash,
    generatedAt: now,
    accessedAt: now,
    files,
    symbols,
    edges,
    parseErrors,
    truncated:
      listed.truncated ||
      symbols.length >= MAX_SYMBOLS ||
      edges.length >= MAX_EDGES,
  };
  if (files.length === 0) {
    // 空文件列表 → symbols/edges 必然全空，且 snapshotHash=SHA256("") 会与后续校验自洽，
    // 造成"空索引永久锁定"。这里跳过缓存写入，让下次调用强制重建。
    log.warn(
      { projectId: project.id, root, parseErrors: parseErrors.length },
      "buildProjectIndex: 源文件列表为空，跳过缓存写入以避免空索引锁定"
    );
  } else {
    const target = cachePath(project.id);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, JSON.stringify(index), "utf8");
    void cleanupOldIndexes();
  }
  return index;
}

export async function getProjectIndex(
  project: AgentProjectConfig,
  options: { refresh?: boolean } = {}
) {
  const currentSnapshotHash = await getProjectSnapshotHash(project);
  // 默认优先用原生图谱（零 Python 依赖）；失败再试 graphify CLI；仍失败则走纯索引构建。
  const { ensureCodeGraphCache } = await import("@/lib/ai/code-graph-provider");
  const nativeIndex = await ensureCodeGraphCache({
    project,
    snapshotHash: currentSnapshotHash,
    options: { refresh: options.refresh, provider: "native" },
  });
  if (nativeIndex) return nativeIndex;

  const graphIndex = await ensureCodeGraphCache({
    project,
    snapshotHash: currentSnapshotHash,
    options: { refresh: options.refresh, provider: "graphify" },
  });
  if (graphIndex) return graphIndex;

  if (!options.refresh) {
    const cached = await fs.readFile(cachePath(project.id), "utf8").catch(() => "");
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as ProjectIndex;
        if (
          parsed.version === INDEX_VERSION &&
          parsed.root === (await resolveProjectRoot(project)) &&
          parsed.snapshotHash === currentSnapshotHash &&
          (parsed.files?.length ?? 0) > 0
        ) {
          parsed.accessedAt = new Date().toISOString();
          await fs.writeFile(cachePath(project.id), JSON.stringify(parsed), "utf8");
          return parsed;
        }
      } catch {
        // Rebuild invalid cache.
      }
    }
  }
  return buildProjectIndex(project);
}

export async function getProjectSnapshotHash(project: AgentProjectConfig) {
  const root = await resolveProjectRoot(project);
  const listed = await listProjectFiles(project, { limit: MAX_INDEX_FILES });
  // 基于 (path,size,mtime) 计算快照指纹，只 stat 不读正文。
  // 这是缓存命中判定时每次探索都会走的路径——避免读取全部源码，把超大项目的
  // 「即使命中缓存也要全量读文件」降为纯 stat。与 buildProjectIndex 内部使用同一公式。
  const fingerprints: string[] = [];
  for (const relative of listed.files.filter((file) => languageFor(file) !== "text")) {
    const absolute = path.join(root, relative);
    const stat = await fs.stat(absolute).catch(() => null);
    if (!stat?.isFile() || stat.size > MAX_FILE_BYTES) continue;
    fingerprints.push(`${relative}:${stat.size}:${stat.mtimeMs}`);
  }
  return crypto.createHash("sha256").update(fingerprints.sort().join("\n")).digest("hex");
}

export async function getCachedProjectIndex(project: AgentProjectConfig) {
  const cached = await fs.readFile(cachePath(project.id), "utf8").catch(() => "");
  if (!cached) return null;
  try {
    const parsed = JSON.parse(cached) as ProjectIndex;
    const root = await resolveProjectRoot(project);
    return parsed.version === INDEX_VERSION && parsed.root === root ? parsed : null;
  } catch {
    return null;
  }
}

export async function queryProjectSymbols(
  project: AgentProjectConfig,
  input: { query?: string; kind?: string; limit?: number }
) {
  const index = await getProjectIndex(project);
  const query = input.query?.toLowerCase() ?? "";
  const kind = input.kind?.toLowerCase() ?? "";
  const limit = Math.min(200, Math.max(1, input.limit ?? 50));
  const symbols = index.symbols.filter(
    (symbol) =>
      (!query ||
        symbol.name.toLowerCase().includes(query) ||
        symbol.path.toLowerCase().includes(query)) &&
      (!kind || symbol.kind.toLowerCase().includes(kind))
  );
  return {
    snapshotHash: index.snapshotHash,
    symbols: symbols.slice(0, limit),
    truncated: symbols.length > limit,
  };
}

export async function queryProjectReferences(
  project: AgentProjectConfig,
  input: { symbol: string; limit?: number }
) {
  const index = await getProjectIndex(project);
  const query = input.symbol.toLowerCase();
  const limit = Math.min(200, Math.max(1, input.limit ?? 80));
  const edges = index.edges.filter(
    (edge) =>
      edge.from.toLowerCase().includes(query) ||
      edge.to.toLowerCase().includes(query)
  );
  return {
    snapshotHash: index.snapshotHash,
    edges: edges.slice(0, limit),
    truncated: edges.length > limit,
  };
}

export async function projectDependencyGraph(
  project: AgentProjectConfig,
  input: { pathPrefix?: string; limit?: number } = {}
) {
  const index = await getProjectIndex(project);
  const prefix = input.pathPrefix?.replaceAll("\\", "/") ?? "";
  const limit = Math.min(500, Math.max(1, input.limit ?? 200));
  const edges = index.edges.filter(
    (edge) =>
      edge.kind === "imports" &&
      (!prefix || edge.from.startsWith(prefix) || edge.to.startsWith(prefix))
  );
  return {
    snapshotHash: index.snapshotHash,
    edges: edges.slice(0, limit),
    truncated: edges.length > limit,
  };
}

export async function projectCallHierarchy(
  project: AgentProjectConfig,
  input: { symbol: string; direction?: "incoming" | "outgoing"; depth?: number; limit?: number }
) {
  const index = await getProjectIndex(project);
  const depth = Math.min(6, Math.max(1, input.depth ?? 3));
  const limit = Math.min(300, Math.max(1, input.limit ?? 120));
  const direction = input.direction ?? "outgoing";
  const seen = new Set<string>([input.symbol]);
  let frontier = [input.symbol];
  const edges: CodeRelation[] = [];
  for (let level = 0; level < depth && frontier.length && edges.length < limit; level++) {
    const next: string[] = [];
    for (const current of frontier) {
      const matches = index.edges.filter(
        (edge) =>
          edge.kind === "calls" &&
          (direction === "outgoing"
            ? edge.from.toLowerCase().includes(current.toLowerCase())
            : edge.to.toLowerCase().includes(current.toLowerCase()))
      );
      for (const edge of matches) {
        edges.push(edge);
        const node = direction === "outgoing" ? edge.to : edge.from;
        if (!seen.has(node)) {
          seen.add(node);
          next.push(node);
        }
        if (edges.length >= limit) break;
      }
    }
    frontier = next;
  }
  return {
    snapshotHash: index.snapshotHash,
    edges,
    truncated: edges.length >= limit,
  };
}

export async function readEvidenceSource(
  project: AgentProjectConfig,
  source: SourceEvidence
) {
  return readProjectFile(project, {
    path: source.path,
    startLine: source.startLine,
    endLine: source.endLine,
  });
}

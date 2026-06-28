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
  ProjectEdgeIndex,
  ProjectIndex,
  ProjectLanguageStat,
  SourceEvidence,
  SymbolEvidence,
} from "@/lib/ai/code-evidence";
import {
  listProjectFiles,
  readProjectFile,
  resolveProjectRoot,
} from "@/lib/ai/project-access";
import { buildFunctionalModules, modulesFromIndex } from "@/lib/ai/code-graph-analysis";

const INDEX_VERSION = 1;
const MAX_INDEX_FILES = 50_000;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_SYMBOLS = 80_000;
const MAX_EDGES = 120_000;
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const SNAPSHOT_CACHE_TTL_MS = 5_000;
const INDEX_BUILD_TIME_BUDGET_MS = 45_000;

const snapshotCache = new Map<string, { hash: string; expiresAt: number }>();

function yieldToEventLoop() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

export type ProjectIndexBuildMode = "fast" | "deep";

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
  if (extension === ".cs") return "csharp";
  if ([".kt", ".kts"].includes(extension)) return "kotlin";
  if (extension === ".swift") return "swift";
  if (extension === ".php") return "php";
  if (extension === ".rb") return "ruby";
  if (extension === ".scala") return "scala";
  if (extension === ".lua") return "lua";
  if ([".sh", ".bash", ".zsh"].includes(extension)) return "shell";
  if (extension === ".sql") return "sql";
  if (extension === ".dart") return "dart";
  if ([".vue", ".svelte", ".astro"].includes(extension)) return "component";
  return "text";
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

function resolveRelativeImport(
  fromFile: string,
  specifier: string,
  fileSet: Set<string>
) {
  if (!specifier.startsWith(".")) return specifier;
  const fromDir = path.posix.dirname(fromFile);
  const base = path.posix.normalize(path.posix.join(fromDir, specifier));
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mts`,
    `${base}.cts`,
    path.posix.join(base, "index.ts"),
    path.posix.join(base, "index.tsx"),
    path.posix.join(base, "index.js"),
    path.posix.join(base, "index.jsx"),
  ];
  return candidates.find((candidate) => fileSet.has(candidate)) ?? specifier;
}

async function parseTypeScript(
  root: string,
  files: string[],
  symbols: SymbolEvidence[],
  edges: CodeRelation[],
  errors: ProjectIndex["parseErrors"],
  options: { mode: ProjectIndexBuildMode; deadlineMs?: number }
) {
  // ts-morph 会把每个 TS 文件装载为常驻 AST。超大项目一次性全部装载会导致内存峰值过高。
  // 分批处理：每批独立 Project，循环结束后即可被 GC，把 AST 驻留约束在单批规模。
  // 代价：跨批次的 call/import 符号解析会降级为 syntactic（符号清单本身仍完整）。
  // 批大小 400：TS 文件数 ≤ 400 的项目（绝大多数）行为与单 Project 完全一致。
  const TS_PARSE_CHUNK = 400;
  const fileSet = new Set(files);
  for (let start = 0; start < files.length; start += TS_PARSE_CHUNK) {
    if (options.deadlineMs && Date.now() > options.deadlineMs) break;
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
    if (options.deadlineMs && Date.now() > options.deadlineMs) break;
    if (symbols.length >= MAX_SYMBOLS && edges.length >= MAX_EDGES) break;
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
      const specifier = declaration.getModuleSpecifierValue();
      const target =
        options.mode === "deep" ? declaration.getModuleSpecifierSourceFile() : null;
      const targetRelative = target
        ? path.relative(root, target.getFilePath()).replaceAll(path.sep, "/")
        : resolveRelativeImport(relative, specifier, fileSet);
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
      const definition =
        options.mode === "deep"
          ? (expression.getSymbol()?.getDeclarations() ?? []).find((node: Node) => {
              const file = path.relative(root, node.getSourceFile().getFilePath());
              return !file.startsWith("..");
            })
          : null;
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
  await yieldToEventLoop();
  }
}

function parseJavaFile(
  pathname: string,
  text: string,
  symbols: SymbolEvidence[],
  edges: CodeRelation[],
  _errors: ProjectIndex["parseErrors"]
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

const CALL_STOPWORDS = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "return",
  "new",
  "super",
  "this",
  "typeof",
  "sizeof",
  "echo",
  "print",
]);

function parseGenericFile(
  pathname: string,
  text: string,
  language: string,
  symbols: SymbolEvidence[],
  edges: CodeRelation[]
) {
  text.split("\n").forEach((lineText, index) => {
    const line = index + 1;
    const declarations = [
      lineText.match(/\b(?:class|interface|enum|record|struct|trait|object)\s+([A-Za-z_$][\w$]*)/),
      lineText.match(/\b(?:function|fun|func|def|fn|sub|proc)\s+([A-Za-z_$][\w$]*)\s*\(/),
      lineText.match(/^\s*([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/),
      lineText.match(/^\s*([A-Za-z_$][\w$]*)\s*:\s*(?:procedure|function)\b/i),
      language === "sql"
        ? lineText.match(/\b(?:table|view|procedure|function|trigger)\s+(?:if\s+not\s+exists\s+)?["`[]?([A-Za-z_][\w.]*)/i)
        : null,
    ].filter(Boolean) as RegExpMatchArray[];
    for (const declaration of declarations) {
      addSymbol(symbols, {
        name: declaration[1],
        kind: language === "sql" ? "SqlObject" : "Symbol",
        language,
        path: pathname,
        startLine: line,
        endLine: line,
      });
    }

    const imports = [
      lineText.match(/^\s*(?:import|require|include|using|use|from)\s+["']?([^"';]+)["']?/),
      lineText.match(/^\s*#\s*include\s+[<"]([^>"]+)[>"]/),
      lineText.match(/^\s*source\s+["']?([^"']+)["']?/),
    ].filter(Boolean) as RegExpMatchArray[];
    for (const imported of imports) {
      const target = imported[1].trim();
      if (!target) continue;
      addEdge(edges, {
        from: pathname,
        to: target,
        kind: "imports",
        confidence: "syntactic",
        evidence: evidence(pathname, line, line, `导入 ${target}`),
      });
    }

    if (language === "sql") return;
    for (const match of lineText.matchAll(/\b([A-Za-z_$][\w$]*(?:[.:][A-Za-z_$][\w$]*)*)\s*\(/g)) {
      const name = match[1];
      if (CALL_STOPWORDS.has(name.toLowerCase())) continue;
      addEdge(edges, {
        from: `${pathname}#file`,
        to: name.slice(0, 160),
        kind: "calls",
        confidence: "syntactic",
        evidence: evidence(pathname, line, line, `调用 ${name}`),
      });
    }
  });
}

function languageStats(files: ProjectIndex["files"]): ProjectLanguageStat[] {
  const stats = new Map<string, { files: number; bytes: number }>();
  for (const file of files) {
    const current = stats.get(file.language) ?? { files: 0, bytes: 0 };
    current.files += 1;
    current.bytes += file.size;
    stats.set(file.language, current);
  }
  return [...stats.entries()]
    .sort((a, b) => b[1].files - a[1].files || a[0].localeCompare(b[0]))
    .map(([language, stat]) => ({ language, ...stat }));
}

function addIndexEntry(target: Record<string, number[]>, key: string, edgeIndex: number) {
  const normalized = key.toLowerCase();
  if (!normalized) return;
  const list = target[normalized] ?? [];
  list.push(edgeIndex);
  target[normalized] = list;
}

export function buildProjectEdgeIndex(edges: CodeRelation[]): ProjectEdgeIndex {
  const index: ProjectEdgeIndex = {
    callsByFrom: {},
    callsByTo: {},
    importsByFrom: {},
    importsByTo: {},
    edgesByPath: {},
  };
  edges.forEach((edge, edgeIndex) => {
    addIndexEntry(index.edgesByPath, edge.evidence.path, edgeIndex);
    if (edge.kind === "calls") {
      addIndexEntry(index.callsByFrom, edge.from, edgeIndex);
      addIndexEntry(index.callsByTo, edge.to, edgeIndex);
    } else if (edge.kind === "imports") {
      addIndexEntry(index.importsByFrom, edge.from, edgeIndex);
      addIndexEntry(index.importsByTo, edge.to, edgeIndex);
    }
  });
  return index;
}

function getEdgeIndex(index: ProjectIndex) {
  return index.edgeIndex ?? buildProjectEdgeIndex(index.edges);
}

export function hydrateProjectIndex(
  index: ProjectIndex,
  options: { mode?: ProjectIndexBuildMode } = {}
) {
  index.modules = index.modules?.length ? index.modules : buildFunctionalModules(index);
  index.edgeIndex = index.edgeIndex ?? buildProjectEdgeIndex(index.edges);
  index.languageStats = index.languageStats ?? languageStats(index.files);
  index.buildMode = index.buildMode ?? options.mode ?? "fast";
  return index;
}

function candidateEdgeNumbers(
  lookup: Record<string, number[]>,
  query: string,
  fallbackEdges: CodeRelation[],
  predicate: (edge: CodeRelation) => boolean
) {
  const lower = query.toLowerCase();
  const exact = lookup[lower];
  if (exact) return exact;
  const numbers: number[] = [];
  for (const [key, value] of Object.entries(lookup)) {
    if (key.includes(lower)) numbers.push(...value);
  }
  if (numbers.length > 0) return numbers;
  return fallbackEdges.flatMap((edge, edgeIndex) => (predicate(edge) ? [edgeIndex] : []));
}

function candidateEdgeNumbersFromLookups(
  lookups: Array<Record<string, number[]>>,
  query: string,
  fallbackEdges: CodeRelation[],
  predicate: (edge: CodeRelation) => boolean
) {
  const result = new Set<number>();
  for (const lookup of lookups) {
    for (const edgeNumber of candidateEdgeNumbers(lookup, query, [], () => false)) {
      result.add(edgeNumber);
    }
  }
  if (result.size > 0) return [...result];
  return fallbackEdges.flatMap((edge, edgeIndex) => (predicate(edge) ? [edgeIndex] : []));
}

export async function buildProjectIndex(
  project: AgentProjectConfig,
  options: { mode?: ProjectIndexBuildMode; persist?: boolean } = {}
): Promise<ProjectIndex> {
  const mode = options.mode ?? "fast";
  const persist = options.persist ?? true;
  const deadlineMs = Date.now() + INDEX_BUILD_TIME_BUDGET_MS;
  const root = await resolveProjectRoot(project);
  const listed = await listProjectFiles(project, { limit: MAX_INDEX_FILES });
  const sourceFiles = listed.files.filter((file) => languageFor(file) !== "text");
  const files: ProjectIndex["files"] = [];
  const parseErrors: ProjectIndex["parseErrors"] = [];
  let stoppedByBudget = false;

  // 第一遍只 stat，不读正文：snapshot 基于 (path,size,mtime)，与 getProjectSnapshotHash 同公式。
  // 不再为计算哈希而读取全部源码——超大项目缓存命中时省去整轮文件读，I/O 从 O(N reads) 降到 O(N stats)。
  const fingerprintParts: string[] = [];
  for (let index = 0; index < sourceFiles.length; index++) {
    if (Date.now() > deadlineMs) {
      stoppedByBudget = true;
      break;
    }
    const relative = sourceFiles[index];
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
    if (index > 0 && index % 500 === 0) await yieldToEventLoop();
  }

  const snapshotHash = crypto
    .createHash("sha256")
    .update(fingerprintParts.sort().join("\n"))
    .digest("hex");
  const symbols: SymbolEvidence[] = [];
  const edges: CodeRelation[] = [];
  // TypeScript 由 ts-morph 自行从磁盘读取并构建 AST，无需我们持有正文。
  await parseTypeScript(
    root,
    files.filter((file) => file.language === "typescript").map((file) => file.path),
    symbols,
    edges,
    parseErrors,
    { mode, deadlineMs }
  );
  stoppedByBudget = stoppedByBudget || Date.now() > deadlineMs;

  // 非 TS：流式按需读取——每个文件读完即解析即释放，不再用 contents Map 常驻全部正文。
  // 内存峰值从「全部源码正文 + ts-morph 全部 AST」收敛到「单文件正文 + ts-morph 单批 AST」。
  let skippedUnreadable = 0;
  for (let index = 0; index < files.length; index++) {
    if (Date.now() > deadlineMs) {
      stoppedByBudget = true;
      break;
    }
    if (symbols.length >= MAX_SYMBOLS && edges.length >= MAX_EDGES) break;
    const file = files[index];
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
      if (mode === "deep") {
        await validateJavaSyntax(file.path, text, parseErrors);
      }
      parseJavaFile(file.path, text, symbols, edges, parseErrors);
    } else if (file.language === "python") {
      parsePythonFile(file.path, text, symbols, edges, parseErrors);
    } else if (file.language === "go") {
      parseGoFile(file.path, text, symbols, edges);
    } else if (file.language === "rust") {
      parseRustFile(file.path, text, symbols, edges);
    } else if (file.language === "c" || file.language === "cpp") {
      parseCStyleFile(file.path, text, file.language, symbols, edges);
    } else {
      parseGenericFile(file.path, text, file.language, symbols, edges);
    }
    if (index > 0 && index % 100 === 0) await yieldToEventLoop();
  }
  if (stoppedByBudget) {
    parseErrors.push({
      path: "(project)",
      message: `索引构建达到 ${Math.round(INDEX_BUILD_TIME_BUDGET_MS / 1000)} 秒安全预算，已停止继续递归。`,
    });
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
    modules: [],
    languageStats: languageStats(files),
    edgeIndex: buildProjectEdgeIndex(edges),
    buildMode: mode,
    truncated:
      listed.truncated ||
      stoppedByBudget ||
      symbols.length >= MAX_SYMBOLS ||
      edges.length >= MAX_EDGES,
  };
  hydrateProjectIndex(index, { mode });
  if (files.length === 0) {
    // 空文件列表 → symbols/edges 必然全空，且 snapshotHash=SHA256("") 会与后续校验自洽，
    // 造成"空索引永久锁定"。这里跳过缓存写入，让下次调用强制重建。
    log.warn(
      { projectId: project.id, root, parseErrors: parseErrors.length },
      "buildProjectIndex: 源文件列表为空，跳过缓存写入以避免空索引锁定"
    );
  } else if (persist) {
    const target = cachePath(project.id);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, JSON.stringify(index), "utf8");
    void cleanupOldIndexes();
  }
  return index;
}

export async function getProjectIndex(
  project: AgentProjectConfig,
  options: { refresh?: boolean; mode?: ProjectIndexBuildMode } = {}
) {
  const mode = options.mode ?? "fast";
  const currentSnapshotHash = await getProjectSnapshotHash(project);
  // 默认优先用原生图谱（零 Python 依赖）；失败再试 graphify CLI；仍失败则走纯索引构建。
  const { ensureCodeGraphCache } = await import("@/lib/ai/code-graph-provider");
  const nativeIndex = await ensureCodeGraphCache({
    project,
    snapshotHash: currentSnapshotHash,
    options: { refresh: options.refresh, provider: "native", mode },
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
          (parsed.files?.length ?? 0) > 0 &&
          (parsed.buildMode ?? "fast") === mode
        ) {
          parsed.accessedAt = new Date().toISOString();
          hydrateProjectIndex(parsed, { mode });
          await fs.writeFile(cachePath(project.id), JSON.stringify(parsed), "utf8");
          return parsed;
        }
      } catch {
        // Rebuild invalid cache.
      }
    }
  }
  return buildProjectIndex(project, { mode });
}

export async function getProjectSnapshotHash(project: AgentProjectConfig) {
  const root = await resolveProjectRoot(project);
  const cacheKey = `${project.id}:${root}`;
  const cached = snapshotCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.hash;

  const listed = await listProjectFiles(project, { limit: MAX_INDEX_FILES });
  // 基于 (path,size,mtime) 计算快照指纹，只 stat 不读正文。
  // 这是缓存命中判定时每次探索都会走的路径——避免读取全部源码，把超大项目的
  // 「即使命中缓存也要全量读文件」降为纯 stat。与 buildProjectIndex 内部使用同一公式。
  const fingerprints: string[] = [];
  const sourceFiles = listed.files.filter((file) => languageFor(file) !== "text");
  for (let index = 0; index < sourceFiles.length; index++) {
    const relative = sourceFiles[index];
    const absolute = path.join(root, relative);
    const stat = await fs.stat(absolute).catch(() => null);
    if (!stat?.isFile() || stat.size > MAX_FILE_BYTES) continue;
    fingerprints.push(`${relative}:${stat.size}:${stat.mtimeMs}`);
    if (index > 0 && index % 500 === 0) await yieldToEventLoop();
  }
  const hash = crypto.createHash("sha256").update(fingerprints.sort().join("\n")).digest("hex");
  snapshotCache.set(cacheKey, { hash, expiresAt: Date.now() + SNAPSHOT_CACHE_TTL_MS });
  return hash;
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
  input: {
    query?: string;
    kind?: string;
    language?: string;
    pathPrefix?: string;
    container?: string;
    limit?: number;
    offset?: number;
  }
) {
  const index = await getProjectIndex(project);
  const query = input.query?.toLowerCase() ?? "";
  const kind = input.kind?.toLowerCase() ?? "";
  const language = input.language?.toLowerCase() ?? "";
  const pathPrefix = input.pathPrefix?.replaceAll("\\", "/").toLowerCase() ?? "";
  const container = input.container?.toLowerCase() ?? "";
  const limit = Math.min(500, Math.max(1, input.limit ?? 80));
  const offset = Math.max(0, input.offset ?? 0);
  const symbols = index.symbols
    .filter(
      (symbol) =>
        (!query ||
          symbol.name.toLowerCase().includes(query) ||
          symbol.path.toLowerCase().includes(query) ||
          (symbol.container ?? "").toLowerCase().includes(query)) &&
        (!kind || symbol.kind.toLowerCase().includes(kind)) &&
        (!language || symbol.language.toLowerCase() === language) &&
        (!pathPrefix || symbol.path.toLowerCase().startsWith(pathPrefix)) &&
        (!container || (symbol.container ?? "").toLowerCase().includes(container))
    )
    .sort(
      (a, b) =>
        a.path.localeCompare(b.path) ||
        a.startLine - b.startLine ||
        a.name.localeCompare(b.name)
    );
  const page = symbols.slice(offset, offset + limit);
  return {
    snapshotHash: index.snapshotHash,
    total: symbols.length,
    offset,
    limit,
    nextOffset: offset + page.length < symbols.length ? offset + page.length : null,
    symbols: page,
    truncated: offset + page.length < symbols.length,
  };
}

export async function queryProjectReferences(
  project: AgentProjectConfig,
  input: { symbol: string; kind?: CodeRelation["kind"]; limit?: number; offset?: number }
) {
  const index = await getProjectIndex(project);
  const query = input.symbol.toLowerCase();
  const kind = input.kind;
  const limit = Math.min(500, Math.max(1, input.limit ?? 120));
  const offset = Math.max(0, input.offset ?? 0);
  const edgeIndex = getEdgeIndex(index);
  const numbers = candidateEdgeNumbersFromLookups(
    [
      edgeIndex.callsByFrom,
      edgeIndex.callsByTo,
      edgeIndex.importsByFrom,
      edgeIndex.importsByTo,
    ],
    query,
    index.edges,
    (edge) =>
      edge.from.toLowerCase().includes(query) || edge.to.toLowerCase().includes(query)
  );
  const edges = [...new Set(numbers)]
    .map((edgeNumber) => index.edges[edgeNumber])
    .filter((edge): edge is CodeRelation => Boolean(edge))
    .filter((edge) => !kind || edge.kind === kind)
    .sort(
      (a, b) =>
        a.evidence.path.localeCompare(b.evidence.path) ||
        a.evidence.startLine - b.evidence.startLine ||
        a.kind.localeCompare(b.kind)
    );
  const page = edges.slice(offset, offset + limit);
  return {
    snapshotHash: index.snapshotHash,
    total: edges.length,
    offset,
    limit,
    nextOffset: offset + page.length < edges.length ? offset + page.length : null,
    edges: page,
    truncated: offset + page.length < edges.length,
  };
}

export async function projectDependencyGraph(
  project: AgentProjectConfig,
  input: { pathPrefix?: string; limit?: number; offset?: number } = {}
) {
  const index = await getProjectIndex(project);
  const prefix = input.pathPrefix?.replaceAll("\\", "/") ?? "";
  const limit = Math.min(500, Math.max(1, input.limit ?? 200));
  const offset = Math.max(0, input.offset ?? 0);
  const edgeIndex = getEdgeIndex(index);
  const importNumbers = new Set<number>();
  if (!prefix) {
    for (const numbers of Object.values(edgeIndex.importsByFrom)) {
      for (const edgeNumber of numbers) importNumbers.add(edgeNumber);
    }
  } else {
    const lowerPrefix = prefix.toLowerCase();
    for (const [key, numbers] of Object.entries(edgeIndex.importsByFrom)) {
      if (key.startsWith(lowerPrefix)) {
        for (const edgeNumber of numbers) importNumbers.add(edgeNumber);
      }
    }
    for (const [key, numbers] of Object.entries(edgeIndex.importsByTo)) {
      if (key.startsWith(lowerPrefix) || key.includes(lowerPrefix)) {
        for (const edgeNumber of numbers) importNumbers.add(edgeNumber);
      }
    }
  }
  const edges = [...importNumbers]
    .map((edgeNumber) => index.edges[edgeNumber])
    .filter((edge): edge is CodeRelation => Boolean(edge))
    .sort(
      (a, b) =>
        a.evidence.path.localeCompare(b.evidence.path) ||
        a.evidence.startLine - b.evidence.startLine ||
        a.to.localeCompare(b.to)
    );
  const page = edges.slice(offset, offset + limit);
  return {
    snapshotHash: index.snapshotHash,
    total: edges.length,
    offset,
    limit,
    nextOffset: offset + page.length < edges.length ? offset + page.length : null,
    edges: page,
    truncated: offset + page.length < edges.length,
  };
}

export async function queryProjectModules(
  project: AgentProjectConfig,
  input: { query?: string; pathPrefix?: string; limit?: number } = {}
) {
  const index = await getProjectIndex(project);
  const query = input.query?.toLowerCase() ?? "";
  const pathPrefix = input.pathPrefix?.replaceAll("\\", "/") ?? "";
  const limit = Math.min(100, Math.max(1, input.limit ?? 30));
  const modules = modulesFromIndex(index).filter(
    (item) =>
      (!query ||
        item.name.toLowerCase().includes(query) ||
        item.pathPrefix.toLowerCase().includes(query) ||
        item.responsibilities.some((label) => label.toLowerCase().includes(query))) &&
      (!pathPrefix ||
        item.pathPrefix.startsWith(pathPrefix) ||
        item.evidence.some((source) => source.path.startsWith(pathPrefix)))
  );
  return {
    snapshotHash: index.snapshotHash,
    modules: modules.slice(0, limit),
    truncated: modules.length > limit,
  };
}

export async function projectCallHierarchy(
  project: AgentProjectConfig,
  input: {
    symbol: string;
    direction?: "incoming" | "outgoing";
    depth?: number;
    limit?: number;
    offset?: number;
  }
) {
  const index = await getProjectIndex(project);
  const depth = Math.min(6, Math.max(1, input.depth ?? 3));
  const limit = Math.min(300, Math.max(1, input.limit ?? 120));
  const offset = Math.max(0, input.offset ?? 0);
  const direction = input.direction ?? "outgoing";
  const seen = new Set<string>([input.symbol]);
  let frontier = [input.symbol];
  const edges: CodeRelation[] = [];
  const edgeIndex = getEdgeIndex(index);
  const scanLimit = offset + limit;
  for (let level = 0; level < depth && frontier.length && edges.length < scanLimit; level++) {
    const next: string[] = [];
    for (const current of frontier) {
      const lookup = direction === "outgoing" ? edgeIndex.callsByFrom : edgeIndex.callsByTo;
      const matches = candidateEdgeNumbers(
        lookup,
        current,
        index.edges,
        (edge) =>
          edge.kind === "calls" &&
          (direction === "outgoing"
            ? edge.from.toLowerCase().includes(current.toLowerCase())
            : edge.to.toLowerCase().includes(current.toLowerCase()))
      );
      for (const edgeNumber of matches) {
        const edge = index.edges[edgeNumber];
        if (!edge) continue;
        edges.push(edge);
        const node = direction === "outgoing" ? edge.to : edge.from;
        if (!seen.has(node)) {
          seen.add(node);
          next.push(node);
        }
        if (edges.length >= scanLimit) break;
      }
    }
    frontier = next;
  }
  const page = edges.slice(offset, offset + limit);
  return {
    snapshotHash: index.snapshotHash,
    total: edges.length,
    offset,
    limit,
    nextOffset:
      offset + page.length < edges.length || edges.length >= scanLimit
        ? offset + page.length
        : null,
    edges: page,
    truncated: offset + page.length < edges.length || edges.length >= scanLimit,
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

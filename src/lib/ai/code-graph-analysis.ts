import path from "node:path";
import type {
  CodeGraphModule,
  CodeRelation,
  ProjectIndex,
  SourceEvidence,
  SymbolEvidence,
} from "@/lib/ai/code-evidence";

const ENTRY_NAME_PATTERN = /^(main|index|app|server|handler|route|controller)$/i;
const MAX_MODULE_SYMBOLS = 8;
const MAX_MODULE_EVIDENCE = 8;
const MAX_MODULE_DEPENDENCIES = 12;

function posixPath(value: string) {
  return value.replaceAll("\\", "/");
}

function dirname(relativePath: string) {
  const dir = path.posix.dirname(posixPath(relativePath));
  return dir === "." ? "(root)" : dir;
}

function modulePrefix(relativePath: string) {
  const dir = dirname(relativePath);
  if (dir === "(root)") return dir;
  const parts = dir.split("/").filter(Boolean);
  if (parts.length <= 2) return parts.join("/");
  if (parts[0] === "src" && parts[1] === "app") {
    return parts.slice(0, Math.min(4, parts.length)).join("/");
  }
  if (parts[0] === "src" && ["components", "lib", "features", "modules"].includes(parts[1])) {
    return parts.slice(0, Math.min(3, parts.length)).join("/");
  }
  return parts.slice(0, 2).join("/");
}

function moduleId(prefix: string) {
  return `module:${prefix}`;
}

function moduleName(prefix: string) {
  if (prefix === "(root)") return "Root";
  const parts = prefix.split("/");
  const tail = parts.at(-1) ?? prefix;
  const parent = parts.length > 1 ? parts.at(-2) : "";
  return parent ? `${parent}/${tail}` : tail;
}

function symbolNodePath(node: string) {
  const withoutLine = posixPath(node).replace(/:\d+(?::\d+)?$/, "");
  return withoutLine.split("#")[0];
}

function stripImportDecorations(target: string) {
  return posixPath(target)
    .replace(/:\d+(?::\d+)?$/, "")
    .replace(/^file:\/\//, "")
    .split("#")[0];
}

function resolveKnownFile(
  target: string,
  fromFile: string,
  knownFiles: Set<string>
) {
  const raw = stripImportDecorations(target);
  if (knownFiles.has(raw)) return raw;

  const candidates = new Set<string>();
  const fromDir = dirname(fromFile);
  const base =
    raw.startsWith(".") && fromDir !== "(root)"
      ? path.posix.normalize(path.posix.join(fromDir, raw))
      : raw.startsWith(".")
        ? path.posix.normalize(raw)
        : raw;

  candidates.add(base);
  for (const ext of [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".py", ".java", ".go", ".rs"]) {
    candidates.add(`${base}${ext}`);
    candidates.add(path.posix.join(base, `index${ext}`));
  }

  for (const candidate of candidates) {
    if (knownFiles.has(candidate)) return candidate;
  }
  return null;
}

function languageForModule(files: ProjectIndex["files"]) {
  const counts = new Map<string, number>();
  for (const file of files) counts.set(file.language, (counts.get(file.language) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "text";
}

function inferResponsibilities(prefix: string, symbols: SymbolEvidence[]) {
  const lower = prefix.toLowerCase();
  const labels: string[] = [];
  const add = (label: string) => {
    if (!labels.includes(label)) labels.push(label);
  };

  if (lower.includes("/app/api") || lower.includes("/api")) add("API 路由与请求处理");
  if (lower.includes("components")) add("界面组件与交互呈现");
  if (lower.includes("editor")) add("编辑器与写作工作流");
  if (lower.includes("code-graph")) add("代码图谱构建与可视化");
  if (lower.includes("/ai") || lower.endsWith("ai")) add("AI Agent、上下文和工具编排");
  if (lower.includes("storage") || lower.includes("asset") || lower.includes("oss")) add("素材与存储管理");
  if (lower.includes("wechat")) add("微信素材、草稿和接口集成");
  if (lower.includes("db") || lower.includes("prisma") || lower.includes("migration")) add("数据访问与迁移");
  if (lower.includes("settings") || lower.includes("config")) add("系统配置与偏好管理");
  if (symbols.some((symbol) => /provider|client|service|manager/i.test(symbol.name))) {
    add("服务封装与外部能力适配");
  }
  if (symbols.some((symbol) => /schema|type|interface|config/i.test(symbol.name))) {
    add("类型、配置和领域模型定义");
  }
  if (labels.length === 0) add("按目录聚合的功能模块");
  return labels.slice(0, 4);
}

function sourceEvidenceForFile(file: ProjectIndex["files"][number], symbols: SymbolEvidence[]): SourceEvidence {
  const firstSymbol = symbols.find((symbol) => symbol.path === file.path);
  return {
    path: file.path,
    startLine: firstSymbol?.startLine ?? 1,
    endLine: firstSymbol?.endLine ?? 1,
    ...(firstSymbol ? { symbol: firstSymbol.name } : {}),
    summary: firstSymbol ? `${firstSymbol.kind} ${firstSymbol.name}` : `${file.language} 文件`,
  };
}

function incrementNested(map: Map<string, Map<string, number>>, from: string, to: string) {
  const nested = map.get(from) ?? new Map<string, number>();
  nested.set(to, (nested.get(to) ?? 0) + 1);
  map.set(from, nested);
}

function sortedLinks(
  links: Map<string, number> | undefined,
  modulesById: Map<string, { pathPrefix: string }>
) {
  return [...(links?.entries() ?? [])]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_MODULE_DEPENDENCIES)
    .map(([id, count]) => ({
      moduleId: id,
      pathPrefix: modulesById.get(id)?.pathPrefix ?? id.replace(/^module:/, ""),
      count,
    }));
}

export function buildFunctionalModules(index: ProjectIndex): CodeGraphModule[] {
  const knownFiles = new Set(index.files.map((file) => file.path));
  const filesByModule = new Map<string, ProjectIndex["files"]>();
  const symbolsByModule = new Map<string, SymbolEvidence[]>();
  const fileToModule = new Map<string, string>();

  for (const file of index.files) {
    const prefix = modulePrefix(file.path);
    const id = moduleId(prefix);
    fileToModule.set(file.path, id);
    const list = filesByModule.get(id) ?? [];
    list.push(file);
    filesByModule.set(id, list);
  }

  for (const symbol of index.symbols) {
    const id = fileToModule.get(symbol.path) ?? moduleId(modulePrefix(symbol.path));
    const list = symbolsByModule.get(id) ?? [];
    list.push(symbol);
    symbolsByModule.set(id, list);
  }

  const importsOut = new Map<string, Map<string, number>>();
  const importsIn = new Map<string, Map<string, number>>();
  const callStats = new Map<string, { internal: number; external: number }>();

  function addCallStat(id: string, key: "internal" | "external") {
    const stats = callStats.get(id) ?? { internal: 0, external: 0 };
    stats[key] += 1;
    callStats.set(id, stats);
  }

  for (const edge of index.edges) {
    const fromFile =
      resolveKnownFile(symbolNodePath(edge.from), edge.evidence.path, knownFiles) ??
      resolveKnownFile(edge.evidence.path, edge.evidence.path, knownFiles);
    if (!fromFile) continue;
    const fromModule = fileToModule.get(fromFile);
    if (!fromModule) continue;

    if (edge.kind === "imports") {
      const toFile = resolveKnownFile(edge.to, fromFile, knownFiles);
      if (!toFile) continue;
      const toModule = fileToModule.get(toFile);
      if (!toModule || toModule === fromModule) continue;
      incrementNested(importsOut, fromModule, toModule);
      incrementNested(importsIn, toModule, fromModule);
    } else if (edge.kind === "calls") {
      const toFile = resolveKnownFile(symbolNodePath(edge.to), fromFile, knownFiles);
      const toModule = toFile ? fileToModule.get(toFile) : null;
      addCallStat(fromModule, toModule && toModule !== fromModule ? "external" : "internal");
    }
  }

  const modulesById = new Map(
    [...filesByModule.entries()].map(([id]) => [
      id,
      { pathPrefix: id.replace(/^module:/, "") },
    ])
  );

  return [...filesByModule.entries()]
    .map(([id, files]) => {
      const prefix = id.replace(/^module:/, "");
      const symbols = symbolsByModule.get(id) ?? [];
      const entrySymbols = symbols
        .filter((symbol) => ENTRY_NAME_PATTERN.test(symbol.name))
        .slice(0, MAX_MODULE_SYMBOLS);
      const topSymbols = symbols
        .slice()
        .sort((a, b) => a.path.localeCompare(b.path) || a.startLine - b.startLine)
        .slice(0, MAX_MODULE_SYMBOLS);
      const out = importsOut.get(id);
      const inbound = importsIn.get(id);
      const calls = callStats.get(id) ?? { internal: 0, external: 0 };
      return {
        id,
        name: moduleName(prefix),
        pathPrefix: prefix,
        language: languageForModule(files),
        fileCount: files.length,
        symbolCount: symbols.length,
        inboundImports: [...(inbound?.values() ?? [])].reduce((sum, count) => sum + count, 0),
        outboundImports: [...(out?.values() ?? [])].reduce((sum, count) => sum + count, 0),
        internalCalls: calls.internal,
        externalCalls: calls.external,
        responsibilities: inferResponsibilities(prefix, symbols),
        entrySymbols,
        topSymbols,
        dependencies: sortedLinks(out, modulesById),
        dependents: sortedLinks(inbound, modulesById),
        evidence: files
          .slice()
          .sort((a, b) => a.path.localeCompare(b.path))
          .slice(0, MAX_MODULE_EVIDENCE)
          .map((file) => sourceEvidenceForFile(file, symbols)),
      } satisfies CodeGraphModule;
    })
    .sort(
      (a, b) =>
        b.fileCount - a.fileCount ||
        b.symbolCount - a.symbolCount ||
        a.pathPrefix.localeCompare(b.pathPrefix)
    );
}

export function modulesFromIndex(index: ProjectIndex) {
  return index.modules && index.modules.length > 0
    ? index.modules
    : buildFunctionalModules(index);
}

export function relationTouchesModule(edge: CodeRelation, module: CodeGraphModule) {
  return (
    edge.evidence.path.startsWith(module.pathPrefix === "(root)" ? "" : module.pathPrefix) ||
    edge.from.includes(module.pathPrefix) ||
    edge.to.includes(module.pathPrefix)
  );
}

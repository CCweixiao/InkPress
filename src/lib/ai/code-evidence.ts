export type EvidenceConfidence = "resolved" | "syntactic" | "inferred";

export type SourceEvidence = {
  path: string;
  startLine: number;
  endLine: number;
  symbol?: string;
  summary: string;
};

export type ModuleEvidence = {
  id: string;
  path: string;
  language: string;
  summary: string;
  evidence: SourceEvidence[];
};

export type SymbolEvidence = {
  id: string;
  name: string;
  kind: string;
  language: string;
  path: string;
  startLine: number;
  endLine: number;
  container?: string;
};

export type CodeRelation = {
  from: string;
  to: string;
  kind: "imports" | "calls" | "extends" | "implements" | "references";
  confidence: EvidenceConfidence;
  evidence: SourceEvidence;
};

export type CodeGraphModule = {
  id: string;
  name: string;
  pathPrefix: string;
  language: string;
  fileCount: number;
  symbolCount: number;
  inboundImports: number;
  outboundImports: number;
  internalCalls: number;
  externalCalls: number;
  responsibilities: string[];
  entrySymbols: SymbolEvidence[];
  topSymbols: SymbolEvidence[];
  dependencies: Array<{
    moduleId: string;
    pathPrefix: string;
    count: number;
  }>;
  dependents: Array<{
    moduleId: string;
    pathPrefix: string;
    count: number;
  }>;
  evidence: SourceEvidence[];
};

export type ProjectLanguageStat = {
  language: string;
  files: number;
  bytes: number;
};

export type ProjectEdgeIndex = {
  callsByFrom: Record<string, number[]>;
  callsByTo: Record<string, number[]>;
  importsByFrom: Record<string, number[]>;
  importsByTo: Record<string, number[]>;
  edgesByPath: Record<string, number[]>;
};

export type CallFlow = {
  name: string;
  steps: Array<{
    order: number;
    symbol: string;
    description: string;
    evidence: SourceEvidence;
  }>;
};

export type CodeEvidencePackage = {
  objective: string;
  projectId: string;
  snapshotHash: string;
  summary: string;
  entryPoints: SourceEvidence[];
  modules: ModuleEvidence[];
  symbols: SymbolEvidence[];
  edges: CodeRelation[];
  flows: CallFlow[];
  openQuestions: string[];
  filesRead: string[];
  truncated: boolean;
  mode?: "agent" | "fallback-index";
  indexStats?: {
    files: number;
    symbols: number;
    edges: number;
    modules: number;
    languages: ProjectLanguageStat[];
    parseErrors: number;
    indexTruncated: boolean;
    evidenceSymbols: number;
    evidenceEdges: number;
    evidenceTruncated: boolean;
  };
};

export type ProjectIndex = {
  version: 1;
  projectId: string;
  root: string;
  snapshotHash: string;
  generatedAt: string;
  accessedAt: string;
  files: Array<{
    path: string;
    language: string;
    hash: string;
    size: number;
  }>;
  symbols: SymbolEvidence[];
  edges: CodeRelation[];
  parseErrors: Array<{ path: string; message: string }>;
  modules?: CodeGraphModule[];
  languageStats?: ProjectLanguageStat[];
  edgeIndex?: ProjectEdgeIndex;
  buildMode?: "fast" | "deep";
  truncated: boolean;
};

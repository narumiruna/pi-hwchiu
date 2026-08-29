import type { Catalog } from "../extensions/knowledge.ts";

export interface SyncOptions {
  check: boolean;
  sourceRoot: string;
}

export interface Snapshot {
  catalog: Catalog;
  catalogText: string;
  indexText: string;
  contents: Map<string, string>;
}

export interface CorpusChanges {
  added: string[];
  removed: string[];
  modified: string[];
}

export function parseArgs(args: string[]): SyncOptions;
export function readSourceProvenance(sourceRoot: string): Promise<{
  sourceRevision: string;
  sourceRevisionDate: string;
}>;
export function buildSnapshot(sourceRoot: string): Promise<Snapshot>;
export function validateSeriesCatalog(
  seriesCatalog: unknown,
  articlePaths: Set<string>,
): void;
export function compareCatalogs(
  oldCatalog:
    | { articles: Array<{ path: string; contentDigest?: string }> }
    | undefined,
  nextCatalog: { articles: Array<{ path: string; contentDigest: string }> },
): Promise<CorpusChanges>;
export function formatChanges(changes: CorpusChanges): string;
export function main(args?: string[]): Promise<void>;

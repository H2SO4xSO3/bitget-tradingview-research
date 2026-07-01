import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ParsedKline } from "./types";

export interface LoadOrFetchCandlesOptions {
  cachePath?: string;
  cacheKey?: Record<string, string | number | boolean | undefined>;
  writeCache?: boolean;
  fetchCandles: () => Promise<ParsedKline[]>;
}

export interface LoadOrFetchCandlesResult {
  source: "cache" | "bitget";
  rows: ParsedKline[];
}

interface CandleCachePayload {
  generatedAt: string;
  cacheKey?: Record<string, string | number | boolean | undefined>;
  rows: ParsedKline[];
}

function stableJson(value: Record<string, string | number | boolean | undefined>): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(value)
        .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
    )
  );
}

function cacheKeyMatches(actual: Record<string, string | number | boolean | undefined> | undefined, expected: Record<string, string | number | boolean | undefined> | undefined): boolean {
  if (!expected) {
    return true;
  }
  if (!actual) {
    return false;
  }
  return stableJson(actual) === stableJson(expected);
}

function readPayload(cachePath: string): CandleCachePayload {
  const payload = JSON.parse(readFileSync(cachePath, "utf8")) as CandleCachePayload | ParsedKline[];
  return Array.isArray(payload) ? { generatedAt: "unknown", rows: payload } : payload;
}

function rowsAreValid(rows: ParsedKline[]): boolean {
  return rows.every(
    (row) =>
      Number.isFinite(row.openTime) &&
      Number.isFinite(row.closeTime) &&
      Number.isFinite(row.open) &&
      Number.isFinite(row.high) &&
      Number.isFinite(row.low) &&
      Number.isFinite(row.close) &&
      Number.isFinite(row.volume) &&
      Number.isFinite(row.quoteVolume)
  );
}

export async function loadOrFetchCandles(options: LoadOrFetchCandlesOptions): Promise<LoadOrFetchCandlesResult> {
  if (options.cachePath && existsSync(options.cachePath)) {
    const payload = readPayload(options.cachePath);
    if (cacheKeyMatches(payload.cacheKey, options.cacheKey) && rowsAreValid(payload.rows)) {
      return { source: "cache", rows: payload.rows };
    }
  }

  const rows = await options.fetchCandles();
  if (options.cachePath && options.writeCache !== false) {
    mkdirSync(path.dirname(options.cachePath), { recursive: true });
    const payload: CandleCachePayload = {
      generatedAt: new Date().toISOString(),
      cacheKey: options.cacheKey,
      rows
    };
    writeFileSync(options.cachePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
  return { source: "bitget", rows };
}

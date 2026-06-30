import type { ParsedKline } from "./types";

interface BitgetCandlesResponse {
  code: string;
  msg: string;
  data?: string[][];
}

interface FetchCandlesRequestOptions {
  symbol: string;
  productType: string;
  granularity: string;
  limit?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  sleep?: SleepFn;
}

const BITGET_BASE_URL = "https://api.bitget.com";
const ONE_MINUTE_MS = 60_000;
const GRANULARITY_MS: Record<string, number> = {
  "1m": 60_000,
  "3m": 3 * 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1H": 60 * 60_000,
  "4H": 4 * 60 * 60_000,
  "6H": 6 * 60 * 60_000,
  "12H": 12 * 60 * 60_000,
  "1D": 24 * 60 * 60_000
};

type SleepFn = (delayMs: number) => Promise<void>;

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseBitgetCandle(row: string[]): ParsedKline {
  const openTime = toNumber(row[0]);
  const open = toNumber(row[1]);
  const high = toNumber(row[2]);
  const low = toNumber(row[3]);
  const close = toNumber(row[4]);
  const volume = toNumber(row[5]);
  const quoteVolume = toNumber(row[6]) || close * volume;
  return { openTime, closeTime: openTime + ONE_MINUTE_MS - 1, open, high, low, close, volume, quoteVolume };
}

function intervalMsForGranularity(granularity: string): number {
  return GRANULARITY_MS[granularity] ?? ONE_MINUTE_MS;
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function retryDelay(baseDelayMs: number, attempt: number): number {
  return baseDelayMs * 2 ** attempt;
}

async function fetchWithRetry(url: URL, options: { maxRetries: number; retryDelayMs: number; sleep: SleepFn }): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url);
    if (response.ok || response.status !== 429 || attempt >= options.maxRetries) {
      return response;
    }
    await options.sleep(retryDelay(options.retryDelayMs, attempt));
  }
}

function uniqueSortedRows(rows: ParsedKline[], startTime?: number, endTime?: number): ParsedKline[] {
  const seen = new Set<number>();
  return rows
    .filter((row) => (startTime === undefined || row.openTime >= startTime) && (endTime === undefined || row.openTime <= endTime))
    .sort((a, b) => a.openTime - b.openTime)
    .filter((row) => {
      if (seen.has(row.openTime)) {
        return false;
      }
      seen.add(row.openTime);
      return row.close > 0 && row.volume >= 0;
    });
}

export async function fetchBitgetHistoryCandles(options: {
  symbol: string;
  productType: string;
  granularity: string;
  startTime: number;
  endTime: number;
  limit?: number;
  requestDelayMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  sleep?: SleepFn;
}): Promise<ParsedKline[]> {
  const limit = options.limit ?? 200;
  const intervalMs = intervalMsForGranularity(options.granularity);
  const requestDelayMs = options.requestDelayMs ?? 0;
  const sleepFn = options.sleep ?? sleep;
  const rows: ParsedKline[] = [];
  let cursorEnd = options.endTime;

  while (cursorEnd >= options.startTime) {
    const requestStartTime = Math.max(options.startTime, cursorEnd - (limit - 1) * intervalMs);
    const url = new URL("/api/v2/mix/market/history-candles", BITGET_BASE_URL);
    url.searchParams.set("symbol", options.symbol);
    url.searchParams.set("productType", options.productType);
    url.searchParams.set("granularity", options.granularity);
    url.searchParams.set("startTime", String(requestStartTime));
    url.searchParams.set("endTime", String(cursorEnd));
    url.searchParams.set("limit", String(limit));

    const response = await fetchWithRetry(url, {
      maxRetries: options.maxRetries ?? 5,
      retryDelayMs: options.retryDelayMs ?? 1_000,
      sleep: sleepFn
    });
    if (!response.ok) {
      throw new Error(`Bitget candles HTTP ${response.status}: ${await response.text()}`);
    }
    const payload = (await response.json()) as BitgetCandlesResponse;
    if (payload.code !== "00000") {
      throw new Error(`Bitget candles error ${payload.code}: ${payload.msg}`);
    }
    const chunk = (payload.data ?? []).map(parseBitgetCandle);
    if (chunk.length === 0) {
      break;
    }
    rows.push(...chunk);
    const firstOpenTime = Math.min(...chunk.map((row) => row.openTime));
    const nextCursorEnd = firstOpenTime - ONE_MINUTE_MS;
    if (nextCursorEnd >= cursorEnd) {
      break;
    }
    cursorEnd = nextCursorEnd;
    if (requestDelayMs > 0 && cursorEnd >= options.startTime) {
      await sleepFn(requestDelayMs);
    }
  }

  return uniqueSortedRows(rows, options.startTime, options.endTime);
}

export async function fetchBitgetRecentCandles(options: FetchCandlesRequestOptions): Promise<ParsedKline[]> {
  const url = new URL("/api/v2/mix/market/candles", BITGET_BASE_URL);
  url.searchParams.set("symbol", options.symbol);
  url.searchParams.set("productType", options.productType);
  url.searchParams.set("granularity", options.granularity);
  url.searchParams.set("limit", String(options.limit ?? 300));

  const response = await fetchWithRetry(url, {
    maxRetries: options.maxRetries ?? 5,
    retryDelayMs: options.retryDelayMs ?? 1_000,
    sleep: options.sleep ?? sleep
  });
  if (!response.ok) {
    throw new Error(`Bitget recent candles HTTP ${response.status}: ${await response.text()}`);
  }
  const payload = (await response.json()) as BitgetCandlesResponse;
  if (payload.code !== "00000") {
    throw new Error(`Bitget recent candles error ${payload.code}: ${payload.msg}`);
  }
  return uniqueSortedRows((payload.data ?? []).map(parseBitgetCandle));
}

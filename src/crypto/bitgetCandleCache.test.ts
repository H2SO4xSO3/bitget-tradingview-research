import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadOrFetchCandles } from "./bitgetCandleCache";
import type { ParsedKline } from "./types";

function row(openTime: number): ParsedKline {
  return {
    openTime,
    closeTime: openTime + 59_999,
    open: 1,
    high: 2,
    low: 0.5,
    close: 1.5,
    volume: 10,
    quoteVolume: 15
  };
}

describe("Bitget candle cache", () => {
  it("writes fetched candles and then reuses the cache", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bitget-cache-"));
    const cachePath = path.join(dir, "candles.json");
    let fetchCalls = 0;
    const fetchCandles = async () => {
      fetchCalls += 1;
      return [row(1), row(2)];
    };

    const first = await loadOrFetchCandles({ cachePath, fetchCandles });
    const second = await loadOrFetchCandles({
      cachePath,
      fetchCandles: async () => {
        throw new Error("should not fetch when cache exists");
      }
    });

    expect(first.source).toBe("bitget");
    expect(second.source).toBe("cache");
    expect(second.rows).toEqual([row(1), row(2)]);
    expect(fetchCalls).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it("can fetch without writing when cache writes are disabled", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bitget-cache-"));
    const cachePath = path.join(dir, "candles.json");

    const first = await loadOrFetchCandles({
      cachePath,
      writeCache: false,
      fetchCandles: async () => [row(1)]
    });
    const second = await loadOrFetchCandles({
      cachePath,
      writeCache: false,
      fetchCandles: async () => [row(2)]
    });

    expect(first.rows).toEqual([row(1)]);
    expect(second.rows).toEqual([row(2)]);
    expect(first.source).toBe("bitget");
    expect(second.source).toBe("bitget");
    rmSync(dir, { recursive: true, force: true });
  });

  it("refetches when the cache key does not match the requested window", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bitget-cache-"));
    const cachePath = path.join(dir, "candles.json");

    await loadOrFetchCandles({
      cachePath,
      cacheKey: { symbol: "MUUSDT", startTime: 1, endTime: 2 },
      fetchCandles: async () => [row(1)]
    });
    const second = await loadOrFetchCandles({
      cachePath,
      cacheKey: { symbol: "MUUSDT", startTime: 1, endTime: 3 },
      fetchCandles: async () => [row(3)]
    });

    expect(second.source).toBe("bitget");
    expect(second.rows).toEqual([row(3)]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("refetches when cached rows are malformed", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bitget-cache-"));
    const cachePath = path.join(dir, "candles.json");
    const cacheKey = { symbol: "MUUSDT", startTime: 1, endTime: 2 };
    writeFileSync(
      cachePath,
      JSON.stringify({
        generatedAt: "2026-07-01T00:00:00.000Z",
        cacheKey,
        rows: [{ ...row(1), openTime: "openTime" }]
      }),
      "utf8"
    );

    const result = await loadOrFetchCandles({
      cachePath,
      cacheKey,
      fetchCandles: async () => [row(2)]
    });

    expect(result.source).toBe("bitget");
    expect(result.rows).toEqual([row(2)]);
    rmSync(dir, { recursive: true, force: true });
  });
});

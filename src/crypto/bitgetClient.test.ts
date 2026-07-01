import { describe, expect, it } from "vitest";
import { fetchBitgetHistoryCandles, fetchBitgetRecentCandles } from "./bitgetClient";

function jsonResponse(payload: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    text: async () => JSON.stringify(payload)
  };
}

describe("Bitget candle client", () => {
  it("paginates history candles with bounded request windows", async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ startTime: string | null; endTime: string | null; limit: string | null }> = [];
    globalThis.fetch = (async (input: URL | string) => {
      const url = input instanceof URL ? input : new URL(String(input));
      calls.push({
        startTime: url.searchParams.get("startTime"),
        endTime: url.searchParams.get("endTime"),
        limit: url.searchParams.get("limit")
      });
      const startTime = Number(url.searchParams.get("startTime"));
      const endTime = Number(url.searchParams.get("endTime"));
      const data: string[][] = [];
      for (let openTime = startTime; openTime <= endTime; openTime += 60_000) {
        data.push([String(openTime), "100", "101", "99", "100", "1", "100"]);
      }
      return jsonResponse({
        code: "00000",
        msg: "success",
        data
      }) as Response;
    }) as typeof fetch;

    try {
      const rows = await fetchBitgetHistoryCandles({
        symbol: "MUUSDT",
        productType: "USDT-FUTURES",
        granularity: "1m",
        startTime: 0,
        endTime: 600_000,
        limit: 3
      });

      expect(rows.map((row) => row.openTime)).toEqual([0, 60_000, 120_000, 180_000, 240_000, 300_000, 360_000, 420_000, 480_000, 540_000, 600_000]);
      expect(calls[0]).toEqual({ startTime: "480000", endTime: "600000", limit: "3" });
      expect(calls[1]).toEqual({ startTime: "300000", endTime: "420000", limit: "3" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("backs off and retries transient 429 candle responses", async () => {
    const originalFetch = globalThis.fetch;
    const sleeps: number[] = [];
    let attempts = 0;
    globalThis.fetch = (async () => {
      attempts += 1;
      if (attempts === 1) {
        return {
          ok: false,
          status: 429,
          json: async () => ({ code: "429", msg: "Too Many Requests" }),
          text: async () => '{"code":"429","msg":"Too Many Requests"}'
        } as Response;
      }
      return jsonResponse({
        code: "00000",
        msg: "success",
        data: [["0", "100", "101", "99", "100", "1", "100"]]
      }) as Response;
    }) as typeof fetch;

    try {
      const rows = await fetchBitgetHistoryCandles({
        symbol: "MUUSDT",
        productType: "USDT-FUTURES",
        granularity: "1m",
        startTime: 0,
        endTime: 0,
        maxRetries: 2,
        retryDelayMs: 250,
        sleep: async (delayMs) => {
          sleeps.push(delayMs);
        }
      });

      expect(rows.map((row) => row.openTime)).toEqual([0]);
      expect(attempts).toBe(2);
      expect(sleeps).toEqual([250]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("waits between paginated candle requests when requested", async () => {
    const originalFetch = globalThis.fetch;
    const sleeps: number[] = [];
    let calls = 0;
    globalThis.fetch = (async (input: URL | string) => {
      calls += 1;
      const url = input instanceof URL ? input : new URL(String(input));
      const startTime = Number(url.searchParams.get("startTime"));
      const endTime = Number(url.searchParams.get("endTime"));
      const data: string[][] = [];
      for (let openTime = startTime; openTime <= endTime; openTime += 60_000) {
        data.push([String(openTime), "100", "101", "99", "100", "1", "100"]);
      }
      return jsonResponse({
        code: "00000",
        msg: "success",
        data
      }) as Response;
    }) as typeof fetch;

    try {
      await fetchBitgetHistoryCandles({
        symbol: "MUUSDT",
        productType: "USDT-FUTURES",
        granularity: "1m",
        startTime: 0,
        endTime: 180_000,
        limit: 2,
        requestDelayMs: 33,
        sleep: async (delayMs) => {
          sleeps.push(delayMs);
        }
      });

      expect(calls).toBe(2);
      expect(sleeps).toEqual([33]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("fetches recent updating candles from the non-history Bitget endpoint", async () => {
    const originalFetch = globalThis.fetch;
    let seenUrl: URL | undefined;
    globalThis.fetch = (async (input: URL | string) => {
      seenUrl = input instanceof URL ? input : new URL(String(input));
      return jsonResponse({
        code: "00000",
        msg: "success",
        data: [
          ["60000", "101", "102", "100", "101.5", "2", "203"],
          ["0", "100", "101", "99", "100.5", "1", "100"]
        ]
      }) as Response;
    }) as typeof fetch;

    try {
      const rows = await fetchBitgetRecentCandles({
        symbol: "MUUSDT",
        productType: "USDT-FUTURES",
        granularity: "1m",
        limit: 2
      });

      expect(seenUrl?.pathname).toBe("/api/v2/mix/market/candles");
      expect(seenUrl?.searchParams.get("symbol")).toBe("MUUSDT");
      expect(seenUrl?.searchParams.get("productType")).toBe("USDT-FUTURES");
      expect(seenUrl?.searchParams.get("granularity")).toBe("1m");
      expect(seenUrl?.searchParams.get("limit")).toBe("2");
      expect(rows.map((row) => row.openTime)).toEqual([0, 60_000]);
      expect(rows.at(-1)?.close).toBe(101.5);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("drops malformed candle rows with non-numeric timestamps", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      jsonResponse({
        code: "00000",
        msg: "success",
        data: [
          ["openTime", "410", "410", "410", "410", "0", "0"],
          ["60000", "101", "102", "100", "101.5", "2", "203"]
        ]
      }) as Response) as typeof fetch;

    try {
      const rows = await fetchBitgetRecentCandles({
        symbol: "MUUSDT",
        productType: "USDT-FUTURES",
        granularity: "1m"
      });

      expect(rows.map((row) => row.openTime)).toEqual([60_000]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

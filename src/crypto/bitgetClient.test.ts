import { describe, expect, it } from "vitest";
import { fetchBitgetHistoryCandles } from "./bitgetClient";

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
});

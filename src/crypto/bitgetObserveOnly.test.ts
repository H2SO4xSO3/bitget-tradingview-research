import { describe, expect, it } from "vitest";
import { createObserveStateBySymbol, observeSymbolsOnce } from "./bitgetObserveOnly";
import type { ParsedKline } from "./types";

function row(index: number, close: number): ParsedKline {
  return {
    openTime: index * 60_000,
    open: close,
    high: close + 0.5,
    low: close - 0.5,
    close,
    volume: 1,
    quoteVolume: close
  };
}

describe("Bitget observe-only runner", () => {
  it("observes recent candles and emits preview events per symbol without placing orders", async () => {
    const states = createObserveStateBySymbol(["MUUSDT"]);
    const events = await observeSymbolsOnce({
      symbols: ["MUUSDT"],
      productType: "USDT-FUTURES",
      granularity: "1m",
      candleLimit: 300,
      states,
      observedAt: 123_000,
      fetchRecentCandles: async () => [100, 101, 102, 99, 98, 103].map((close, index) => row(index, close))
    });

    expect(events.map((event) => event.type)).toContain("pre_buy");
    expect(events.every((event) => event.symbol === "MUUSDT")).toBe(true);
  });

  it("warm-starts without emitting historical confirmed labels from before startup", async () => {
    const states = createObserveStateBySymbol(["MUUSDT"]);
    const events = await observeSymbolsOnce({
      symbols: ["MUUSDT"],
      productType: "USDT-FUTURES",
      granularity: "1m",
      candleLimit: 300,
      states,
      observedAt: 123_000,
      fetchRecentCandles: async () => [100, 101, 102, 99, 98, 103].map((close, index) => row(index, close))
    });

    expect(events.map((event) => event.type)).toEqual(["pre_buy"]);
  });
});

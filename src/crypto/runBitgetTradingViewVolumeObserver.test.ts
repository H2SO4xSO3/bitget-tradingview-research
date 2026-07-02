import { describe, expect, it } from "vitest";
import { parseTradingViewVolumeObserverArgs } from "./runBitgetTradingViewVolumeObserver";

describe("TradingView volume observer runner args", () => {
  it("defaults to observe-only MUUSDT 1m with independent output", () => {
    expect(parseTradingViewVolumeObserverArgs([])).toMatchObject({
      symbols: ["MUUSDT"],
      productType: "USDT-FUTURES",
      granularity: "1m",
      marketPeriod: "5m",
      candleLimit: 300,
      pollMs: 60_000,
      maxPolls: 0
    });
  });

  it("parses symbols, polling, and output options", () => {
    expect(
      parseTradingViewVolumeObserverArgs([
        "--symbols",
        "MUUSDT,BTCUSDT",
        "--poll-ms",
        "1000",
        "--max-polls",
        "2",
        "--output",
        "data/custom.jsonl"
      ])
    ).toMatchObject({
      symbols: ["MUUSDT", "BTCUSDT"],
      pollMs: 1_000,
      maxPolls: 2,
      outputPath: "data/custom.jsonl"
    });
  });
});

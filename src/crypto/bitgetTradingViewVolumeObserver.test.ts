import { describe, expect, it } from "vitest";
import { createTradingViewVolumeObserveStateBySymbol, observeTradingViewVolumeSymbolsOnce } from "./bitgetTradingViewVolumeObserver";
import type { BitgetMarketContext } from "./bitgetMarketData";
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

function marketContext(symbol: string): BitgetMarketContext {
  return {
    symbol,
    productType: "USDT-FUTURES",
    period: "5m",
    openInterest: { symbol, timestampMs: 1_000, openInterest: 123 },
    fundingRates: [{ symbol, timestampMs: 1_000, fundingRate: 0.00001 }],
    takerBuySell: [{ timestampMs: 1_000, buyVolume: 80, sellVolume: 20 }],
    longShort: [{ timestampMs: 1_000, longRatio: 0.52, shortRatio: 0.48, longShortRatio: 1.08 }],
    accountLongShort: [{ timestampMs: 1_000, longAccountRatio: 0.53, shortAccountRatio: 0.47, longShortAccountRatio: 1.13 }],
    positionLongShort: [{ timestampMs: 1_000, longPositionRatio: 0.51, shortPositionRatio: 0.49, longShortPositionRatio: 1.04 }],
    blockers: []
  };
}

describe("Bitget TradingView volume observer", () => {
  it("emits observe-only enriched TradingView events without execution fields", async () => {
    const states = createTradingViewVolumeObserveStateBySymbol(["MUUSDT"]);
    const events = await observeTradingViewVolumeSymbolsOnce({
      symbols: ["MUUSDT"],
      productType: "USDT-FUTURES",
      granularity: "1m",
      marketPeriod: "5m",
      candleLimit: 300,
      observedAt: 123_000,
      states,
      fetchRecentCandles: async () => [100, 101, 102, 99, 98, 103].map((close, index) => row(index, close)),
      collectMarketContext: async () => marketContext("MUUSDT")
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      symbol: "MUUSDT",
      action: "hold",
      state: "observe_only",
      type: "pre_buy",
      volumeConfirm: true,
      blocked: "blocked=observe_only_no_execution",
      wae: expect.objectContaining({ state: expect.any(String) })
    });
    expect(events[0]).not.toHaveProperty("orderId");
    expect(events[0]).not.toHaveProperty("positionSize");
  });
});

import { describe, expect, it } from "vitest";
import { enrichTradingViewEventsWithVolume } from "./tradingViewVolumeObserver";
import type { BitgetMarketContext } from "./bitgetMarketData";
import type { TradingViewObserveEvent } from "./tradingViewObserver";

function event(direction: "long" | "short"): TradingViewObserveEvent {
  return {
    type: direction === "long" ? "pre_buy" : "pre_sell",
    symbol: "MUUSDT",
    observedAt: "2026-07-01T16:00:00.000Z",
    openTime: Date.parse("2026-07-01T15:59:00.000Z"),
    candleTime: "2026-07-01T15:59:00.000Z",
    signal: direction === "long" ? "buy" : "sell",
    direction,
    entryPrice: 100,
    takeProfitPrice: direction === "long" ? 103 : 97,
    stopPrice: direction === "long" ? 98 : 102
  };
}

function context(overrides: Partial<BitgetMarketContext> = {}): BitgetMarketContext {
  return {
    symbol: "MUUSDT",
    productType: "USDT-FUTURES",
    period: "5m",
    openInterest: { symbol: "MUUSDT", timestampMs: 1_000, openInterest: 123_456 },
    fundingRates: [{ symbol: "MUUSDT", timestampMs: 1_000, fundingRate: 0.00001 }],
    takerBuySell: [
      { timestampMs: 1_000, buyVolume: 70, sellVolume: 30 },
      { timestampMs: 2_000, buyVolume: 65, sellVolume: 35 }
    ],
    longShort: [{ timestampMs: 1_000, longRatio: 0.52, shortRatio: 0.48, longShortRatio: 1.08 }],
    accountLongShort: [{ timestampMs: 1_000, longAccountRatio: 0.53, shortAccountRatio: 0.47, longShortAccountRatio: 1.13 }],
    positionLongShort: [{ timestampMs: 1_000, longPositionRatio: 0.51, shortPositionRatio: 0.49, longShortPositionRatio: 1.04 }],
    blockers: [],
    ...overrides
  };
}

describe("TradingView volume observer", () => {
  it("confirms a long candidate when taker flow supports it and crowding is tame", () => {
    const [enriched] = enrichTradingViewEventsWithVolume({
      events: [event("long")],
      marketContext: context()
    });

    expect(enriched).toMatchObject({
      symbol: "MUUSDT",
      action: "hold",
      state: "observe_only",
      direction: "long",
      volumeConfirm: true,
      rawScore: 82,
      blocked: "blocked=observe_only_no_execution",
      evidence: expect.objectContaining({
        takerImbalancePct: 35,
        latestFundingRatePct: 0.001,
        openInterestPresent: true
      })
    });
  });

  it("blocks a long candidate when taker flow points the other way", () => {
    const [enriched] = enrichTradingViewEventsWithVolume({
      events: [event("long")],
      marketContext: context({
        takerBuySell: [
          { timestampMs: 1_000, buyVolume: 30, sellVolume: 70 },
          { timestampMs: 2_000, buyVolume: 35, sellVolume: 65 }
        ]
      })
    });

    expect(enriched).toMatchObject({
      direction: "long",
      volumeConfirm: false,
      rawScore: 32,
      blocked: "blocked=volume_not_confirmed; observe_only_no_execution"
    });
  });

  it("keeps candidates but blocks them when market context is missing", () => {
    const [enriched] = enrichTradingViewEventsWithVolume({
      events: [event("short")]
    });

    expect(enriched).toMatchObject({
      direction: "short",
      volumeConfirm: false,
      rawScore: 0,
      blocked: "blocked=volume_context_missing; observe_only_no_execution"
    });
  });
});

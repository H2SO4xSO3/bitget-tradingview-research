import { describe, expect, it } from "vitest";
import { createTradingViewObserverState, observeTradingViewSnapshot } from "./tradingViewObserver";
import type { FramaChannelPoint, RangeFilterPoint } from "./tradingViewIndicators";
import type { ParsedKline } from "./types";

function row(index: number, close: number, low = close - 1, high = close + 1): ParsedKline {
  return {
    openTime: index * 60_000,
    open: close,
    high,
    low,
    close,
    volume: 1,
    quoteVolume: close
  };
}

function rangePoint(index: number, signal?: RangeFilterPoint["signal"]): RangeFilterPoint {
  return {
    openTime: index * 60_000,
    filter: 100,
    highBand: 102,
    lowBand: 98,
    upward: signal === "buy" ? 1 : 0,
    downward: signal === "sell" ? 1 : 0,
    longCondition: signal === "buy",
    shortCondition: signal === "sell",
    signal
  };
}

function framaPoint(index: number): FramaChannelPoint {
  return {
    openTime: index * 60_000,
    frama: 100,
    upper: 104,
    lower: 96,
    breakUp: false,
    breakDown: false,
    candleColor: "neutral"
  };
}

describe("TradingView observe-only state machine", () => {
  it("emits one preview event per current candle signal and suppresses duplicate polls", () => {
    const state = createTradingViewObserverState();
    const rows = [row(0, 99), row(1, 103)];
    const range = [rangePoint(0), rangePoint(1, "buy")];
    const frama = [framaPoint(0), framaPoint(1)];

    const first = observeTradingViewSnapshot({ symbol: "MUUSDT", rows, range, frama, state, observedAt: 10_000 });
    const second = observeTradingViewSnapshot({ symbol: "MUUSDT", rows, range, frama, state, observedAt: 11_000 });

    expect(first.events.map((event) => event.type)).toEqual(["pre_buy"]);
    expect(first.events[0]).toMatchObject({ symbol: "MUUSDT", openTime: rows[1].openTime, entryPrice: 103 });
    expect(second.events).toEqual([]);
  });

  it("marks an active preview false when the current candle signal disappears", () => {
    const state = createTradingViewObserverState();
    observeTradingViewSnapshot({
      symbol: "MUUSDT",
      rows: [row(0, 99), row(1, 103)],
      range: [rangePoint(0), rangePoint(1, "buy")],
      frama: [framaPoint(0), framaPoint(1)],
      state,
      observedAt: 10_000
    });

    const result = observeTradingViewSnapshot({
      symbol: "MUUSDT",
      rows: [row(0, 99), row(1, 100, 100.5, 103.5)],
      range: [rangePoint(0), rangePoint(1)],
      frama: [framaPoint(0), framaPoint(1)],
      state,
      observedAt: 20_000
    });

    expect(result.events.map((event) => event.type)).toEqual(["false_preview"]);
  });

  it("emits confirmed labels when a preview candle becomes closed", () => {
    const state = createTradingViewObserverState();
    observeTradingViewSnapshot({
      symbol: "MUUSDT",
      rows: [row(0, 99), row(1, 103)],
      range: [rangePoint(0), rangePoint(1, "buy")],
      frama: [framaPoint(0), framaPoint(1)],
      state,
      observedAt: 10_000
    });

    const result = observeTradingViewSnapshot({
      symbol: "MUUSDT",
      rows: [row(0, 99), row(1, 103), row(2, 104)],
      range: [rangePoint(0), rangePoint(1, "buy"), rangePoint(2)],
      frama: [framaPoint(0), framaPoint(1), framaPoint(2)],
      state,
      observedAt: 70_000
    });

    expect(result.events.map((event) => event.type)).toEqual(["confirmed_buy"]);
  });

  it("does not backfill old confirmed labels if rolling indicator state changes later", () => {
    const state = createTradingViewObserverState();
    observeTradingViewSnapshot({
      symbol: "MUUSDT",
      rows: [row(0, 100), row(1, 101), row(2, 102)],
      range: [rangePoint(0), rangePoint(1), rangePoint(2)],
      frama: [framaPoint(0), framaPoint(1), framaPoint(2)],
      state,
      observedAt: 10_000
    });
    observeTradingViewSnapshot({
      symbol: "MUUSDT",
      rows: [row(0, 100), row(1, 101), row(2, 102), row(3, 103)],
      range: [rangePoint(0), rangePoint(1), rangePoint(2), rangePoint(3)],
      frama: [framaPoint(0), framaPoint(1), framaPoint(2), framaPoint(3)],
      state,
      observedAt: 70_000
    });

    const result = observeTradingViewSnapshot({
      symbol: "MUUSDT",
      rows: [row(0, 100), row(1, 101), row(2, 102), row(3, 103), row(4, 104)],
      range: [rangePoint(0), rangePoint(1), rangePoint(2, "buy"), rangePoint(3), rangePoint(4)],
      frama: [framaPoint(0), framaPoint(1), framaPoint(2), framaPoint(3), framaPoint(4)],
      state,
      observedAt: 130_000
    });

    expect(result.events).toEqual([]);
  });

  it("records take-profit and stop-loss outcomes for active previews", () => {
    const state = createTradingViewObserverState();
    observeTradingViewSnapshot({
      symbol: "MUUSDT",
      rows: [row(0, 99), row(1, 103, 102, 103)],
      range: [rangePoint(0), rangePoint(1, "buy")],
      frama: [framaPoint(0), framaPoint(1)],
      state,
      observedAt: 10_000
    });

    const result = observeTradingViewSnapshot({
      symbol: "MUUSDT",
      rows: [row(0, 99), row(1, 105, 102, 105.5)],
      range: [rangePoint(0), rangePoint(1, "buy")],
      frama: [framaPoint(0), framaPoint(1)],
      state,
      observedAt: 20_000
    });

    expect(result.events.map((event) => event.type)).toEqual(["tp_hit"]);
  });
});

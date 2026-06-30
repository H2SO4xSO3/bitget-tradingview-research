import { describe, expect, it } from "vitest";
import { runFixedRiskPreTriggerBacktest, runFixedRiskSignalBacktest } from "./strategyResearch";
import type { FramaChannelPoint, RangeFilterPoint, TradingViewSignal, WaddahAttarExplosionPoint } from "./tradingViewIndicators";
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

function rangePoint(index: number, filter: number, highBand: number, lowBand: number): RangeFilterPoint {
  return {
    openTime: index * 60_000,
    filter,
    highBand,
    lowBand,
    upward: 0,
    downward: 0,
    longCondition: false,
    shortCondition: false
  };
}

function framaPoint(index: number, frama: number, upper: number, lower: number, candleColor: FramaChannelPoint["candleColor"] = "neutral"): FramaChannelPoint {
  return {
    openTime: index * 60_000,
    frama,
    upper,
    lower,
    breakUp: false,
    breakDown: false,
    candleColor
  };
}

function waePoint(index: number, state: WaddahAttarExplosionPoint["state"], rising = true): WaddahAttarExplosionPoint {
  return {
    openTime: index * 60_000,
    trendUp: state === "bullish" ? 10 : 0,
    trendDown: state === "bearish" ? 10 : 0,
    explosionLine: 5,
    deadZone: 1,
    bullishExplosion: state === "bullish",
    bearishExplosion: state === "bearish",
    bullishRising: state === "bullish" && rising,
    bearishRising: state === "bearish" && rising,
    state
  };
}

describe("fixed-risk strategy research helpers", () => {
  it("enters a fixed-risk pre-trigger trade from the previous Range band and exits at the tooltip target", () => {
    const rows = [
      row(0, 100, 99, 101),
      row(1, 102, 101.5, 103),
      row(2, 106, 105, 106)
    ];
    const range = [rangePoint(0, 100, 102, 98), rangePoint(1, 101, 103, 99), rangePoint(2, 102, 104, 100)];
    const frama = [framaPoint(0, 101, 106, 94), framaPoint(1, 101, 106, 96), framaPoint(2, 102, 106, 98)];

    const result = runFixedRiskPreTriggerBacktest({
      symbol: "MUUSDT",
      rows,
      range,
      frama,
      initialEquityUsdt: 100,
      riskFraction: 0.1,
      maxLeverage: 25,
      feeRate: 0
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({
      direction: "long",
      entryPrice: 102,
      stopPrice: 101,
      takeProfitPrice: 106,
      riskUsdt: 10,
      pnlUsdt: 40,
      exitReason: "take_profit"
    });
    expect(result.endingEquityUsdt).toBe(140);
  });

  it("skips fixed-risk pre-trigger entries when both Range bands are touched in the same candle", () => {
    const rows = [row(0, 100, 99, 101), row(1, 100, 97, 103)];
    const range = [rangePoint(0, 100, 102, 98), rangePoint(1, 100, 102, 98)];
    const frama = [framaPoint(0, 100, 106, 94), framaPoint(1, 100, 106, 94)];

    const result = runFixedRiskPreTriggerBacktest({
      symbol: "MUUSDT",
      rows,
      range,
      frama,
      initialEquityUsdt: 100,
      riskFraction: 0.1,
      maxLeverage: 25,
      feeRate: 0
    });

    expect(result.trades).toHaveLength(0);
    expect(result.endingEquityUsdt).toBe(100);
  });

  it("can require same-direction WAE explosion before fixed-risk pre-trigger entry", () => {
    const rows = [
      row(0, 100, 99, 101),
      row(1, 102, 101.5, 103),
      row(2, 106, 105, 106)
    ];
    const range = [rangePoint(0, 100, 102, 98), rangePoint(1, 101, 103, 99), rangePoint(2, 102, 104, 100)];
    const frama = [framaPoint(0, 101, 106, 94), framaPoint(1, 101, 106, 96), framaPoint(2, 102, 106, 98)];

    const blocked = runFixedRiskPreTriggerBacktest({
      symbol: "MUUSDT",
      rows,
      range,
      frama,
      wae: [waePoint(0, "quiet"), waePoint(1, "quiet"), waePoint(2, "quiet")],
      waeGate: "withExplosion",
      initialEquityUsdt: 100,
      riskFraction: 0.1,
      maxLeverage: 25,
      feeRate: 0
    });
    const allowed = runFixedRiskPreTriggerBacktest({
      symbol: "MUUSDT",
      rows,
      range,
      frama,
      wae: [waePoint(0, "bullish"), waePoint(1, "bullish"), waePoint(2, "bullish")],
      waeGate: "withExplosion",
      initialEquityUsdt: 100,
      riskFraction: 0.1,
      maxLeverage: 25,
      feeRate: 0
    });

    expect(blocked.trades).toHaveLength(0);
    expect(allowed.trades).toHaveLength(1);
    expect(allowed.trades[0]).toMatchObject({ direction: "long", entryPrice: 102 });
  });

  it("can require same-direction WAE dead-zone break before fixed-risk pre-trigger entry", () => {
    const rows = [
      row(0, 100, 99, 101),
      row(1, 102, 101.5, 103),
      row(2, 106, 105, 106)
    ];
    const range = [rangePoint(0, 100, 102, 98), rangePoint(1, 101, 103, 99), rangePoint(2, 102, 104, 100)];
    const frama = [framaPoint(0, 101, 106, 94), framaPoint(1, 101, 106, 96), framaPoint(2, 102, 106, 98)];
    const deadZoneOnly: WaddahAttarExplosionPoint[] = [
      { ...waePoint(0, "quiet"), trendUp: 10, trendDown: 0, explosionLine: 20, deadZone: 5 },
      waePoint(1, "quiet"),
      waePoint(2, "quiet")
    ];

    const result = runFixedRiskPreTriggerBacktest({
      symbol: "MUUSDT",
      rows,
      range,
      frama,
      wae: deadZoneOnly,
      waeGate: "withDeadZone",
      initialEquityUsdt: 100,
      riskFraction: 0.1,
      maxLeverage: 25,
      feeRate: 0
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({ direction: "long", entryPrice: 102 });
  });

  it("can require WAE explosion columns to keep rising before entry", () => {
    const rows = [
      row(0, 100, 99, 101),
      row(1, 102, 101.5, 103),
      row(2, 106, 105, 106)
    ];
    const range = [rangePoint(0, 100, 102, 98), rangePoint(1, 101, 103, 99), rangePoint(2, 102, 104, 100)];
    const frama = [framaPoint(0, 101, 106, 94), framaPoint(1, 101, 106, 96), framaPoint(2, 102, 106, 98)];

    const result = runFixedRiskPreTriggerBacktest({
      symbol: "MUUSDT",
      rows,
      range,
      frama,
      wae: [waePoint(0, "bullish", false), waePoint(1, "bullish", false), waePoint(2, "bullish", false)],
      waeGate: "withRisingExplosion",
      initialEquityUsdt: 100,
      riskFraction: 0.1,
      maxLeverage: 25,
      feeRate: 0
    });

    expect(result.trades).toHaveLength(0);
  });

  it("sizes each trade from fixed account risk and exits at 1.5R take profit", () => {
    const rows = [
      row(0, 100, 98, 101),
      row(1, 103, 102, 104)
    ];
    const signals: (TradingViewSignal | undefined)[] = ["buy", undefined];

    const result = runFixedRiskSignalBacktest({
      symbol: "MUUSDT",
      rows,
      signals,
      initialEquityUsdt: 100,
      riskFraction: 0.1,
      riskRewardRatio: 1.5,
      maxLeverage: 25,
      feeRate: 0
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({
      direction: "long",
      entryPrice: 100,
      stopPrice: 98,
      takeProfitPrice: 103,
      riskUsdt: 10,
      pnlUsdt: 15,
      exitReason: "take_profit"
    });
    expect(result.endingEquityUsdt).toBe(115);
  });

  it("skips neutral FRAMA candles when color gate is enabled", () => {
    const rows = [row(0, 100, 98, 101), row(1, 103, 102, 104)];
    const signals: (TradingViewSignal | undefined)[] = ["buy", undefined];

    const result = runFixedRiskSignalBacktest({
      symbol: "MUUSDT",
      rows,
      signals,
      framaColors: ["neutral", "up"],
      colorGate: "withTrend",
      initialEquityUsdt: 100,
      riskFraction: 0.1,
      riskRewardRatio: 1.5,
      maxLeverage: 25,
      feeRate: 0
    });

    expect(result.trades).toHaveLength(0);
    expect(result.endingEquityUsdt).toBe(100);
  });

  it("aggregates daily returns by Asia Shanghai calendar days", () => {
    const rows = [
      { ...row(0, 100, 98, 101), openTime: Date.UTC(2026, 5, 24, 15, 59) },
      { ...row(1, 103, 102, 104), openTime: Date.UTC(2026, 5, 24, 16, 0) }
    ];
    const signals: (TradingViewSignal | undefined)[] = ["buy", undefined];

    const result = runFixedRiskSignalBacktest({
      symbol: "MUUSDT",
      rows,
      signals,
      initialEquityUsdt: 100,
      riskFraction: 0.1,
      riskRewardRatio: 1.5,
      maxLeverage: 25,
      feeRate: 0
    });

    expect(result.daily).toEqual([
      { day: "2026-06-24", startEquityUsdt: 100, endEquityUsdt: 100, pnlUsdt: 0, returnPct: 0, trades: 0 },
      { day: "2026-06-25", startEquityUsdt: 100, endEquityUsdt: 115, pnlUsdt: 15, returnPct: 15, trades: 1 }
    ]);
  });

  it("halts new entries after reaching the daily profit target", () => {
    const rows = [
      row(0, 100, 98, 101),
      row(1, 103, 102, 104),
      row(2, 100, 98, 101),
      row(3, 103, 102, 104)
    ];
    const signals: (TradingViewSignal | undefined)[] = ["buy", undefined, "buy", undefined];

    const result = runFixedRiskSignalBacktest({
      symbol: "MUUSDT",
      rows,
      signals,
      initialEquityUsdt: 100,
      riskFraction: 0.1,
      riskRewardRatio: 1.5,
      maxLeverage: 25,
      feeRate: 0,
      dailyProfitTargetPct: 5
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]?.pnlUsdt).toBe(15);
    expect(result.endingEquityUsdt).toBe(115);
  });

  it("can force positions flat at the Asia Shanghai day boundary", () => {
    const rows = [
      { ...row(0, 100, 90, 101), openTime: Date.UTC(2026, 5, 24, 15, 58) },
      { ...row(1, 101, 100, 102), openTime: Date.UTC(2026, 5, 24, 15, 59) },
      { ...row(2, 102, 101, 103), openTime: Date.UTC(2026, 5, 24, 16, 0) }
    ];
    const signals: (TradingViewSignal | undefined)[] = ["buy", undefined, undefined];

    const result = runFixedRiskSignalBacktest({
      symbol: "MUUSDT",
      rows,
      signals,
      initialEquityUsdt: 100,
      riskFraction: 0.1,
      riskRewardRatio: 10,
      maxLeverage: 25,
      feeRate: 0,
      stopMode: "percent",
      stopPct: 0.1,
      forceFlatAtDayEnd: true
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({ exitReason: "day_end", exitPrice: 101 });
  });
});

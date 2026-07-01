import { describe, expect, it } from "vitest";
import {
  buildFixedRiskTradeReport,
  buildRollingWalkForwardWindows,
  buildTradeDistributionSummary,
  scoreFixedRiskBacktest,
  summarizeFixedRiskBacktest,
  summarizeParameterStability
} from "./strategyValidation";
import type { FixedRiskBacktestResult } from "./strategyResearch";

function result(overrides: Partial<FixedRiskBacktestResult>): FixedRiskBacktestResult {
  return {
    symbol: "MUUSDT",
    candles: 100,
    trades: [],
    netPnlUsdt: 0,
    endingEquityUsdt: 100,
    returnPct: 0,
    winRate: 0,
    profitFactor: 0,
    maxDrawdownPct: 0,
    maxDrawdownUsdt: 0,
    daily: [],
    avgDailyReturnPct: 0,
    minDailyReturnPct: 0,
    ...overrides
  };
}

describe("strategy validation helpers", () => {
  it("builds ordered fixed-risk trade reports with account value and R multiple", () => {
    const report = buildFixedRiskTradeReport(
      result({
        trades: [
          {
            symbol: "MUUSDT",
            direction: "long",
            entryTime: "2026-06-24T16:00:00.000Z",
            exitTime: "2026-06-24T16:07:00.000Z",
            entryPrice: 100,
            exitPrice: 106,
            stopPrice: 98,
            takeProfitPrice: 106,
            riskUsdt: 2,
            notionalUsdt: 100,
            quantity: 1,
            grossPnlUsdt: 6,
            feeUsdt: 0.2,
            pnlUsdt: 5.8,
            equityAfterUsdt: 105.8,
            exitReason: "take_profit"
          }
        ]
      })
    );

    expect(report).toEqual([
      expect.objectContaining({
        tradeNumber: 1,
        direction: "long",
        entryTimeShanghai: "2026-06-25 00:00",
        exitTimeShanghai: "2026-06-25 00:07",
        durationMinutes: 7,
        pnlUsdt: 5.8,
        equityAfterUsdt: 105.8,
        returnOnRiskR: 2.9
      })
    ]);
  });

  it("summarizes fixed-risk backtests without leaking the full trade list", () => {
    const summary = summarizeFixedRiskBacktest(
      result({
        candles: 50,
        trades: [
          {
            symbol: "MUUSDT",
            direction: "short",
            entryTime: "2026-06-24T16:00:00.000Z",
            exitTime: "2026-06-24T16:01:00.000Z",
            entryPrice: 100,
            exitPrice: 99,
            stopPrice: 101,
            takeProfitPrice: 99,
            riskUsdt: 1,
            notionalUsdt: 100,
            quantity: 1,
            grossPnlUsdt: 1,
            feeUsdt: 0,
            pnlUsdt: 1,
            equityAfterUsdt: 101,
            exitReason: "take_profit"
          }
        ],
        endingEquityUsdt: 101,
        returnPct: 1,
        winRate: 1,
        profitFactor: 999,
        avgDailyReturnPct: 0.5,
        minDailyReturnPct: 0,
        maxDrawdownPct: 0
      })
    );

    expect(summary).toEqual({
      symbol: "MUUSDT",
      candles: 50,
      trades: 1,
      endingEquityUsdt: 101,
      returnPct: 1,
      avgDailyReturnPct: 0.5,
      minDailyReturnPct: 0,
      winRate: 1,
      profitFactor: 999,
      maxDrawdownPct: 0
    });
  });

  it("penalizes tiny samples even when headline return is high", () => {
    const tinySample = scoreFixedRiskBacktest(
      result({
        trades: new Array(2).fill(undefined).map((_, index) => ({
          symbol: "MUUSDT",
          direction: "long",
          entryTime: `2026-06-24T16:0${index}:00.000Z`,
          exitTime: `2026-06-24T16:0${index + 1}:00.000Z`,
          entryPrice: 100,
          exitPrice: 110,
          stopPrice: 99,
          takeProfitPrice: 110,
          riskUsdt: 1,
          notionalUsdt: 100,
          quantity: 1,
          grossPnlUsdt: 10,
          feeUsdt: 0,
          pnlUsdt: 10,
          equityAfterUsdt: 110,
          exitReason: "take_profit"
        })),
        avgDailyReturnPct: 1,
        minDailyReturnPct: 0.5,
        profitFactor: 999,
        maxDrawdownPct: 0
      })
    );
    const broaderSample = scoreFixedRiskBacktest(
      result({
        trades: new Array(30).fill(undefined).map((_, index) => ({
          symbol: "MUUSDT",
          direction: "long",
          entryTime: `2026-06-24T16:${String(index).padStart(2, "0")}:00.000Z`,
          exitTime: `2026-06-24T16:${String(index + 1).padStart(2, "0")}:00.000Z`,
          entryPrice: 100,
          exitPrice: 101,
          stopPrice: 99,
          takeProfitPrice: 101,
          riskUsdt: 1,
          notionalUsdt: 100,
          quantity: 1,
          grossPnlUsdt: 1,
          feeUsdt: 0,
          pnlUsdt: 1,
          equityAfterUsdt: 101,
          exitReason: "take_profit"
        })),
        avgDailyReturnPct: 0.2,
        minDailyReturnPct: -0.2,
        profitFactor: 1.4,
        maxDrawdownPct: 1
      })
    );

    expect(broaderSample).toBeGreaterThan(tinySample);
  });

  it("builds rolling walk-forward windows inside the requested range", () => {
    const start = Date.UTC(2026, 0, 1);
    const windows = buildRollingWalkForwardWindows({
      startTime: start,
      endTime: start + 100 * 24 * 60 * 60 * 1000,
      trainDays: 30,
      testDays: 10,
      stepDays: 10
    });

    expect(windows).toHaveLength(7);
    expect(windows[0]).toEqual({
        index: 1,
        trainStartTime: start,
        trainEndTime: start + 30 * 24 * 60 * 60 * 1000,
        testStartTime: start + 30 * 24 * 60 * 60 * 1000,
        testEndTime: start + 40 * 24 * 60 * 60 * 1000
      });
    expect(windows.at(-1)).toEqual(
      expect.objectContaining({
        index: 7,
        trainStartTime: start + 60 * 24 * 60 * 60 * 1000,
        testEndTime: start + 100 * 24 * 60 * 60 * 1000
      })
    );
  });

  it("summarizes whether profit is concentrated in a few trades", () => {
    const summary = buildTradeDistributionSummary(
      result({
        trades: [10, 5, -2, -1].map((pnlUsdt, index) => ({
          symbol: "MUUSDT",
          direction: index % 2 === 0 ? "long" : "short",
          entryTime: `2026-06-24T16:0${index}:00.000Z`,
          exitTime: `2026-06-24T16:0${index + 1}:00.000Z`,
          entryPrice: 100,
          exitPrice: 101,
          stopPrice: 99,
          takeProfitPrice: 101,
          riskUsdt: 2,
          notionalUsdt: 100,
          quantity: 1,
          grossPnlUsdt: pnlUsdt,
          feeUsdt: 0,
          pnlUsdt,
          equityAfterUsdt: 100 + pnlUsdt,
          exitReason: pnlUsdt > 0 ? "take_profit" : "stop_loss"
        }))
      })
    );

    expect(summary).toEqual({
      trades: 4,
      winners: 2,
      losers: 2,
      totalWinUsdt: 15,
      totalLossUsdt: -3,
      netPnlUsdt: 12,
      averageTradePnlUsdt: 3,
      medianTradePnlUsdt: 2,
      top10PctProfitShare: 0.833333,
      top20PctProfitShare: 0.833333,
      largestWinUsdt: 10,
      largestLossUsdt: -2,
      profitConcentrationBlocked: true
    });
  });

  it("groups parameter stability by Range and WAE gate", () => {
    const rows = summarizeParameterStability([
      { score: 10, meetsTarget: false, config: { entryMode: "preTriggerTooltip", samplingPeriod: 50, rangeMultiplier: 2, riskFraction: 0.01, cooldownBars: 0, maxLeverage: 10, colorGate: "none", waeGate: "withDeadZone", minStopPct: 0.004, maxStopPct: 0.04 }, summary: summarizeFixedRiskBacktest(result({ trades: new Array(20).fill(undefined), returnPct: 4, maxDrawdownPct: 2, profitFactor: 1.2 })) },
      { score: 8, meetsTarget: false, config: { entryMode: "preTriggerTooltip", samplingPeriod: 50, rangeMultiplier: 2, riskFraction: 0.02, cooldownBars: 5, maxLeverage: 10, colorGate: "none", waeGate: "withDeadZone", minStopPct: 0.004, maxStopPct: 0.04 }, summary: summarizeFixedRiskBacktest(result({ trades: new Array(18).fill(undefined), returnPct: 2, maxDrawdownPct: 3, profitFactor: 1.1 })) },
      { score: -4, meetsTarget: false, config: { entryMode: "preTriggerTooltip", samplingPeriod: 75, rangeMultiplier: 3, riskFraction: 0.02, cooldownBars: 5, maxLeverage: 10, colorGate: "none", waeGate: "withExplosion", minStopPct: 0.004, maxStopPct: 0.04 }, summary: summarizeFixedRiskBacktest(result({ trades: new Array(12).fill(undefined), returnPct: -5, maxDrawdownPct: 7, profitFactor: 0.8 })) }
    ]);

    expect(rows).toEqual([
      {
        key: "period=50 multiplier=2 waeGate=withDeadZone",
        samplingPeriod: 50,
        rangeMultiplier: 2,
        waeGate: "withDeadZone",
        samples: 2,
        positiveReturnSamples: 2,
        targetSamples: 0,
        avgScore: 9,
        avgReturnPct: 3,
        avgMaxDrawdownPct: 2.5,
        avgProfitFactor: 1.15,
        avgTrades: 19,
        bestScore: 10
      },
      expect.objectContaining({
        key: "period=75 multiplier=3 waeGate=withExplosion",
        avgScore: -4,
        positiveReturnSamples: 0
      })
    ]);
  });
});

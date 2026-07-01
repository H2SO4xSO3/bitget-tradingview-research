import { describe, expect, it } from "vitest";
import { buildFixedRiskTradeReport, scoreFixedRiskBacktest, summarizeFixedRiskBacktest } from "./strategyValidation";
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
});

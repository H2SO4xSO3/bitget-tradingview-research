import { runFixedRiskPreTriggerBacktest, type FixedRiskBacktestResult, type FixedRiskPreTriggerBacktestOptions } from "./strategyResearch";
import { computeFramaChannelSeries, computeRangeFilterSeries, computeWaddahAttarExplosionSeries } from "./tradingViewIndicators";
import type { ParsedKline } from "./types";

export type WaePreTriggerGate = NonNullable<FixedRiskPreTriggerBacktestOptions["waeGate"]>;
export type FixedRiskColorGate = NonNullable<FixedRiskPreTriggerBacktestOptions["colorGate"]>;

export interface WaeSettings {
  sensitivity: number;
  fastLength: number;
  slowLength: number;
  channelLength: number;
  bbMultiplier: number;
  deadZoneLength: number;
  deadZoneMultiplier: number;
}

export interface WaePreTriggerStrategyConfig {
  entryMode: "preTriggerTooltip";
  samplingPeriod: number;
  rangeMultiplier: number;
  riskFraction: number;
  cooldownBars: number;
  maxLeverage: number;
  colorGate: FixedRiskColorGate;
  waeGate: WaePreTriggerGate;
  minStopPct: number;
  maxStopPct: number;
  dailyProfitTargetPct?: number;
  dailyLossLimitPct?: number;
  framaLength?: number;
  framaBandsDistance?: number;
  wae?: WaeSettings;
  maintenanceMarginRate?: number;
  forceFlatAtDayEnd?: boolean;
}

export interface FixedRiskBacktestSummary {
  symbol: string;
  candles: number;
  trades: number;
  endingEquityUsdt: number;
  returnPct: number;
  avgDailyReturnPct: number;
  minDailyReturnPct: number;
  winRate: number;
  profitFactor: number;
  maxDrawdownPct: number;
}

export interface FixedRiskTradeReportRow {
  tradeNumber: number;
  symbol: string;
  direction: "long" | "short";
  entryTime: string;
  entryTimeShanghai: string;
  exitTime: string;
  exitTimeShanghai: string;
  durationMinutes: number;
  entryPrice: number;
  exitPrice: number;
  stopPrice: number;
  takeProfitPrice: number;
  riskUsdt: number;
  notionalUsdt: number;
  quantity: number;
  grossPnlUsdt: number;
  feeUsdt: number;
  pnlUsdt: number;
  returnOnRiskR: number;
  equityAfterUsdt: number;
  exitReason: string;
}

export interface WaePreTriggerSearchSpace {
  rangePeriods: readonly number[];
  rangeMultipliers: readonly number[];
  riskFractions: readonly number[];
  cooldownBars: readonly number[];
  maxLeverages: readonly number[];
  stopFilters: readonly { minStopPct: number; maxStopPct: number }[];
  colorGates: readonly FixedRiskColorGate[];
  waeGates: readonly WaePreTriggerGate[];
  dailyGates: readonly { dailyProfitTargetPct?: number; dailyLossLimitPct?: number }[];
}

export interface WaePreTriggerSearchCandidate {
  rank: number;
  score: number;
  meetsTarget: boolean;
  config: WaePreTriggerStrategyConfig;
  summary: FixedRiskBacktestSummary;
}

export interface WaePreTriggerSearchResult {
  tested: number;
  best?: WaePreTriggerSearchCandidate;
  bestWithMinTrades?: WaePreTriggerSearchCandidate;
  matches: WaePreTriggerSearchCandidate[];
  top: WaePreTriggerSearchCandidate[];
}

export const DEFAULT_WAE_SETTINGS: WaeSettings = {
  sensitivity: 150,
  fastLength: 20,
  slowLength: 40,
  channelLength: 20,
  bbMultiplier: 2,
  deadZoneLength: 100,
  deadZoneMultiplier: 3.7
};

export const DEFAULT_WAE_PRETRIGGER_CONFIG: WaePreTriggerStrategyConfig = {
  entryMode: "preTriggerTooltip",
  samplingPeriod: 125,
  rangeMultiplier: 2,
  riskFraction: 0.02,
  cooldownBars: 15,
  maxLeverage: 10,
  colorGate: "none",
  waeGate: "withDeadZone",
  minStopPct: 0.004,
  maxStopPct: 0.04,
  dailyProfitTargetPct: 2,
  dailyLossLimitPct: 2,
  framaLength: 26,
  framaBandsDistance: 1.5,
  wae: DEFAULT_WAE_SETTINGS,
  maintenanceMarginRate: 0.005
};

export const DEFAULT_WAE_PRETRIGGER_SEARCH_SPACE: WaePreTriggerSearchSpace = {
  rangePeriods: [50, 75, 100, 125],
  rangeMultipliers: [2, 2.5, 3, 3.5],
  riskFractions: [0.005, 0.01, 0.02],
  cooldownBars: [0, 5, 15],
  maxLeverages: [10, 25],
  stopFilters: [
    { minStopPct: 0.0015, maxStopPct: 0.02 },
    { minStopPct: 0.0025, maxStopPct: 0.03 },
    { minStopPct: 0.004, maxStopPct: 0.04 }
  ],
  colorGates: ["none", "withTrend"],
  waeGates: ["withDeadZone", "withExplosion", "withRisingExplosion"],
  dailyGates: [{}, { dailyProfitTargetPct: 2, dailyLossLimitPct: 2 }, { dailyProfitTargetPct: 3, dailyLossLimitPct: 2 }]
};

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

function round(value: number, digits = 4): number {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : value;
}

function formatShanghai(isoTime: string): string {
  const timestamp = Date.parse(isoTime);
  if (!Number.isFinite(timestamp)) {
    return isoTime;
  }
  return new Date(timestamp + SHANGHAI_OFFSET_MS).toISOString().slice(0, 16).replace("T", " ");
}

function withDefaultConfig(config: WaePreTriggerStrategyConfig): Required<Pick<WaePreTriggerStrategyConfig, "framaLength" | "framaBandsDistance" | "wae">> & WaePreTriggerStrategyConfig {
  return {
    ...config,
    framaLength: config.framaLength ?? 26,
    framaBandsDistance: config.framaBandsDistance ?? 1.5,
    wae: { ...DEFAULT_WAE_SETTINGS, ...(config.wae ?? {}) }
  };
}

export function summarizeFixedRiskBacktest(result: FixedRiskBacktestResult): FixedRiskBacktestSummary {
  return {
    symbol: result.symbol,
    candles: result.candles,
    trades: result.trades.length,
    endingEquityUsdt: round(result.endingEquityUsdt, 6),
    returnPct: round(result.returnPct, 6),
    avgDailyReturnPct: round(result.avgDailyReturnPct, 6),
    minDailyReturnPct: round(result.minDailyReturnPct, 6),
    winRate: round(result.winRate, 6),
    profitFactor: round(result.profitFactor, 6),
    maxDrawdownPct: round(result.maxDrawdownPct, 6)
  };
}

export function buildFixedRiskTradeReport(result: FixedRiskBacktestResult): FixedRiskTradeReportRow[] {
  return result.trades.map((trade, index) => ({
    tradeNumber: index + 1,
    symbol: trade.symbol,
    direction: trade.direction,
    entryTime: trade.entryTime,
    entryTimeShanghai: formatShanghai(trade.entryTime),
    exitTime: trade.exitTime,
    exitTimeShanghai: formatShanghai(trade.exitTime),
    durationMinutes: round((Date.parse(trade.exitTime) - Date.parse(trade.entryTime)) / 60_000, 2),
    entryPrice: round(trade.entryPrice, 8),
    exitPrice: round(trade.exitPrice, 8),
    stopPrice: round(trade.stopPrice, 8),
    takeProfitPrice: round(trade.takeProfitPrice, 8),
    riskUsdt: round(trade.riskUsdt, 6),
    notionalUsdt: round(trade.notionalUsdt, 6),
    quantity: round(trade.quantity, 8),
    grossPnlUsdt: round(trade.grossPnlUsdt, 6),
    feeUsdt: round(trade.feeUsdt, 6),
    pnlUsdt: round(trade.pnlUsdt, 6),
    returnOnRiskR: round(trade.riskUsdt > 0 ? trade.pnlUsdt / trade.riskUsdt : 0, 6),
    equityAfterUsdt: round(trade.equityAfterUsdt, 6),
    exitReason: trade.exitReason
  }));
}

export function scoreFixedRiskBacktest(result: FixedRiskBacktestResult): number {
  const minTrades = 30;
  const cappedProfitFactor = Math.min(result.profitFactor, 3);
  const tradePenalty = result.trades.length < minTrades ? (minTrades - result.trades.length) * 8 : 0;
  const instabilityPenalty = result.minDailyReturnPct < -5 ? Math.abs(result.minDailyReturnPct + 5) * 6 : 0;
  return round(
    result.avgDailyReturnPct * 8 +
      result.minDailyReturnPct * 3 +
      cappedProfitFactor * 15 -
      result.maxDrawdownPct * 0.6 -
      tradePenalty -
      instabilityPenalty,
    6
  );
}

export function meetsResearchTarget(result: FixedRiskBacktestResult): boolean {
  return (
    result.avgDailyReturnPct >= 2 &&
    result.minDailyReturnPct >= -2 &&
    result.trades.length >= 30 &&
    result.maxDrawdownPct <= 35 &&
    result.profitFactor >= 1.15
  );
}

export function runWaePreTriggerBacktest(options: {
  symbol: string;
  rows: ParsedKline[];
  config: WaePreTriggerStrategyConfig;
  initialEquityUsdt: number;
  feeRate: number;
  tradeStartTime?: number;
}): FixedRiskBacktestResult {
  const config = withDefaultConfig(options.config);
  const range = computeRangeFilterSeries(options.rows, {
    samplingPeriod: config.samplingPeriod,
    rangeMultiplier: config.rangeMultiplier
  });
  const frama = computeFramaChannelSeries(options.rows, {
    length: config.framaLength,
    bandsDistance: config.framaBandsDistance
  });
  const wae = computeWaddahAttarExplosionSeries(options.rows, {
    sensitivity: config.wae.sensitivity,
    fastLength: config.wae.fastLength,
    slowLength: config.wae.slowLength,
    channelLength: config.wae.channelLength,
    bbMultiplier: config.wae.bbMultiplier,
    deadZoneLength: config.wae.deadZoneLength,
    deadZoneMultiplier: config.wae.deadZoneMultiplier
  });

  return runFixedRiskPreTriggerBacktest({
    symbol: options.symbol,
    rows: options.rows,
    range,
    frama,
    wae,
    colorGate: config.colorGate,
    waeGate: config.waeGate,
    initialEquityUsdt: options.initialEquityUsdt,
    riskFraction: config.riskFraction,
    maxLeverage: config.maxLeverage,
    feeRate: options.feeRate,
    tradeStartTime: options.tradeStartTime,
    minStopPct: config.minStopPct,
    maxStopPct: config.maxStopPct,
    cooldownBars: config.cooldownBars,
    maintenanceMarginRate: config.maintenanceMarginRate,
    dailyProfitTargetPct: config.dailyProfitTargetPct,
    dailyLossLimitPct: config.dailyLossLimitPct,
    forceFlatAtDayEnd: config.forceFlatAtDayEnd
  });
}

export function searchWaePreTriggerStrategies(options: {
  symbol: string;
  rows: ParsedKline[];
  initialEquityUsdt: number;
  feeRate: number;
  tradeStartTime?: number;
  searchSpace?: WaePreTriggerSearchSpace;
  topLimit?: number;
  onProgress?: (progress: { tested: number; samplingPeriod: number; rangeMultiplier: number; bestScore?: number }) => void;
}): WaePreTriggerSearchResult {
  const searchSpace = options.searchSpace ?? DEFAULT_WAE_PRETRIGGER_SEARCH_SPACE;
  const topLimit = options.topLimit ?? 50;
  const frama = computeFramaChannelSeries(options.rows, { length: 26, bandsDistance: 1.5 });
  const wae = computeWaddahAttarExplosionSeries(options.rows, DEFAULT_WAE_SETTINGS);
  const kept: Array<Omit<WaePreTriggerSearchCandidate, "rank">> = [];
  let tested = 0;

  function keep(candidate: Omit<WaePreTriggerSearchCandidate, "rank">): void {
    kept.push(candidate);
    kept.sort((left, right) => {
      if (left.meetsTarget !== right.meetsTarget) {
        return left.meetsTarget ? -1 : 1;
      }
      return right.score - left.score;
    });
    kept.splice(topLimit);
  }

  for (const samplingPeriod of searchSpace.rangePeriods) {
    for (const rangeMultiplier of searchSpace.rangeMultipliers) {
      const range = computeRangeFilterSeries(options.rows, { samplingPeriod, rangeMultiplier });
      for (const riskFraction of searchSpace.riskFractions) {
        for (const cooldownBars of searchSpace.cooldownBars) {
          for (const maxLeverage of searchSpace.maxLeverages) {
            for (const colorGate of searchSpace.colorGates) {
              for (const waeGate of searchSpace.waeGates) {
                for (const stopFilter of searchSpace.stopFilters) {
                  for (const dailyGate of searchSpace.dailyGates) {
                    tested += 1;
                    const config: WaePreTriggerStrategyConfig = {
                      entryMode: "preTriggerTooltip",
                      samplingPeriod,
                      rangeMultiplier,
                      riskFraction,
                      cooldownBars,
                      maxLeverage,
                      colorGate,
                      waeGate,
                      ...stopFilter,
                      ...dailyGate,
                      framaLength: 26,
                      framaBandsDistance: 1.5,
                      wae: DEFAULT_WAE_SETTINGS,
                      maintenanceMarginRate: 0.005
                    };
                    const result = runFixedRiskPreTriggerBacktest({
                      symbol: options.symbol,
                      rows: options.rows,
                      range,
                      frama,
                      wae,
                      colorGate,
                      waeGate,
                      initialEquityUsdt: options.initialEquityUsdt,
                      riskFraction,
                      maxLeverage,
                      feeRate: options.feeRate,
                      tradeStartTime: options.tradeStartTime,
                      minStopPct: stopFilter.minStopPct,
                      maxStopPct: stopFilter.maxStopPct,
                      cooldownBars,
                      maintenanceMarginRate: 0.005,
                      ...dailyGate
                    });
                    keep({
                      score: scoreFixedRiskBacktest(result),
                      meetsTarget: meetsResearchTarget(result),
                      config,
                      summary: summarizeFixedRiskBacktest(result)
                    });
                  }
                }
              }
            }
          }
        }
      }
      options.onProgress?.({
        tested,
        samplingPeriod,
        rangeMultiplier,
        bestScore: kept[0]?.score
      });
    }
  }

  const ranked = kept.map((candidate, index) => ({ rank: index + 1, ...candidate }));
  return {
    tested,
    best: ranked[0],
    bestWithMinTrades: ranked.find((candidate) => candidate.summary.trades >= 30),
    matches: ranked.filter((candidate) => candidate.meetsTarget),
    top: ranked
  };
}

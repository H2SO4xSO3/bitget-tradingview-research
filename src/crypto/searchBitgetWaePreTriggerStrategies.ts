import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fetchBitgetHistoryCandles } from "./bitgetClient";
import { computeFramaChannelSeries, computeRangeFilterSeries, computeWaddahAttarExplosionSeries } from "./tradingViewIndicators";
import { runFixedRiskPreTriggerBacktest, type FixedRiskBacktestResult } from "./strategyResearch";

function numberFromEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function timeFromEnv(name: string): number | undefined {
  const value = process.env[name];
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

interface CandidateSummary {
  rank: number;
  score: number;
  meetsTarget: boolean;
  config: Record<string, unknown>;
  trades: number;
  endingEquityUsdt: number;
  returnPct: number;
  avgDailyReturnPct: number;
  minDailyReturnPct: number;
  winRate: number;
  profitFactor: number;
  maxDrawdownPct: number;
  daily: FixedRiskBacktestResult["daily"];
}

const symbol = process.env.BITGET_SYMBOL ?? "MUUSDT";
const productType = process.env.BITGET_PRODUCT_TYPE ?? "USDT-FUTURES";
const granularity = process.env.BITGET_GRANULARITY ?? "1m";
const days = numberFromEnv("BITGET_BACKTEST_DAYS", 180);
const warmupDays = numberFromEnv("BITGET_WARMUP_DAYS", 3);
const initialEquityUsdt = numberFromEnv("BITGET_INITIAL_EQUITY_USDT", 100);
const feeRate = numberFromEnv("BITGET_FEE_RATE", 0.0006);
const requestDelayMs = numberFromEnv("BITGET_REQUEST_DELAY_MS", 150);
const endTime = timeFromEnv("BITGET_BACKTEST_END_TIME") ?? Date.now();
const startTime = timeFromEnv("BITGET_BACKTEST_START_TIME") ?? endTime - days * 24 * 60 * 60 * 1000;
const warmupStartTime = startTime - warmupDays * 24 * 60 * 60 * 1000;
const outputPath = process.env.BITGET_WAE_PRETRIGGER_SEARCH_PATH ?? "data/bitget-muusdt-wae-pretrigger-fixed-risk-search.json";

const rows = await fetchBitgetHistoryCandles({
  symbol,
  productType,
  granularity,
  startTime: warmupStartTime,
  endTime,
  requestDelayMs
});

const frama = computeFramaChannelSeries(rows, { length: 26, bandsDistance: 1.5 });
const wae = computeWaddahAttarExplosionSeries(rows, {
  sensitivity: numberFromEnv("BITGET_WAE_SENSITIVITY", 150),
  fastLength: numberFromEnv("BITGET_WAE_FAST_LENGTH", 20),
  slowLength: numberFromEnv("BITGET_WAE_SLOW_LENGTH", 40),
  channelLength: numberFromEnv("BITGET_WAE_CHANNEL_LENGTH", 20),
  bbMultiplier: numberFromEnv("BITGET_WAE_BB_MULTIPLIER", 2),
  deadZoneLength: numberFromEnv("BITGET_WAE_DEAD_ZONE_LENGTH", 100),
  deadZoneMultiplier: numberFromEnv("BITGET_WAE_DEAD_ZONE_MULTIPLIER", 3.7)
});

const rangePeriods = [50, 75, 100, 125];
const rangeMultipliers = [2, 2.5, 3, 3.5];
const riskFractions = [0.005, 0.01, 0.02];
const cooldownBars = [0, 5, 15];
const maxLeverages = [10, 25];
const stopFilters = [
  { minStopPct: 0.0015, maxStopPct: 0.02 },
  { minStopPct: 0.0025, maxStopPct: 0.03 },
  { minStopPct: 0.004, maxStopPct: 0.04 }
];
const colorGates = ["none", "withTrend"] as const;
const waeGates = ["withExplosion", "withRisingExplosion"] as const;
const dailyGates = [
  {},
  { dailyProfitTargetPct: 2, dailyLossLimitPct: 2 },
  { dailyProfitTargetPct: 3, dailyLossLimitPct: 2 }
];

function scoreResult(result: FixedRiskBacktestResult): number {
  const minTrades = 30;
  const cappedProfitFactor = Math.min(result.profitFactor, 3);
  const tradePenalty = result.trades.length < minTrades ? (minTrades - result.trades.length) * 8 : 0;
  const instabilityPenalty = result.minDailyReturnPct < -5 ? Math.abs(result.minDailyReturnPct + 5) * 6 : 0;
  return (
    result.avgDailyReturnPct * 8 +
    result.minDailyReturnPct * 3 +
    cappedProfitFactor * 15 -
    result.maxDrawdownPct * 0.6 -
    tradePenalty -
    instabilityPenalty
  );
}

function summarize(config: Record<string, unknown>, result: FixedRiskBacktestResult): Omit<CandidateSummary, "rank"> {
  const meetsTarget =
    result.avgDailyReturnPct >= 2 &&
    result.minDailyReturnPct >= -2 &&
    result.trades.length >= 30 &&
    result.maxDrawdownPct <= 35 &&
    result.profitFactor >= 1.15;
  return {
    score: scoreResult(result),
    meetsTarget,
    config,
    trades: result.trades.length,
    endingEquityUsdt: result.endingEquityUsdt,
    returnPct: result.returnPct,
    avgDailyReturnPct: result.avgDailyReturnPct,
    minDailyReturnPct: result.minDailyReturnPct,
    winRate: result.winRate,
    profitFactor: result.profitFactor,
    maxDrawdownPct: result.maxDrawdownPct,
    daily: result.daily
  };
}

const bestCandidates: Omit<CandidateSummary, "rank">[] = [];
const targetMatches: Omit<CandidateSummary, "rank">[] = [];
let tested = 0;

function keepCandidate(candidate: Omit<CandidateSummary, "rank">): void {
  if (candidate.meetsTarget) {
    targetMatches.push(candidate);
  }
  bestCandidates.push(candidate);
  bestCandidates.sort((left, right) => {
    if (left.meetsTarget !== right.meetsTarget) {
      return left.meetsTarget ? -1 : 1;
    }
    return right.score - left.score;
  });
  bestCandidates.splice(100);
}

for (const samplingPeriod of rangePeriods) {
  for (const rangeMultiplier of rangeMultipliers) {
    const range = computeRangeFilterSeries(rows, { samplingPeriod, rangeMultiplier });
    for (const riskFraction of riskFractions) {
      for (const cooldown of cooldownBars) {
        for (const maxLeverage of maxLeverages) {
          for (const colorGate of colorGates) {
            for (const waeGate of waeGates) {
              for (const stopFilter of stopFilters) {
                for (const dailyGate of dailyGates) {
                  tested += 1;
                  const config = {
                    entryMode: "preTriggerTooltip",
                    samplingPeriod,
                    rangeMultiplier,
                    riskFraction,
                    cooldown,
                    maxLeverage,
                    colorGate,
                    waeGate,
                    wae: {
                      sensitivity: numberFromEnv("BITGET_WAE_SENSITIVITY", 150),
                      fastLength: numberFromEnv("BITGET_WAE_FAST_LENGTH", 20),
                      slowLength: numberFromEnv("BITGET_WAE_SLOW_LENGTH", 40),
                      channelLength: numberFromEnv("BITGET_WAE_CHANNEL_LENGTH", 20),
                      bbMultiplier: numberFromEnv("BITGET_WAE_BB_MULTIPLIER", 2),
                      deadZoneLength: numberFromEnv("BITGET_WAE_DEAD_ZONE_LENGTH", 100),
                      deadZoneMultiplier: numberFromEnv("BITGET_WAE_DEAD_ZONE_MULTIPLIER", 3.7)
                    },
                    ...stopFilter,
                    ...dailyGate
                  };
                  const result = runFixedRiskPreTriggerBacktest({
                    symbol,
                    rows,
                    range,
                    frama,
                    wae,
                    colorGate,
                    waeGate,
                    initialEquityUsdt,
                    riskFraction,
                    maxLeverage,
                    feeRate,
                    tradeStartTime: startTime,
                    minStopPct: stopFilter.minStopPct,
                    maxStopPct: stopFilter.maxStopPct,
                    cooldownBars: cooldown,
                    maintenanceMarginRate: 0.005,
                    ...dailyGate
                  });
                  keepCandidate(summarize(config, result));
                }
              }
            }
          }
        }
      }
    }
  }
}

const ranked = bestCandidates.map((candidate, index) => ({ rank: index + 1, ...candidate }));
const matches = targetMatches
  .sort((left, right) => right.score - left.score)
  .slice(0, 50)
  .map((candidate, index) => ({ rank: index + 1, ...candidate }));

const report = {
  generatedAt: new Date().toISOString(),
  exchange: "bitget",
  productType,
  symbol,
  granularity,
  startTime: new Date(startTime).toISOString(),
  endTime: new Date(endTime).toISOString(),
  warmupStartTime: new Date(warmupStartTime).toISOString(),
  sourceCandles: rows.length,
  tradingCandles: rows.filter((row) => row.openTime >= startTime).length,
  tested,
  strategy: {
    entryMode: "preTriggerTooltip + WAE",
    entryRule:
      "Touch previous Range Filter high/low band before the confirmed label, then require previous closed WAE column to break the ExplosionLine and DeadZone in the same direction.",
    exitRule: "Use the clean Pine tooltip style Range/FRAMA stop and take-profit levels; stop is conservative when stop and target touch in the same candle.",
    sizing: "Fixed fraction of equity at risk per trade, capped by max leverage."
  },
  target: {
    avgDailyReturnPctGte: 2,
    minDailyReturnPctGte: -2,
    maxDrawdownPctLte: 35,
    minTrades: 30,
    profitFactorGte: 1.15
  },
  best: ranked[0],
  bestWithMinTrades: ranked.find((candidate) => candidate.trades >= 30),
  matches,
  top: ranked
};

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
if (process.env.BITGET_STRATEGY_SEARCH_SILENT !== "1") {
  console.log(JSON.stringify(report, null, 2));
}

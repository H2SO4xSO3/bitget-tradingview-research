import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fetchBitgetHistoryCandles } from "./bitgetClient";
import { runFixedRiskPreTriggerBacktest, type FixedRiskBacktestResult } from "./strategyResearch";
import { computeFramaChannelSeries, computeRangeFilterSeries, computeWaddahAttarExplosionSeries } from "./tradingViewIndicators";
import { buildWaeForwardReturnSummaries, type WaeAblationGate } from "./waeAblation";

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

function optionalNumberFromEnv(name: string): number | undefined {
  const value = process.env[name];
  if (value === undefined || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function summarizeBacktest(gate: WaeAblationGate | "none", result: FixedRiskBacktestResult) {
  return {
    gate,
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
const outputPath = process.env.BITGET_WAE_ABLATION_PATH ?? "data/bitget-muusdt-wae-ablation-180d.json";

const config = {
  samplingPeriod: numberFromEnv("BITGET_RANGE_SAMPLING_PERIOD", 125),
  rangeMultiplier: numberFromEnv("BITGET_RANGE_MULTIPLIER", 2),
  riskFraction: numberFromEnv("BITGET_RISK_FRACTION", 0.005),
  cooldownBars: numberFromEnv("BITGET_COOLDOWN_BARS", 5),
  maxLeverage: numberFromEnv("BITGET_MAX_LEVERAGE", 10),
  colorGate: process.env.BITGET_COLOR_GATE === "withTrend" ? "withTrend" : "none",
  minStopPct: optionalNumberFromEnv("BITGET_MIN_STOP_PCT") ?? 0.004,
  maxStopPct: optionalNumberFromEnv("BITGET_MAX_STOP_PCT") ?? 0.04,
  dailyProfitTargetPct: optionalNumberFromEnv("BITGET_DAILY_PROFIT_TARGET_PCT"),
  dailyLossLimitPct: optionalNumberFromEnv("BITGET_DAILY_LOSS_LIMIT_PCT")
} as const;

console.error(
  JSON.stringify({
    event: "fetch_start",
    symbol,
    granularity,
    startTime: new Date(warmupStartTime).toISOString(),
    endTime: new Date(endTime).toISOString(),
    requestDelayMs
  })
);
const rows = await fetchBitgetHistoryCandles({
  symbol,
  productType,
  granularity,
  startTime: warmupStartTime,
  endTime,
  requestDelayMs
});
console.error(JSON.stringify({ event: "fetch_done", candles: rows.length }));

const range = computeRangeFilterSeries(rows, { samplingPeriod: config.samplingPeriod, rangeMultiplier: config.rangeMultiplier });
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

const gates = ["none", "withDeadZone", "withExplosion", "withRisingExplosion"] as const;
const backtests = gates.map((gate) => {
  const result = runFixedRiskPreTriggerBacktest({
    symbol,
    rows,
    range,
    frama,
    wae,
    waeGate: gate,
    colorGate: config.colorGate,
    initialEquityUsdt,
    riskFraction: config.riskFraction,
    maxLeverage: config.maxLeverage,
    feeRate,
    tradeStartTime: startTime,
    minStopPct: config.minStopPct,
    maxStopPct: config.maxStopPct,
    cooldownBars: config.cooldownBars,
    maintenanceMarginRate: 0.005,
    dailyProfitTargetPct: config.dailyProfitTargetPct,
    dailyLossLimitPct: config.dailyLossLimitPct
  });
  return summarizeBacktest(gate, result);
});

const forwardReturns = buildWaeForwardReturnSummaries({
  rows,
  wae,
  gates: ["withDeadZone", "withExplosion", "withRisingExplosion"],
  horizons: [1, 3, 5, 7],
  tradeStartTime: startTime
});

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
  fixedConfig: config,
  backtests,
  forwardReturns
};

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));

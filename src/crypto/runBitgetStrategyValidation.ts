import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadOrFetchCandles } from "./bitgetCandleCache";
import { fetchBitgetHistoryCandles } from "./bitgetClient";
import {
  DEFAULT_WAE_PRETRIGGER_CONFIG,
  buildFixedRiskTradeReport,
  buildRollingWalkForwardWindows,
  buildTradeDistributionSummary,
  runWaePreTriggerBacktest,
  searchWaePreTriggerStrategies,
  summarizeFixedRiskBacktest
} from "./strategyValidation";
import type { WaePreTriggerSearchCandidate } from "./strategyValidation";

const DAY_MS = 24 * 60 * 60 * 1000;

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

function symbolsFromEnv(): string[] {
  const values = (process.env.BITGET_SYMBOLS ?? process.env.BITGET_SYMBOL ?? "MUUSDT")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  return [...new Set(values)];
}

function defaultOutputPath(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `data/bitget-strategy-validation-${stamp}.json`;
}

function compactCandidate(candidate: WaePreTriggerSearchCandidate | undefined): WaePreTriggerSearchCandidate | undefined {
  return candidate;
}

function shouldRunWalkForward(symbol: string, index: number): boolean {
  if (process.env.BITGET_WALK_FORWARD === "0") {
    return false;
  }
  const setting = process.env.BITGET_WALK_FORWARD_SYMBOLS ?? "first";
  if (setting === "all") {
    return true;
  }
  if (setting === "first") {
    return index === 0;
  }
  return setting
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .includes(symbol);
}

function shouldRunRollingWalkForward(symbol: string, index: number): boolean {
  if (process.env.BITGET_ROLLING_WALK_FORWARD !== "1") {
    return false;
  }
  const setting = process.env.BITGET_ROLLING_WALK_FORWARD_SYMBOLS ?? "first";
  if (setting === "all") {
    return true;
  }
  if (setting === "first") {
    return index === 0;
  }
  return setting
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .includes(symbol);
}

const productType = process.env.BITGET_PRODUCT_TYPE ?? "USDT-FUTURES";
const granularity = process.env.BITGET_GRANULARITY ?? "1m";
const days = numberFromEnv("BITGET_BACKTEST_DAYS", 180);
const warmupDays = numberFromEnv("BITGET_WARMUP_DAYS", 3);
const initialEquityUsdt = numberFromEnv("BITGET_INITIAL_EQUITY_USDT", 100);
const feeRate = numberFromEnv("BITGET_FEE_RATE", 0.0006);
const requestDelayMs = numberFromEnv("BITGET_REQUEST_DELAY_MS", 150);
const endTime = timeFromEnv("BITGET_BACKTEST_END_TIME") ?? Date.now();
const startTime = timeFromEnv("BITGET_BACKTEST_START_TIME") ?? endTime - days * DAY_MS;
const warmupStartTime = startTime - warmupDays * DAY_MS;
const trainDays = numberFromEnv("BITGET_WALK_FORWARD_TRAIN_DAYS", Math.max(1, Math.floor(days / 2)));
const testDays = numberFromEnv("BITGET_WALK_FORWARD_TEST_DAYS", Math.max(1, days - trainDays));
const rollingTrainDays = numberFromEnv("BITGET_ROLLING_TRAIN_DAYS", 30);
const rollingTestDays = numberFromEnv("BITGET_ROLLING_TEST_DAYS", 15);
const rollingStepDays = numberFromEnv("BITGET_ROLLING_STEP_DAYS", 15);
const rollingMaxWindows = numberFromEnv("BITGET_ROLLING_MAX_WINDOWS", 4);
const testStartTime = timeFromEnv("BITGET_WALK_FORWARD_TEST_START_TIME") ?? endTime - testDays * DAY_MS;
const trainEndTime = timeFromEnv("BITGET_WALK_FORWARD_TRAIN_END_TIME") ?? testStartTime;
const trainStartTime = timeFromEnv("BITGET_WALK_FORWARD_TRAIN_START_TIME") ?? Math.max(startTime, trainEndTime - trainDays * DAY_MS);
const outputPath = process.env.BITGET_STRATEGY_VALIDATION_PATH ?? defaultOutputPath();
const symbols = symbolsFromEnv();

function candleCachePath(symbol: string): string | undefined {
  if (process.env.BITGET_CANDLE_CACHE_PATH) {
    return symbols.length === 1 ? process.env.BITGET_CANDLE_CACHE_PATH : process.env.BITGET_CANDLE_CACHE_PATH.replace("{symbol}", symbol);
  }
  if (!process.env.BITGET_CANDLE_CACHE_DIR) {
    return undefined;
  }
  const safeStart = new Date(warmupStartTime).toISOString().replace(/[:.]/g, "-");
  const safeEnd = new Date(endTime).toISOString().replace(/[:.]/g, "-");
  return path.join(process.env.BITGET_CANDLE_CACHE_DIR, `${symbol}-${granularity}-${safeStart}-${safeEnd}.json`);
}

const symbolReports = [];

for (const [index, symbol] of symbols.entries()) {
  console.error(
    JSON.stringify({
      event: "fetch_start",
      symbol,
      productType,
      granularity,
      startTime: new Date(warmupStartTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
      requestDelayMs
    })
  );

  try {
    const cachePath = candleCachePath(symbol);
    const candleResult = await loadOrFetchCandles({
      cachePath,
      cacheKey: {
        exchange: "bitget",
        symbol,
        productType,
        granularity,
        warmupStartTime,
        endTime
      },
      writeCache: process.env.BITGET_WRITE_CANDLE_CACHE !== "0",
      fetchCandles: () =>
        fetchBitgetHistoryCandles({
          symbol,
          productType,
          granularity,
          startTime: warmupStartTime,
          endTime,
          requestDelayMs
        })
    });
    const rows = candleResult.rows;
    console.error(JSON.stringify({ event: "fetch_done", symbol, source: candleResult.source, candles: rows.length }));

    const fixedResult = runWaePreTriggerBacktest({
      symbol,
      rows,
      config: DEFAULT_WAE_PRETRIGGER_CONFIG,
      initialEquityUsdt,
      feeRate,
      tradeStartTime: startTime
    });

    const report: Record<string, unknown> = {
      symbol,
      candleSource: candleResult.source,
      candleCachePath: cachePath,
      sourceCandles: rows.length,
      tradingCandles: rows.filter((row) => row.openTime >= startTime).length,
      fixedBestConfig: {
        config: DEFAULT_WAE_PRETRIGGER_CONFIG,
        summary: summarizeFixedRiskBacktest(fixedResult),
        tradeDistribution: buildTradeDistributionSummary(fixedResult),
        daily: fixedResult.daily,
        trades: buildFixedRiskTradeReport(fixedResult)
      }
    };

    if (shouldRunWalkForward(symbol, index)) {
      const trainRows = rows.filter((row) => row.openTime <= trainEndTime);
      console.error(
        JSON.stringify({
          event: "walk_forward_search_start",
          symbol,
          trainStartTime: new Date(trainStartTime).toISOString(),
          trainEndTime: new Date(trainEndTime).toISOString(),
          trainCandles: trainRows.length
        })
      );
      const search = searchWaePreTriggerStrategies({
        symbol,
        rows: trainRows,
        initialEquityUsdt,
        feeRate,
        tradeStartTime: trainStartTime,
        topLimit: 25,
        onProgress: (progress) => {
          console.error(JSON.stringify({ event: "walk_forward_search_progress", symbol, ...progress }));
        }
      });
      const best = search.best;
      const validationRows = rows.filter((row) => row.openTime <= endTime);
      const validation = best
        ? runWaePreTriggerBacktest({
            symbol,
            rows: validationRows,
            config: best.config,
            initialEquityUsdt,
            feeRate,
            tradeStartTime: testStartTime
          })
        : undefined;

      report.walkForward = {
        train: {
          startTime: new Date(trainStartTime).toISOString(),
          endTime: new Date(trainEndTime).toISOString(),
          tested: search.tested,
          best: compactCandidate(best),
          bestWithMinTrades: compactCandidate(search.bestWithMinTrades),
          matches: search.matches,
          parameterStability: search.stability.slice(0, 20)
        },
        validation: validation
          ? {
              startTime: new Date(testStartTime).toISOString(),
              endTime: new Date(endTime).toISOString(),
              config: best?.config,
              summary: summarizeFixedRiskBacktest(validation),
              tradeDistribution: buildTradeDistributionSummary(validation),
              daily: validation.daily,
              trades: buildFixedRiskTradeReport(validation)
            }
          : {
              blocked: "blocked=no_train_candidate"
            },
        topTrainCandidates: search.top
      };
    }

    if (shouldRunRollingWalkForward(symbol, index)) {
      const windows = buildRollingWalkForwardWindows({
        startTime,
        endTime,
        trainDays: rollingTrainDays,
        testDays: rollingTestDays,
        stepDays: rollingStepDays
      }).slice(0, rollingMaxWindows);
      const rollingReports = [];
      for (const window of windows) {
        const trainRows = rows.filter((row) => row.openTime <= window.trainEndTime);
        console.error(
          JSON.stringify({
            event: "rolling_walk_forward_search_start",
            symbol,
            window: window.index,
            trainStartTime: new Date(window.trainStartTime).toISOString(),
            trainEndTime: new Date(window.trainEndTime).toISOString(),
            testStartTime: new Date(window.testStartTime).toISOString(),
            testEndTime: new Date(window.testEndTime).toISOString(),
            trainCandles: trainRows.length
          })
        );
        const search = searchWaePreTriggerStrategies({
          symbol,
          rows: trainRows,
          initialEquityUsdt,
          feeRate,
          tradeStartTime: window.trainStartTime,
          topLimit: 10,
          onProgress: (progress) => {
            console.error(JSON.stringify({ event: "rolling_walk_forward_search_progress", symbol, window: window.index, ...progress }));
          }
        });
        const best = search.best;
        const validationRows = rows.filter((row) => row.openTime <= window.testEndTime);
        const validation = best
          ? runWaePreTriggerBacktest({
              symbol,
              rows: validationRows,
              config: best.config,
              initialEquityUsdt,
              feeRate,
              tradeStartTime: window.testStartTime
            })
          : undefined;
        rollingReports.push({
          window: {
            index: window.index,
            trainStartTime: new Date(window.trainStartTime).toISOString(),
            trainEndTime: new Date(window.trainEndTime).toISOString(),
            testStartTime: new Date(window.testStartTime).toISOString(),
            testEndTime: new Date(window.testEndTime).toISOString()
          },
          train: {
            tested: search.tested,
            best: compactCandidate(best),
            bestWithMinTrades: compactCandidate(search.bestWithMinTrades),
            parameterStability: search.stability.slice(0, 10)
          },
          validation: validation
            ? {
                summary: summarizeFixedRiskBacktest(validation),
                tradeDistribution: buildTradeDistributionSummary(validation),
                daily: validation.daily,
                trades: buildFixedRiskTradeReport(validation)
              }
            : {
                blocked: "blocked=no_train_candidate"
              }
        });
      }
      report.rollingWalkForward = {
        trainDays: rollingTrainDays,
        testDays: rollingTestDays,
        stepDays: rollingStepDays,
        maxWindows: rollingMaxWindows,
        windows: rollingReports
      };
    }

    symbolReports.push(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ event: "symbol_failed", symbol, error: message }));
    symbolReports.push({
      symbol,
      blocked: `blocked=data_or_backtest_failed ${message}`
    });
  }
}

const generatedAt = new Date().toISOString();
const finalReport = {
  generatedAt,
  exchange: "bitget",
  productType,
  granularity,
  symbols,
  initialEquityUsdt,
  feeRate,
  startTime: new Date(startTime).toISOString(),
  endTime: new Date(endTime).toISOString(),
  warmupStartTime: new Date(warmupStartTime).toISOString(),
  strategy: {
    state: "backtest_candidate",
    rawScore: null,
    blocked: "blocked=needs_paper_forward_validation_and_slippage_funding_model",
    evidence:
      "Fixed WAE Range pre-trigger backtest plus walk-forward split. This is biased research evidence, not live readiness.",
    next_check: "Run observe-only or paper execution with real fees, slippage, funding, and missed-fill logs."
  },
  symbolReports
};

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(finalReport, null, 2)}\n`, "utf8");
console.error(JSON.stringify({ event: "validation_done", outputPath, symbols: symbols.length }));
if (process.env.BITGET_STRATEGY_VALIDATION_SILENT !== "1") {
  console.log(JSON.stringify(finalReport, null, 2));
}

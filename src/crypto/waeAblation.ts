import type { FlipDirection, WaddahAttarExplosionPoint } from "./tradingViewIndicators";
import type { ParsedKline } from "./types";

export type WaeAblationGate = "withDeadZone" | "withExplosion" | "withRisingExplosion";

export interface WaeForwardReturnSummary {
  gate: WaeAblationGate;
  horizonBars: number;
  samples: number;
  longSamples: number;
  shortSamples: number;
  winRate: number;
  avgDirectionalReturnPct: number;
  medianDirectionalReturnPct: number;
  avgWinPct: number;
  avgLossPct: number;
}

export interface BuildWaeForwardReturnSummariesOptions {
  rows: readonly ParsedKline[];
  wae: readonly (WaddahAttarExplosionPoint | undefined)[];
  gates: readonly WaeAblationGate[];
  horizons: readonly number[];
  tradeStartTime?: number;
}

export function directionForWaeGate(point: WaddahAttarExplosionPoint | undefined, gate: WaeAblationGate): FlipDirection | undefined {
  if (!point) {
    return undefined;
  }
  if (gate === "withDeadZone") {
    if (point.trendUp > point.deadZone) {
      return "long";
    }
    if (point.trendDown > point.deadZone) {
      return "short";
    }
    return undefined;
  }
  if (gate === "withRisingExplosion") {
    if (point.bullishRising) {
      return "long";
    }
    if (point.bearishRising) {
      return "short";
    }
    return undefined;
  }
  if (point.bullishExplosion) {
    return "long";
  }
  if (point.bearishExplosion) {
    return "short";
  }
  return undefined;
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function average(values: number[]): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function buildWaeForwardReturnSummaries(options: BuildWaeForwardReturnSummariesOptions): WaeForwardReturnSummary[] {
  const summaries: WaeForwardReturnSummary[] = [];
  for (const gate of options.gates) {
    for (const horizonBars of options.horizons) {
      const returns: number[] = [];
      let longSamples = 0;
      let shortSamples = 0;
      for (let index = 0; index + horizonBars < options.rows.length; index += 1) {
        const row = options.rows[index];
        if (options.tradeStartTime !== undefined && row.openTime < options.tradeStartTime) {
          continue;
        }
        const direction = directionForWaeGate(options.wae[index], gate);
        if (!direction) {
          continue;
        }
        const exit = options.rows[index + horizonBars];
        if (direction === "long") {
          longSamples += 1;
          returns.push(((exit.close - row.close) / row.close) * 100);
        } else {
          shortSamples += 1;
          returns.push(((row.close - exit.close) / row.close) * 100);
        }
      }
      const wins = returns.filter((value) => value > 0);
      const losses = returns.filter((value) => value < 0);
      summaries.push({
        gate,
        horizonBars,
        samples: returns.length,
        longSamples,
        shortSamples,
        winRate: returns.length > 0 ? wins.length / returns.length : 0,
        avgDirectionalReturnPct: average(returns),
        medianDirectionalReturnPct: median(returns),
        avgWinPct: average(wins),
        avgLossPct: average(losses)
      });
    }
  }
  return summaries;
}

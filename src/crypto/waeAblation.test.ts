import { describe, expect, it } from "vitest";
import { buildWaeForwardReturnSummaries } from "./waeAblation";
import type { WaddahAttarExplosionPoint } from "./tradingViewIndicators";
import type { ParsedKline } from "./types";

function row(index: number, close: number): ParsedKline {
  return {
    openTime: index * 60_000,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
    quoteVolume: close
  };
}

function wae(index: number, point: Partial<WaddahAttarExplosionPoint>): WaddahAttarExplosionPoint {
  return {
    openTime: index * 60_000,
    trendUp: 0,
    trendDown: 0,
    explosionLine: 5,
    deadZone: 2,
    bullishExplosion: false,
    bearishExplosion: false,
    bullishRising: false,
    bearishRising: false,
    state: "quiet",
    ...point
  };
}

describe("WAE ablation research helpers", () => {
  it("summarizes directional returns after WAE explosion signals", () => {
    const rows = [100, 110, 121, 90, 81].map((close, index) => row(index, close));
    const points = [
      wae(0, { trendUp: 10, bullishExplosion: true, bullishRising: true, state: "bullish" }),
      wae(1, {}),
      wae(2, { trendDown: 10, bearishExplosion: true, bearishRising: true, state: "bearish" }),
      wae(3, {}),
      wae(4, {})
    ];

    const summaries = buildWaeForwardReturnSummaries({
      rows,
      wae: points,
      gates: ["withExplosion"],
      horizons: [1]
    });

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      gate: "withExplosion",
      horizonBars: 1,
      samples: 2,
      longSamples: 1,
      shortSamples: 1,
      winRate: 1
    });
    expect(summaries[0].avgDirectionalReturnPct).toBeCloseTo((10 + ((121 - 90) / 121) * 100) / 2, 8);
  });

  it("can summarize dead-zone-only WAE signals separately from explosion signals", () => {
    const rows = [100, 103, 99].map((close, index) => row(index, close));
    const points = [
      wae(0, { trendUp: 4, explosionLine: 10, deadZone: 2, state: "quiet" }),
      wae(1, {}),
      wae(2, {})
    ];

    const summaries = buildWaeForwardReturnSummaries({
      rows,
      wae: points,
      gates: ["withDeadZone", "withExplosion"],
      horizons: [1]
    });

    expect(summaries.find((summary) => summary.gate === "withDeadZone")).toMatchObject({ samples: 1, longSamples: 1 });
    expect(summaries.find((summary) => summary.gate === "withExplosion")).toMatchObject({ samples: 0 });
  });
});

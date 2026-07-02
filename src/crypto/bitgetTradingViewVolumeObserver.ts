import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fetchBitgetRecentCandles } from "./bitgetClient";
import { collectBitgetMarketContext, type BitgetMarketContext, type CollectBitgetMarketContextOptions } from "./bitgetMarketData";
import {
  computeFramaChannelSeries,
  computeRangeFilterSeries,
  computeWaddahAttarExplosionSeries,
  type FramaChannelOptions,
  type RangeFilterOptions,
  type WaddahAttarExplosionOptions,
  type WaddahAttarExplosionPoint
} from "./tradingViewIndicators";
import { createTradingViewObserverState, observeTradingViewSnapshot, type TradingViewObserverState } from "./tradingViewObserver";
import { enrichTradingViewEventsWithVolume, type TradingViewVolumeObserveEvent as BaseTradingViewVolumeObserveEvent } from "./tradingViewVolumeObserver";
import type { ParsedKline } from "./types";

export type TradingViewVolumeObserveStateBySymbol = Map<string, TradingViewObserverState>;

export interface TradingViewVolumeObserveEvent extends BaseTradingViewVolumeObserveEvent {
  wae?: Pick<
    WaddahAttarExplosionPoint,
    "state" | "trendUp" | "trendDown" | "explosionLine" | "deadZone" | "bullishExplosion" | "bearishExplosion" | "bullishRising" | "bearishRising"
  >;
}

export interface ObserveTradingViewVolumeSymbolsOnceOptions {
  symbols: string[];
  productType: string;
  granularity: string;
  marketPeriod: string;
  candleLimit: number;
  observedAt: number;
  states: TradingViewVolumeObserveStateBySymbol;
  rangeOptions?: RangeFilterOptions;
  framaOptions?: FramaChannelOptions;
  waeOptions?: WaddahAttarExplosionOptions;
  fetchRecentCandles?: (options: {
    symbol: string;
    productType: string;
    granularity: string;
    limit: number;
  }) => Promise<ParsedKline[]>;
  collectMarketContext?: (options: CollectBitgetMarketContextOptions) => Promise<BitgetMarketContext>;
}

const DEFAULT_WAE_OPTIONS: WaddahAttarExplosionOptions = {
  sensitivity: 150,
  fastLength: 20,
  slowLength: 40,
  channelLength: 20,
  bbMultiplier: 2,
  deadZoneLength: 100,
  deadZoneMultiplier: 3.7
};

export function createTradingViewVolumeObserveStateBySymbol(symbols: string[]): TradingViewVolumeObserveStateBySymbol {
  return new Map(symbols.map((symbol) => [symbol, createTradingViewObserverState()]));
}

function stateForSymbol(states: TradingViewVolumeObserveStateBySymbol, symbol: string): TradingViewObserverState {
  const existing = states.get(symbol);
  if (existing) {
    return existing;
  }
  const created = createTradingViewObserverState();
  states.set(symbol, created);
  return created;
}

function waeSnapshot(point: WaddahAttarExplosionPoint | undefined): TradingViewVolumeObserveEvent["wae"] {
  if (!point) {
    return undefined;
  }
  return {
    state: point.state,
    trendUp: point.trendUp,
    trendDown: point.trendDown,
    explosionLine: point.explosionLine,
    deadZone: point.deadZone,
    bullishExplosion: point.bullishExplosion,
    bearishExplosion: point.bearishExplosion,
    bullishRising: point.bullishRising,
    bearishRising: point.bearishRising
  };
}

export async function observeTradingViewVolumeSymbolsOnce(
  options: ObserveTradingViewVolumeSymbolsOnceOptions
): Promise<TradingViewVolumeObserveEvent[]> {
  const fetchCandles = options.fetchRecentCandles ?? fetchBitgetRecentCandles;
  const collectContext = options.collectMarketContext ?? collectBitgetMarketContext;
  const rangeOptions = options.rangeOptions ?? { samplingPeriod: 100, rangeMultiplier: 3 };
  const framaOptions = options.framaOptions ?? { length: 26, bandsDistance: 1.5 };
  const waeOptions = options.waeOptions ?? DEFAULT_WAE_OPTIONS;
  const output: TradingViewVolumeObserveEvent[] = [];

  for (const symbol of options.symbols) {
    const rows = await fetchCandles({
      symbol,
      productType: options.productType,
      granularity: options.granularity,
      limit: options.candleLimit
    });
    const range = computeRangeFilterSeries(rows, rangeOptions);
    const frama = computeFramaChannelSeries(rows, framaOptions);
    const wae = computeWaddahAttarExplosionSeries(rows, waeOptions);
    const marketContext = await collectContext({
      symbol,
      productType: options.productType,
      period: options.marketPeriod
    });
    const tradingViewEvents = observeTradingViewSnapshot({
      symbol,
      rows,
      range,
      frama,
      state: stateForSymbol(options.states, symbol),
      observedAt: options.observedAt
    }).events;
    const waeByOpenTime = new Map(wae.map((point) => [point.openTime, point]));
    output.push(
      ...enrichTradingViewEventsWithVolume({
        events: tradingViewEvents,
        marketContext
      }).map((event) => ({
        ...event,
        wae: waeSnapshot(waeByOpenTime.get(event.openTime))
      }))
    );
  }

  return output;
}

export function appendTradingViewVolumeObserveEventsJsonl(outputPath: string, events: readonly TradingViewVolumeObserveEvent[]): void {
  if (events.length === 0) {
    return;
  }
  mkdirSync(path.dirname(outputPath), { recursive: true });
  appendFileSync(outputPath, events.map((event) => JSON.stringify(event)).join("\n") + "\n", "utf8");
}

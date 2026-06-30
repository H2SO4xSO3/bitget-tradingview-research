import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fetchBitgetRecentCandles } from "./bitgetClient";
import { computeFramaChannelSeries, computeRangeFilterSeries, type FramaChannelOptions, type RangeFilterOptions } from "./tradingViewIndicators";
import { createTradingViewObserverState, observeTradingViewSnapshot, type TradingViewObserveEvent, type TradingViewObserverState } from "./tradingViewObserver";
import type { ParsedKline } from "./types";

export type ObserveStateBySymbol = Map<string, TradingViewObserverState>;

export interface ObserveSymbolsOnceOptions {
  symbols: string[];
  productType: string;
  granularity: string;
  candleLimit: number;
  states: ObserveStateBySymbol;
  observedAt: number;
  rangeOptions?: RangeFilterOptions;
  framaOptions?: FramaChannelOptions;
  fetchRecentCandles?: (options: {
    symbol: string;
    productType: string;
    granularity: string;
    limit: number;
  }) => Promise<ParsedKline[]>;
}

export function createObserveStateBySymbol(symbols: string[]): ObserveStateBySymbol {
  return new Map(symbols.map((symbol) => [symbol, createTradingViewObserverState()]));
}

function stateForSymbol(states: ObserveStateBySymbol, symbol: string): TradingViewObserverState {
  const existing = states.get(symbol);
  if (existing) {
    return existing;
  }
  const created = createTradingViewObserverState();
  states.set(symbol, created);
  return created;
}

export async function observeSymbolsOnce(options: ObserveSymbolsOnceOptions): Promise<TradingViewObserveEvent[]> {
  const fetchCandles = options.fetchRecentCandles ?? fetchBitgetRecentCandles;
  const rangeOptions = options.rangeOptions ?? { samplingPeriod: 100, rangeMultiplier: 3 };
  const framaOptions = options.framaOptions ?? { length: 26, bandsDistance: 1.5 };
  const events: TradingViewObserveEvent[] = [];

  for (const symbol of options.symbols) {
    const rows = await fetchCandles({
      symbol,
      productType: options.productType,
      granularity: options.granularity,
      limit: options.candleLimit
    });
    const range = computeRangeFilterSeries(rows, rangeOptions);
    const frama = computeFramaChannelSeries(rows, framaOptions);
    events.push(
      ...observeTradingViewSnapshot({
        symbol,
        rows,
        range,
        frama,
        state: stateForSymbol(options.states, symbol),
        observedAt: options.observedAt
      }).events
    );
  }

  return events;
}

export function appendObserveEventsJsonl(outputPath: string, events: TradingViewObserveEvent[]): void {
  if (events.length === 0) {
    return;
  }
  mkdirSync(path.dirname(outputPath), { recursive: true });
  appendFileSync(outputPath, events.map((event) => JSON.stringify(event)).join("\n") + "\n", "utf8");
}

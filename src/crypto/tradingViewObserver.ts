import type { FlipDirection, FramaChannelPoint, RangeFilterPoint, TradingViewSignal } from "./tradingViewIndicators";
import type { ParsedKline } from "./types";

export type TradingViewObserveEventType =
  | "pre_buy"
  | "pre_sell"
  | "confirmed_buy"
  | "confirmed_sell"
  | "false_preview"
  | "tp_hit"
  | "sl_hit"
  | "tp_sl_ambiguous";

export interface TradingViewObserveEvent {
  type: TradingViewObserveEventType;
  symbol: string;
  observedAt: string;
  openTime: number;
  candleTime: string;
  signal?: TradingViewSignal;
  direction?: FlipDirection;
  entryPrice?: number;
  takeProfitPrice?: number;
  stopPrice?: number;
  price?: number;
  reason?: string;
}

export interface TradingViewActivePreview {
  openTime: number;
  signal: TradingViewSignal;
  direction: FlipDirection;
  entryPrice: number;
  takeProfitPrice: number;
  stopPrice: number;
  outcome?: "tp_hit" | "sl_hit" | "tp_sl_ambiguous";
}

export interface TradingViewObserverState {
  processedConfirmedOpenTimes: Set<number>;
  activePreview?: TradingViewActivePreview;
  initialized: boolean;
}

export function createTradingViewObserverState(): TradingViewObserverState {
  return {
    processedConfirmedOpenTimes: new Set<number>(),
    initialized: false
  };
}

function directionForSignal(signal: TradingViewSignal): FlipDirection {
  return signal === "buy" ? "long" : "short";
}

function previewEventType(signal: TradingViewSignal): TradingViewObserveEventType {
  return signal === "buy" ? "pre_buy" : "pre_sell";
}

function confirmedEventType(signal: TradingViewSignal): TradingViewObserveEventType {
  return signal === "buy" ? "confirmed_buy" : "confirmed_sell";
}

function maxNotNa(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) {
    return b;
  }
  if (b === undefined) {
    return a;
  }
  return Math.max(a, b);
}

function minNotNa(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) {
    return b;
  }
  if (b === undefined) {
    return a;
  }
  return Math.min(a, b);
}

function lineBelow(reference: number, a: number | undefined, b: number | undefined, fallback: number): number {
  const aa = a !== undefined && a < reference ? a : undefined;
  const bb = b !== undefined && b < reference ? b : undefined;
  return maxNotNa(aa, bb) ?? fallback;
}

function lineAbove(reference: number, a: number | undefined, b: number | undefined, fallback: number): number {
  const aa = a !== undefined && a > reference ? a : undefined;
  const bb = b !== undefined && b > reference ? b : undefined;
  return minNotNa(aa, bb) ?? fallback;
}

function longTakeProfit(entryPrice: number, range: RangeFilterPoint, frama: FramaChannelPoint): number {
  const rangeWidth = Math.max(0, range.highBand - range.filter);
  const rangeTarget = entryPrice + rangeWidth;
  return frama.upper !== undefined && frama.upper > rangeTarget ? frama.upper : rangeTarget;
}

function shortTakeProfit(entryPrice: number, range: RangeFilterPoint, frama: FramaChannelPoint): number {
  const rangeWidth = Math.max(0, range.filter - range.lowBand);
  const rangeTarget = entryPrice - rangeWidth;
  return frama.lower !== undefined && frama.lower < rangeTarget ? frama.lower : rangeTarget;
}

function previewTargets(signal: TradingViewSignal, entryPrice: number, range: RangeFilterPoint, frama: FramaChannelPoint): {
  direction: FlipDirection;
  stopPrice: number;
  takeProfitPrice: number;
} {
  if (signal === "buy") {
    return {
      direction: "long",
      stopPrice: lineBelow(entryPrice, range.filter, frama.frama, range.lowBand),
      takeProfitPrice: longTakeProfit(entryPrice, range, frama)
    };
  }
  return {
    direction: "short",
    stopPrice: lineAbove(entryPrice, range.filter, frama.frama, range.highBand),
    takeProfitPrice: shortTakeProfit(entryPrice, range, frama)
  };
}

function eventBase(symbol: string, observedAt: number, openTime: number): Pick<TradingViewObserveEvent, "symbol" | "observedAt" | "openTime" | "candleTime"> {
  return {
    symbol,
    observedAt: new Date(observedAt).toISOString(),
    openTime,
    candleTime: new Date(openTime).toISOString()
  };
}

function exitOutcome(preview: TradingViewActivePreview, row: ParsedKline): TradingViewActivePreview["outcome"] | undefined {
  if (preview.outcome) {
    return undefined;
  }
  const hitStop = preview.direction === "long" ? row.low <= preview.stopPrice : row.high >= preview.stopPrice;
  const hitTakeProfit = preview.direction === "long" ? row.high >= preview.takeProfitPrice : row.low <= preview.takeProfitPrice;
  if (hitStop && hitTakeProfit) {
    return "tp_sl_ambiguous";
  }
  if (hitStop) {
    return "sl_hit";
  }
  if (hitTakeProfit) {
    return "tp_hit";
  }
  return undefined;
}

export function observeTradingViewSnapshot(options: {
  symbol: string;
  rows: ParsedKline[];
  range: readonly (RangeFilterPoint | undefined)[];
  frama: readonly (FramaChannelPoint | undefined)[];
  state: TradingViewObserverState;
  observedAt: number;
}): { events: TradingViewObserveEvent[] } {
  const events: TradingViewObserveEvent[] = [];
  if (options.rows.length === 0) {
    return { events };
  }

  const currentIndex = options.rows.length - 1;
  if (!options.state.initialized) {
    for (let index = 0; index < currentIndex; index += 1) {
      options.state.processedConfirmedOpenTimes.add(options.rows[index].openTime);
    }
    options.state.initialized = true;
  }

  for (let index = 0; index < currentIndex; index += 1) {
    const point = options.range[index];
    const row = options.rows[index];
    if (!point?.signal || options.state.processedConfirmedOpenTimes.has(row.openTime)) {
      continue;
    }
    events.push({
      ...eventBase(options.symbol, options.observedAt, row.openTime),
      type: confirmedEventType(point.signal),
      signal: point.signal,
      direction: directionForSignal(point.signal),
      price: row.close
    });
    options.state.processedConfirmedOpenTimes.add(row.openTime);
    if (options.state.activePreview?.openTime === row.openTime && options.state.activePreview.signal !== point.signal) {
      events.push({
        ...eventBase(options.symbol, options.observedAt, row.openTime),
        type: "false_preview",
        signal: options.state.activePreview.signal,
        direction: options.state.activePreview.direction,
        entryPrice: options.state.activePreview.entryPrice,
        reason: "closed_with_opposite_or_missing_signal"
      });
      options.state.activePreview = undefined;
    }
    if (options.state.activePreview?.openTime === row.openTime && options.state.activePreview.signal === point.signal) {
      options.state.activePreview = undefined;
    }
  }

  const currentRow = options.rows[currentIndex];
  if (options.state.activePreview?.openTime === currentRow.openTime) {
    const outcome = exitOutcome(options.state.activePreview, currentRow);
    if (outcome) {
      options.state.activePreview.outcome = outcome;
      events.push({
        ...eventBase(options.symbol, options.observedAt, currentRow.openTime),
        type: outcome,
        signal: options.state.activePreview.signal,
        direction: options.state.activePreview.direction,
        entryPrice: options.state.activePreview.entryPrice,
        takeProfitPrice: options.state.activePreview.takeProfitPrice,
        stopPrice: options.state.activePreview.stopPrice
      });
    }
  }

  const currentRange = options.range[currentIndex];
  const currentFrama = options.frama[currentIndex];
  if (!currentRange?.signal || !currentFrama) {
    if (options.state.activePreview?.openTime === currentRow.openTime) {
      events.push({
        ...eventBase(options.symbol, options.observedAt, currentRow.openTime),
        type: "false_preview",
        signal: options.state.activePreview.signal,
        direction: options.state.activePreview.direction,
        entryPrice: options.state.activePreview.entryPrice,
        reason: "current_signal_disappeared"
      });
      options.state.activePreview = undefined;
    }
    return { events };
  }

  const active = options.state.activePreview;
  if (active?.openTime === currentRow.openTime && active.signal === currentRange.signal) {
    return { events };
  }
  if (active?.openTime === currentRow.openTime && active.signal !== currentRange.signal) {
    events.push({
      ...eventBase(options.symbol, options.observedAt, currentRow.openTime),
      type: "false_preview",
      signal: active.signal,
      direction: active.direction,
      entryPrice: active.entryPrice,
      reason: "current_signal_flipped"
    });
  }

  const targets = previewTargets(currentRange.signal, currentRow.close, currentRange, currentFrama);
  const preview: TradingViewActivePreview = {
    openTime: currentRow.openTime,
    signal: currentRange.signal,
    direction: targets.direction,
    entryPrice: currentRow.close,
    takeProfitPrice: targets.takeProfitPrice,
    stopPrice: targets.stopPrice
  };
  options.state.activePreview = preview;
  events.push({
    ...eventBase(options.symbol, options.observedAt, currentRow.openTime),
    type: previewEventType(currentRange.signal),
    signal: currentRange.signal,
    direction: preview.direction,
    entryPrice: preview.entryPrice,
    takeProfitPrice: preview.takeProfitPrice,
    stopPrice: preview.stopPrice
  });

  return { events };
}

import type { BitgetMarketContext } from "./bitgetMarketData";
import type { FlipDirection } from "./tradingViewIndicators";
import type { TradingViewObserveEvent } from "./tradingViewObserver";

export interface TradingViewVolumeEvidence {
  takerImbalancePct: number;
  directionalTakerImbalancePct: number;
  latestFundingRatePct: number;
  openInterestPresent: boolean;
  longShortRatio?: number;
  accountLongShortRatio?: number;
  positionLongShortRatio?: number;
  contextBlockers: string[];
}

export interface TradingViewVolumeObserveEvent extends TradingViewObserveEvent {
  action: "hold";
  state: "observe_only";
  rawScore: number;
  volumeConfirm: boolean;
  blocked: string;
  evidence: TradingViewVolumeEvidence;
}

export interface EnrichTradingViewEventsWithVolumeOptions {
  events: readonly TradingViewObserveEvent[];
  marketContext?: BitgetMarketContext;
  minConfirmScore?: number;
}

function round(value: number, digits = 6): number {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : value;
}

function latest<T extends { timestampMs: number }>(rows: readonly T[]): T | undefined {
  return [...rows].sort((left, right) => right.timestampMs - left.timestampMs)[0];
}

function takerImbalancePct(context: BitgetMarketContext): number {
  const rows = context.takerBuySell.slice(0, 30);
  const totals = rows.reduce(
    (sum, row) => ({
      buyVolume: sum.buyVolume + row.buyVolume,
      sellVolume: sum.sellVolume + row.sellVolume
    }),
    { buyVolume: 0, sellVolume: 0 }
  );
  const total = totals.buyVolume + totals.sellVolume;
  return total > 0 ? ((totals.buyVolume - totals.sellVolume) / total) * 100 : 0;
}

function ratioCrowdingPenalty(direction: FlipDirection | undefined, context: BitgetMarketContext): number {
  if (!direction) {
    return 0;
  }
  const account = latest(context.accountLongShort)?.longShortAccountRatio;
  const position = latest(context.positionLongShort)?.longShortPositionRatio;
  const ratio = Math.max(account ?? 1, position ?? 1);
  const inverseRatio = Math.max(account ? 1 / account : 1, position ? 1 / position : 1);
  if (direction === "long" && ratio > 3) {
    return 10;
  }
  if (direction === "short" && inverseRatio > 3) {
    return 10;
  }
  return 0;
}

function fundingPenalty(context: BitgetMarketContext): number {
  const fundingRate = latest(context.fundingRates)?.fundingRate ?? 0;
  return Math.abs(fundingRate) > 0.0005 ? 8 : 0;
}

function evidenceFor(direction: FlipDirection | undefined, context: BitgetMarketContext | undefined): TradingViewVolumeEvidence {
  if (!context) {
    return {
      takerImbalancePct: 0,
      directionalTakerImbalancePct: 0,
      latestFundingRatePct: 0,
      openInterestPresent: false,
      contextBlockers: ["volume_context_missing"]
    };
  }
  const imbalancePct = takerImbalancePct(context);
  const directionalTakerImbalancePct = direction === "short" ? -imbalancePct : imbalancePct;
  return {
    takerImbalancePct: round(imbalancePct, 3),
    directionalTakerImbalancePct: round(directionalTakerImbalancePct, 3),
    latestFundingRatePct: round((latest(context.fundingRates)?.fundingRate ?? 0) * 100, 6),
    openInterestPresent: context.openInterest !== undefined,
    longShortRatio: latest(context.longShort)?.longShortRatio,
    accountLongShortRatio: latest(context.accountLongShort)?.longShortAccountRatio,
    positionLongShortRatio: latest(context.positionLongShort)?.longShortPositionRatio,
    contextBlockers: context.blockers
  };
}

function scoreEvent(event: TradingViewObserveEvent, context: BitgetMarketContext | undefined): number {
  if (!context || !event.direction) {
    return 0;
  }
  const directionalTaker = event.direction === "short" ? -takerImbalancePct(context) : takerImbalancePct(context);
  const takerScore = Math.max(-25, Math.min(25, directionalTaker));
  const oiScore = context.openInterest ? 7 : -15;
  return round(50 + takerScore + oiScore - fundingPenalty(context) - ratioCrowdingPenalty(event.direction, context), 3);
}

function blockedReason(volumeConfirm: boolean, context: BitgetMarketContext | undefined): string {
  const reasons: string[] = [];
  if (!context) {
    reasons.push("volume_context_missing");
  } else if (!volumeConfirm) {
    reasons.push("volume_not_confirmed");
  }
  reasons.push("observe_only_no_execution");
  return `blocked=${reasons.join("; ")}`;
}

export function enrichTradingViewEventsWithVolume(options: EnrichTradingViewEventsWithVolumeOptions): TradingViewVolumeObserveEvent[] {
  const minConfirmScore = options.minConfirmScore ?? 70;
  return options.events.map((event) => {
    const rawScore = scoreEvent(event, options.marketContext);
    const volumeConfirm = options.marketContext !== undefined && rawScore >= minConfirmScore;
    return {
      ...event,
      action: "hold",
      state: "observe_only",
      rawScore,
      volumeConfirm,
      blocked: blockedReason(volumeConfirm, options.marketContext),
      evidence: evidenceFor(event.direction, options.marketContext)
    };
  });
}

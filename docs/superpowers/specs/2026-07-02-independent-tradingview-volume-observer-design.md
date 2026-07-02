# Independent TradingView Volume Observer Design

## Goal

Build an observe-only runner for MUUSDT that combines TradingView-style Range / FRAMA / WAE signal context with live Bitget market-context data, without sharing state, cron jobs, JSONL files, or scoring logic with the other quant thread.

## Boundaries

- No order API calls.
- No paper fills.
- No dependency on `/opt/quant-bot/data/bitget-volume-history`.
- No mutation of the other thread's VPS cron or collector files.
- Output lives under `data/tradingview-volume-observer/` by default.

## Architecture

The observer has two layers.

1. `tradingViewVolumeObserver.ts` is pure logic. It consumes recent candles, computed Range / FRAMA / WAE series, and one Bitget market context. It emits enriched observe-only events with `action=hold`, `state=observe_only`, `rawScore`, `blocked`, and `evidence`.
2. `runBitgetTradingViewVolumeObserver.ts` is the CLI. It fetches recent MUUSDT 1m candles, computes indicators, collects fresh Bitget market context, enriches events, and appends JSONL.

## Signal Policy

Range / FRAMA / WAE create candidates. Bitget market data confirms, downgrades, or blocks.

- Long confirmation: taker buy imbalance positive, open interest present, funding not extreme, crowding not excessive.
- Short confirmation: taker sell imbalance positive, open interest present, funding not extreme, crowding not excessive.
- If volume context is missing, keep the event but set `blocked=volume_context_missing`.
- If market context disagrees, keep the event but set `blocked=volume_not_confirmed`.

## Timing Rule

The runner collects market context at `observedAt` and enriches only events observed at the same poll. It does not join future context onto older signals.

## Output

Each JSONL event includes:

- TradingView event fields: `type`, `signal`, `direction`, `entryPrice`, `takeProfitPrice`, `stopPrice`.
- Volume fields: `volumeConfirm`, `rawScore`, `blocked`, `evidence`.
- Hard state: `state=observe_only`, `action=hold`.

## Verification

Tests cover:

- Bullish market context confirms long candidates.
- Bearish context blocks long candidates.
- Missing market context blocks candidates without dropping them.
- CLI writes observe-only JSONL and never exposes execution fields.

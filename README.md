# Bitget TradingView Research

Standalone research repo for Bitget market data plus TradingView Range Filter / FRAMA experiments.

## Main Surfaces

- `range-pretrigger-clean-labels.pine`: clean Pine indicator labels for TradingView.
- `h2so4-range-frama-combined.pine`: one-slot TradingView indicator combining clean Range labels with the FRAMA Channel.
- `src/crypto/tradingViewIndicators.ts`: Range Filter and FRAMA calculation/backtest helpers.
- `src/crypto/runBitgetTradingViewBacktest.ts`: Bitget 1m indicator backtest runner.
- `src/crypto/runBitgetStrategyValidation.ts`: WAE + Range pre-trigger validation runner with fixed-parameter trade reports and walk-forward splits.
- `src/crypto/strategyValidation.ts`: reusable fixed-risk summaries, trade reports, scoring, and WAE pre-trigger search helpers.
- `src/crypto/bitgetMarketData.ts`: Bitget market context collection.
- `src/crypto/bitgetVolumeResearch.ts`: Bitget volume feature research.

## Commands

```bash
npm test
npm run typecheck
npm run tradingview-backtest
npm run bitget-volume-research
npm run strategy-validation
```

Example:

```bash
BITGET_SYMBOLS=MUUSDT BITGET_BACKTEST_DAYS=180 BITGET_STRATEGY_VALIDATION_PATH=data/muusdt-strategy-validation.json npm run strategy-validation
```

For reproducible research, pin `BITGET_BACKTEST_END_TIME` and write candles to a cache:

```bash
BITGET_SYMBOLS=MUUSDT BITGET_BACKTEST_DAYS=180 BITGET_BACKTEST_END_TIME=2026-07-01T16:22:24.942Z BITGET_CANDLE_CACHE_PATH=data/cache/muusdt-180d.json npm run strategy-validation
```

Rolling walk-forward is opt-in because it reruns the parameter grid per window:

```bash
BITGET_ROLLING_WALK_FORWARD=1 BITGET_ROLLING_TRAIN_DAYS=30 BITGET_ROLLING_TEST_DAYS=15 BITGET_ROLLING_MAX_WINDOWS=4 npm run strategy-validation
```

Research posture: observe first, backtest with costs, then paper trade. No live readiness is implied by this repo.

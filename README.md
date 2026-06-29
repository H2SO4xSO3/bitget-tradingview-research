# Bitget TradingView Research

Standalone research repo for Bitget market data plus TradingView Range Filter / FRAMA experiments.

## Main Surfaces

- `range-pretrigger-clean-labels.pine`: clean Pine indicator labels for TradingView.
- `src/crypto/tradingViewIndicators.ts`: Range Filter and FRAMA calculation/backtest helpers.
- `src/crypto/runBitgetTradingViewBacktest.ts`: Bitget 1m indicator backtest runner.
- `src/crypto/bitgetMarketData.ts`: Bitget market context collection.
- `src/crypto/bitgetVolumeResearch.ts`: Bitget volume feature research.

## Commands

```bash
npm test
npm run typecheck
npm run tradingview-backtest
npm run bitget-volume-research
```

Research posture: observe first, backtest with costs, then paper trade. No live readiness is implied by this repo.

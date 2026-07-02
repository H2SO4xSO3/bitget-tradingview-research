import {
  appendTradingViewVolumeObserveEventsJsonl,
  createTradingViewVolumeObserveStateBySymbol,
  observeTradingViewVolumeSymbolsOnce
} from "./bitgetTradingViewVolumeObserver";

export interface TradingViewVolumeObserverArgs {
  symbols: string[];
  productType: string;
  granularity: string;
  marketPeriod: string;
  candleLimit: number;
  pollMs: number;
  maxPolls: number;
  outputPath: string;
}

function readArg(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function numberArg(args: readonly string[], name: string, fallback: number): number {
  const parsed = Number(readArg(args, name));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function symbolsArg(args: readonly string[]): string[] {
  const raw = readArg(args, "--symbols") ?? process.env.BITGET_TV_VOLUME_SYMBOLS ?? process.env.BITGET_SYMBOL ?? "MUUSDT";
  return raw
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);
}

function defaultOutputPath(symbols: readonly string[]): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `data/tradingview-volume-observer/${symbols.join("-").toLowerCase()}-${timestamp}.jsonl`;
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export function parseTradingViewVolumeObserverArgs(args: readonly string[]): TradingViewVolumeObserverArgs {
  const symbols = symbolsArg(args);
  return {
    symbols,
    productType: readArg(args, "--product-type") ?? process.env.BITGET_PRODUCT_TYPE ?? "USDT-FUTURES",
    granularity: readArg(args, "--granularity") ?? process.env.BITGET_GRANULARITY ?? "1m",
    marketPeriod: readArg(args, "--market-period") ?? process.env.BITGET_MARKET_PERIOD ?? "5m",
    candleLimit: numberArg(args, "--candle-limit", Number(process.env.BITGET_TV_VOLUME_CANDLE_LIMIT) || 300),
    pollMs: numberArg(args, "--poll-ms", Number(process.env.BITGET_TV_VOLUME_POLL_MS) || 60_000),
    maxPolls: numberArg(args, "--max-polls", Number(process.env.BITGET_TV_VOLUME_MAX_POLLS) || 0),
    outputPath: readArg(args, "--output") ?? process.env.BITGET_TV_VOLUME_OUTPUT_PATH ?? defaultOutputPath(symbols)
  };
}

export async function runTradingViewVolumeObserver(args = process.argv.slice(2)): Promise<void> {
  const options = parseTradingViewVolumeObserverArgs(args);
  const states = createTradingViewVolumeObserveStateBySymbol(options.symbols);

  console.log(
    JSON.stringify({
      state: "observe_only",
      action: "hold",
      symbols: options.symbols,
      productType: options.productType,
      granularity: options.granularity,
      marketPeriod: options.marketPeriod,
      candleLimit: options.candleLimit,
      pollMs: options.pollMs,
      maxPolls: options.maxPolls,
      outputPath: options.outputPath,
      note: "No order API is called. TradingView candidates are only enriched with Bitget volume context."
    })
  );

  let polls = 0;
  while (options.maxPolls <= 0 || polls < options.maxPolls) {
    polls += 1;
    const observedAt = Date.now();
    try {
      const events = await observeTradingViewVolumeSymbolsOnce({
        symbols: options.symbols,
        productType: options.productType,
        granularity: options.granularity,
        marketPeriod: options.marketPeriod,
        candleLimit: options.candleLimit,
        observedAt,
        states
      });
      appendTradingViewVolumeObserveEventsJsonl(options.outputPath, events);
      console.log(
        JSON.stringify({
          state: "observe_only",
          action: "hold",
          poll: polls,
          observedAt: new Date(observedAt).toISOString(),
          events: events.length,
          confirmedByVolume: events.filter((event) => event.volumeConfirm).length,
          outputPath: options.outputPath
        })
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          state: "observe_only",
          action: "hold",
          poll: polls,
          observedAt: new Date(observedAt).toISOString(),
          blocked: error instanceof Error ? error.message : String(error)
        })
      );
    }

    if (options.maxPolls > 0 && polls >= options.maxPolls) {
      break;
    }
    await sleep(options.pollMs);
  }
}

if (process.argv[1]?.endsWith("runBitgetTradingViewVolumeObserver.ts")) {
  runTradingViewVolumeObserver().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

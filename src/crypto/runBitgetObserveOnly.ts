import { appendObserveEventsJsonl, createObserveStateBySymbol, observeSymbolsOnce } from "./bitgetObserveOnly";

function numberFromEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function symbolsFromEnv(): string[] {
  return (process.env.BITGET_OBSERVE_SYMBOLS ?? process.env.BITGET_SYMBOL ?? "MUUSDT,BTCUSDT")
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter((symbol) => symbol.length > 0);
}

function defaultOutputPath(symbols: string[]): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `data/observe-only/${symbols.join("-").toLowerCase()}-${timestamp}.jsonl`;
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

const symbols = symbolsFromEnv();
const productType = process.env.BITGET_PRODUCT_TYPE ?? "USDT-FUTURES";
const granularity = process.env.BITGET_GRANULARITY ?? "1m";
const candleLimit = numberFromEnv("BITGET_OBSERVE_CANDLE_LIMIT", 300);
const pollMs = numberFromEnv("BITGET_OBSERVE_POLL_MS", 1_000);
const maxPolls = numberFromEnv("BITGET_OBSERVE_MAX_POLLS", 0);
const outputPath = process.env.BITGET_OBSERVE_OUTPUT_PATH ?? defaultOutputPath(symbols);
const rangeOptions = {
  samplingPeriod: numberFromEnv("BITGET_RANGE_SAMPLING_PERIOD", 100),
  rangeMultiplier: numberFromEnv("BITGET_RANGE_MULTIPLIER", 3)
};
const framaOptions = {
  length: numberFromEnv("BITGET_FRAMA_LENGTH", 26),
  bandsDistance: numberFromEnv("BITGET_FRAMA_BANDS_DISTANCE", 1.5)
};
const states = createObserveStateBySymbol(symbols);

console.log(
  JSON.stringify({
    state: "observe_only",
    symbols,
    productType,
    granularity,
    candleLimit,
    pollMs,
    outputPath,
    note: "No order API is called. This records TradingView-style Range/FRAMA preview and confirmation events only."
  })
);

let polls = 0;
while (maxPolls <= 0 || polls < maxPolls) {
  polls += 1;
  const observedAt = Date.now();
  try {
    const events = await observeSymbolsOnce({
      symbols,
      productType,
      granularity,
      candleLimit,
      states,
      observedAt,
      rangeOptions,
      framaOptions
    });
    appendObserveEventsJsonl(outputPath, events);
    console.log(
      JSON.stringify({
        state: "observe_only",
        poll: polls,
        observedAt: new Date(observedAt).toISOString(),
        events: events.length,
        outputPath
      })
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        state: "observe_only",
        poll: polls,
        observedAt: new Date(observedAt).toISOString(),
        blocked: error instanceof Error ? error.message : String(error)
      })
    );
  }

  if (maxPolls > 0 && polls >= maxPolls) {
    break;
  }
  await sleep(pollMs);
}

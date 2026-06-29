export type BinanceKline = Array<number | string>;

export interface ParsedKline {
  openTime: number;
  closeTime?: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
}

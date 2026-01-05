export type WaterfallBand = {
  name: string;
  startHz: number;
  endHz: number;
  color: string;
};

// Ported from the previous frontend's band plan labels.
export const DEFAULT_BANDS: WaterfallBand[] = [
  { name: '2200M HAM', startHz: 135700, endHz: 137800, color: 'rgba(50, 168, 72, 0.6)' },
  { name: '630M HAM', startHz: 472000, endHz: 479000, color: 'rgba(50, 168, 72, 0.6)' },
  { name: '600M HAM', startHz: 501000, endHz: 504000, color: 'rgba(50, 168, 72, 0.6)' },
  { name: '160M HAM', startHz: 1810000, endHz: 2000000, color: 'rgba(50, 168, 72, 0.6)' },
  { name: '80M HAM', startHz: 3500000, endHz: 3900000, color: 'rgba(50, 168, 72, 0.6)' },
  { name: '60M HAM', startHz: 5351500, endHz: 5366500, color: 'rgba(50, 168, 72, 0.6)' },
  { name: '49M AM', startHz: 5900000, endHz: 6200000, color: 'rgba(199, 12, 193, 0.6)' },
  { name: '40M HAM', startHz: 7000000, endHz: 7200000, color: 'rgba(50, 168, 72, 0.6)' },
  { name: '41M AM', startHz: 7200000, endHz: 7450000, color: 'rgba(199, 12, 193, 0.6)' },
  { name: '31M AM', startHz: 9400000, endHz: 9900000, color: 'rgba(199, 12, 193, 0.6)' },
  { name: '30M HAM', startHz: 10100000, endHz: 10150000, color: 'rgba(50, 168, 72, 0.6)' },
  { name: '25M AM', startHz: 11600000, endHz: 12100000, color: 'rgba(199, 12, 193, 0.6)' },
  { name: '22M AM', startHz: 13570000, endHz: 13870000, color: 'rgba(199, 12, 193, 0.6)' },
  { name: '20M HAM', startHz: 14000000, endHz: 14350000, color: 'rgba(50, 168, 72, 0.6)' },
  { name: '19M AM', startHz: 15100000, endHz: 15800000, color: 'rgba(199, 12, 193, 0.6)' },
  { name: '16M AM', startHz: 17480000, endHz: 17900000, color: 'rgba(199, 12, 193, 0.6)' },
  { name: '17M HAM', startHz: 18068000, endHz: 18168000, color: 'rgba(50, 168, 72, 0.6)' },
  { name: '15M AM', startHz: 18900000, endHz: 19020000, color: 'rgba(199, 12, 193, 0.6)' },
  { name: '15M HAM', startHz: 21000000, endHz: 21450000, color: 'rgba(50, 168, 72, 0.6)' },
  { name: '13M AM', startHz: 21450000, endHz: 21850000, color: 'rgba(199, 12, 193, 0.6)' },
  { name: '12M HAM', startHz: 24890000, endHz: 24990000, color: 'rgba(50, 168, 72, 0.6)' },
  { name: '11M AM', startHz: 25670000, endHz: 26100000, color: 'rgba(199, 12, 193, 0.6)' },
  { name: 'CB', startHz: 26965000, endHz: 27405000, color: 'rgba(3, 227, 252, 0.6)' },
  { name: '10M HAM', startHz: 28000000, endHz: 29700000, color: 'rgba(50, 168, 72, 0.6)' },
];


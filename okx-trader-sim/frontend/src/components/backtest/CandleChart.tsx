import type { BacktestTradePoint, CandlePoint } from '../../types';
import { formatNumber } from '../../utils/format';

export function CandleChart({ candles, trades }: { candles: CandlePoint[]; trades: BacktestTradePoint[] }) {
  const width = 980;
  const height = 360;
  const pad = { left: 56, right: 72, top: 24, bottom: 42 };
  const visible = candles.slice(-80);
  if (!visible.length) return <div className="emptyState">暂无 K线，请先运行回测。</div>;

  const min = Math.min(...visible.map((c) => c.low));
  const max = Math.max(...visible.map((c) => c.high));
  const range = Math.max(max - min, 0.00000001);
  const minPrice = Math.max(0, min - range * 0.05);
  const maxPrice = max + range * 0.05;
  const priceRange = maxPrice - minPrice;
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const gap = plotW / visible.length;
  const bodyW = Math.max(2, gap * 0.55);
  const y = (price: number) => height - pad.bottom - ((price - minPrice) / priceRange) * plotH;
  const x = (index: number) => pad.left + index * gap + gap / 2;
  const visibleTs = new Set(visible.map((c) => c.ts));
  const chartTrades = trades.filter((t) => visibleTs.has(t.entryTs) || visibleTs.has(t.exitTs));

  return (
    <div className="chartFrame">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="回测 K线图">
        {[0, 0.25, 0.5, 0.75, 1].map((r) => {
          const price = minPrice + priceRange * r;
          const yy = y(price);
          return <g key={r}><line x1={pad.left} y1={yy} x2={width - pad.right} y2={yy} className="gridLine" /><text x={width - pad.right + 8} y={yy + 4}>{formatNumber(price, 8)}</text></g>;
        })}
        {visible.map((c, index) => {
          const up = c.close >= c.open;
          return (
            <g key={c.ts}>
              <line x1={x(index)} y1={y(c.high)} x2={x(index)} y2={y(c.low)} className={up ? 'candle up' : 'candle down'} />
              <rect x={x(index) - bodyW / 2} y={y(Math.max(c.open, c.close))} width={bodyW} height={Math.max(1, Math.abs(y(c.open) - y(c.close)))} className={up ? 'body up' : 'body down'} />
            </g>
          );
        })}
        {chartTrades.map((t, index) => {
          const entryIndex = visible.findIndex((c) => c.ts === t.entryTs);
          const exitIndex = visible.findIndex((c) => c.ts === t.exitTs);
          return (
            <g key={`${t.entryTs}-${t.exitTs}-${index}`}>
              {entryIndex >= 0 ? <circle cx={x(entryIndex)} cy={y(t.entryPrice)} r="4" className="tradeEntry" /> : null}
              {exitIndex >= 0 ? <circle cx={x(exitIndex)} cy={y(t.exitPrice)} r="4" className={t.ret >= 0 ? 'tradeExit goodDot' : 'tradeExit badDot'} /> : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

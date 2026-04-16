import type { BacktestTradePoint } from '../../types';
import { formatNumber } from '../../utils/format';

export function EquityCurve({ trades }: { trades: BacktestTradePoint[] }) {
  const width = 980;
  const height = 240;
  const pad = 44;
  const series = trades.reduce<Array<{ index: number; equity: number }>>((acc, trade, index) => {
    const previous = acc.length ? acc[acc.length - 1].equity : 1;
    acc.push({ index: index + 1, equity: previous * (1 + trade.ret) });
    return acc;
  }, []);

  if (!series.length) return <div className="emptyState">暂无资金曲线。</div>;

  const min = Math.min(1, ...series.map((x) => x.equity));
  const max = Math.max(1, ...series.map((x) => x.equity));
  const range = Math.max(max - min, 0.0001);
  const x = (index: number) => pad + (index / Math.max(series.length - 1, 1)) * (width - pad * 2);
  const y = (equity: number) => height - pad - ((equity - min) / range) * (height - pad * 2);
  const path = series.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(point.equity)}`).join(' ');

  return (
    <div className="chartFrame compact">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="资金曲线">
        {[min, min + range / 2, max].map((tick) => <g key={tick}><line x1={pad} y1={y(tick)} x2={width - pad} y2={y(tick)} className="gridLine" /><text x={pad - 10} y={y(tick) + 4} textAnchor="end">{formatNumber(tick, 4)}</text></g>)}
        <path d={path} className="equityPath" />
      </svg>
    </div>
  );
}

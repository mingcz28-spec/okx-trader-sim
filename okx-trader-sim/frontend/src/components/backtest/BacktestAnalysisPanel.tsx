import type { BacktestResult, BacktestTradePoint } from '../../types';
import { formatPercent } from '../../utils/format';

type BacktestAnalysisPanelProps = {
  selected?: BacktestResult | null;
  trades: BacktestTradePoint[];
};

export function BacktestAnalysisPanel({ selected, trades }: BacktestAnalysisPanelProps) {
  if (!selected) {
    return <div className="emptyState">暂无结果分析，请先完成回测。</div>;
  }

  const returns = trades.map((trade) => trade.netRet ?? trade.ret);
  const wins = returns.filter((ret) => ret > 0);
  const losses = returns.filter((ret) => ret < 0);
  const avgReturn = average(returns);
  const avgWin = average(wins);
  const avgLoss = average(losses);
  const bestTrade = returns.length ? Math.max(...returns) : 0;
  const worstTrade = returns.length ? Math.min(...returns) : 0;
  const stopLossCount = trades.filter((trade) => trade.reason === 'stop_loss').length;
  const trailingCount = trades.filter((trade) => trade.reason === 'trailing_exit').length;
  const payoffRatio = avgLoss < 0 ? avgWin / Math.abs(avgLoss) : 0;
  const comment = buildComment(selected, payoffRatio, stopLossCount, trades.length);

  return (
    <div className="analysisGrid">
      <div><span>净收益</span><strong className={selected.netTotalReturn >= 0 ? 'good' : 'bad'}>{formatPercent(selected.netTotalReturn)}</strong></div>
      <div><span>毛收益</span><strong className={selected.grossTotalReturn >= 0 ? 'good' : 'bad'}>{formatPercent(selected.grossTotalReturn)}</strong></div>
      <div><span>费率成本</span><strong>{formatPercent(selected.feeCost)}</strong></div>
      <div><span>最大回撤</span><strong className="bad">{formatPercent(selected.maxDrawdown)}</strong></div>
      <div><span>胜率</span><strong>{formatPercent(selected.winRate)}</strong></div>
      <div><span>交易次数</span><strong>{selected.trades}</strong></div>
      <div><span>平均单笔净收益</span><strong className={avgReturn >= 0 ? 'good' : 'bad'}>{formatPercent(avgReturn)}</strong></div>
      <div><span>最大单笔盈利</span><strong className="good">{formatPercent(bestTrade)}</strong></div>
      <div><span>最大单笔亏损</span><strong className="bad">{formatPercent(worstTrade)}</strong></div>
      <div><span>盈亏比</span><strong>{payoffRatio ? payoffRatio.toFixed(2) : '0.00'}</strong></div>
      <div><span>止损次数</span><strong>{stopLossCount}</strong></div>
      <div><span>回撤退出</span><strong>{trailingCount}</strong></div>
      <div><span>杠杆</span><strong>{selected.leverage}x</strong></div>
      <div className="analysisComment"><span>结果判断</span><strong>{comment}</strong></div>
    </div>
  );
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildComment(result: BacktestResult, payoffRatio: number, stopLossCount: number, tradeCount: number) {
  const stopLossRate = tradeCount ? stopLossCount / tradeCount : 0;
  if (result.netTotalReturn > 0.5 && result.maxDrawdown < -0.3) return '净收益突出，但回撤偏深，建议降低仓位。';
  if (result.winRate < 0.35 && payoffRatio > 2) return '胜率偏低，但单笔盈利覆盖亏损，依赖赔率。';
  if (stopLossRate > 0.6) return '止损触发偏频繁，参数可能过紧。';
  if (result.netTotalReturn <= 0) return '当前参数未产生扣费后正收益，不适合作为默认参数。';
  return '净收益、回撤和交易频率相对均衡，可继续观察。';
}

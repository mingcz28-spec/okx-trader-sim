import type { BacktestBar, BacktestResult } from '../../types';
import { formatPercent } from '../../utils/format';

type BacktestParameterPanelProps = {
  instId: string;
  bar: BacktestBar;
  movingAveragePeriod: number;
  stopLossPct: number;
  trailingDrawdownPct: number;
  leverage: number;
  bestResult?: BacktestResult | null;
  candidates: BacktestResult[];
  selected?: BacktestResult | null;
  running: boolean;
  loadingDetail: boolean;
  canRun: boolean;
  validationMessage?: string | null;
  onBarChange: (bar: BacktestBar) => void;
  onMovingAveragePeriodChange: (value: number) => void;
  onStopLossChange: (value: number) => void;
  onTrailingChange: (value: number) => void;
  onLeverageChange: (value: number) => void;
  onRunGrid: () => void;
  onRunCurrent: () => void;
  onSelectCandidate: (result: BacktestResult) => void;
  onSaveStrategy: () => void;
};

export function BacktestParameterPanel({
  instId,
  bar,
  movingAveragePeriod,
  stopLossPct,
  trailingDrawdownPct,
  leverage,
  bestResult,
  candidates,
  selected,
  running,
  loadingDetail,
  canRun,
  validationMessage,
  onBarChange,
  onMovingAveragePeriodChange,
  onStopLossChange,
  onTrailingChange,
  onLeverageChange,
  onRunGrid,
  onRunCurrent,
  onSelectCandidate,
  onSaveStrategy,
}: BacktestParameterPanelProps) {
  const busy = running || loadingDetail;

  return (
    <section className="panel wide">
      <div className="panelHeader">
        <div>
          <p className="eyebrow">2 参数配置</p>
          <h2>最优参数与候选组合</h2>
          <p className="bodyCopy">回测收益按杠杆和双边 taker 费率计算；自动寻优按均线周期、止损收益、浮盈回撤和杠杆做网格搜索，目标函数是净收益最高。</p>
        </div>
        <strong>{busy ? '计算中' : bestResult ? '已找到最优参数' : '等待回测'}</strong>
      </div>

      <div className="parameterLayout">
        <div className="parameterForm">
          <div className="formGrid">
            <label>标的<input value={instId} readOnly /></label>
            <label>
              周期
              <select value={bar} onChange={(e) => onBarChange(e.target.value as BacktestBar)}>
                <option value="1m">1m</option>
                <option value="5m">5m</option>
                <option value="15m">15m</option>
                <option value="1H">1H</option>
                <option value="4H">4H</option>
                <option value="1D">1D</option>
              </select>
            </label>
            <label>买入均线周期<input type="number" min="2" step="1" value={movingAveragePeriod} onChange={(e) => onMovingAveragePeriodChange(Number(e.target.value))} /></label>
            <label>止损收益 %<input type="number" min="0.01" step="0.01" value={stopLossPct} onChange={(e) => onStopLossChange(Number(e.target.value))} /></label>
            <label>浮盈回撤 %<input type="number" min="0.01" step="0.01" value={trailingDrawdownPct} onChange={(e) => onTrailingChange(Number(e.target.value))} /></label>
            <label>杠杆 x<input type="number" min="1" step="1" value={leverage} onChange={(e) => onLeverageChange(Number(e.target.value))} /></label>
          </div>

          {validationMessage ? <div className="statusBanner error">{validationMessage}</div> : null}

          <div className="actions">
            <button onClick={onRunGrid} disabled={!canRun || busy}>{running ? '搜索中...' : '重新搜索最优参数'}</button>
            <button className="secondary" onClick={onRunCurrent} disabled={!canRun || busy || Boolean(validationMessage)}>{loadingDetail ? '加载中...' : '按当前参数回测'}</button>
            <button className="secondary" onClick={onSaveStrategy} disabled={busy || Boolean(validationMessage)}>保存策略参数</button>
          </div>
        </div>

        <div className="bestParameterBox">
          <p className="eyebrow">自动选出的最优参数</p>
          {bestResult ? (
            <div className="metricMiniGrid">
              <div><span>均线周期</span><strong>{bestResult.movingAveragePeriod}</strong></div>
              <div><span>止损</span><strong>{bestResult.stopLossPct}%</strong></div>
              <div><span>浮盈回撤</span><strong>{bestResult.trailingDrawdownPct}%</strong></div>
              <div><span>杠杆</span><strong>{bestResult.leverage}x</strong></div>
              <div><span>净收益</span><strong className={bestResult.netTotalReturn >= 0 ? 'good' : 'bad'}>{formatPercent(bestResult.netTotalReturn)}</strong></div>
              <div><span>费率成本</span><strong>{formatPercent(bestResult.feeCost)}</strong></div>
              <div><span>最大回撤</span><strong className="bad">{formatPercent(bestResult.maxDrawdown)}</strong></div>
            </div>
          ) : (
            <p className="bodyCopy">点击上方策略卡片后自动生成。</p>
          )}
        </div>
      </div>

      <div className="candidateList">
        <div className="panelHeader compactHeader">
          <div>
            <p className="eyebrow">参数候选</p>
            <h2>可替换参数</h2>
          </div>
          <strong>{candidates.length} 组</strong>
        </div>
        {candidates.length ? (
          <table>
            <thead><tr><th>均线周期</th><th>止损</th><th>回撤</th><th>杠杆</th><th>交易数</th><th>胜率</th><th>净收益</th><th>费率</th><th>最大回撤</th><th></th></tr></thead>
            <tbody>
              {candidates.slice(0, 12).map((result) => {
                const active = selected?.movingAveragePeriod === result.movingAveragePeriod
                  && selected?.stopLossPct === result.stopLossPct
                  && selected?.trailingDrawdownPct === result.trailingDrawdownPct
                  && selected?.leverage === result.leverage;
                return (
                  <tr key={`${result.movingAveragePeriod}-${result.stopLossPct}-${result.trailingDrawdownPct}-${result.leverage}`} className={active ? 'selectedRow' : ''}>
                    <td>{result.movingAveragePeriod}</td>
                    <td>{result.stopLossPct}%</td>
                    <td>{result.trailingDrawdownPct}%</td>
                    <td>{result.leverage}x</td>
                    <td>{result.trades}</td>
                    <td>{formatPercent(result.winRate)}</td>
                    <td className={result.netTotalReturn >= 0 ? 'good' : 'bad'}>{formatPercent(result.netTotalReturn)}</td>
                    <td>{formatPercent(result.feeCost)}</td>
                    <td className="bad">{formatPercent(result.maxDrawdown)}</td>
                    <td><button className="tableAction" onClick={() => onSelectCandidate(result)} disabled={!canRun || busy}>{active ? '已选' : '使用'}</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="emptyState">暂无候选参数。</div>
        )}
      </div>
    </section>
  );
}

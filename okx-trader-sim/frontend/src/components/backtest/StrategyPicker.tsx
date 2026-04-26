import type { StrategyDefinition, StrategyType } from '../../types';

type StrategyPickerProps = {
  strategies: StrategyDefinition[];
  selected: StrategyType;
  expanded?: StrategyType | null;
  mode: 'backtest' | 'realtime';
  disabled?: boolean;
  onSelect: (strategy: StrategyType) => void;
};

export function StrategyPicker({ strategies, selected, expanded = null, mode, disabled = false, onSelect }: StrategyPickerProps) {
  return (
    <div className="strategyGrid">
      {strategies.map((strategy) => {
        const supported = mode === 'backtest' ? strategy.supportsBacktest : strategy.supportsRealtime;
        const available = strategy.status === 'active' && supported;
        const active = strategy.id === selected;
        const isExpanded = expanded === strategy.id;
        return (
          <button
            key={strategy.id}
            type="button"
            className={`strategyOption${active ? ' active' : ''}${isExpanded ? ' expanded' : ''}`}
            disabled={disabled || !available}
            onClick={() => onSelect(strategy.id)}
          >
            <span className="strategyOptionTop">
              <strong>{strategy.name}</strong>
              <span className={`strategyStatusPill ${available ? 'ready' : 'pending'}`}>
                {available ? (mode === 'backtest' ? '可回测' : '可实时') : '待接入'}
              </span>
            </span>
            {isExpanded ? (
              <span className="strategyOptionDetails">
                <span>{strategy.description}</span>
                <span className="strategyCapabilityList">
                  {strategy.supportsBacktest ? <span>策略回测</span> : null}
                  {strategy.supportsSimulation ? <span>实时模拟</span> : null}
                  {strategy.supportsLive ? <span>实时交易</span> : null}
                </span>
                <span className="strategyParamList">
                  {strategy.parameters.map((parameter) => (
                    <span key={`${strategy.id}-${parameter.id}`}>
                      {parameter.label}: {parameter.value}{parameter.unit}
                    </span>
                  ))}
                </span>
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

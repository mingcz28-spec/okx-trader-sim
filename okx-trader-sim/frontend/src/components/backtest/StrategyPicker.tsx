import type { StrategyDefinition, StrategyType } from '../../types';

type StrategyPickerProps = {
  strategies: StrategyDefinition[];
  selected: StrategyType;
  mode: 'backtest' | 'realtime';
  disabled?: boolean;
  onSelect: (strategy: StrategyType) => void;
};

export function StrategyPicker({ strategies, selected, mode, disabled = false, onSelect }: StrategyPickerProps) {
  return (
    <div className="strategyGrid">
      {strategies.map((strategy) => {
        const supported = mode === 'backtest' ? strategy.supportsBacktest : strategy.supportsRealtime;
        const available = strategy.status === 'active' && supported;
        const active = strategy.id === selected;
        return (
          <button
            key={strategy.id}
            type="button"
            className={`strategyOption${active ? ' active' : ''}`}
            disabled={disabled || !available}
            onClick={() => onSelect(strategy.id)}
          >
            <span className="strategyOptionTop">
              <strong>{strategy.name}</strong>
              <span className={`strategyStatusPill ${available ? 'ready' : 'pending'}`}>
                {available ? (mode === 'backtest' ? '可回测' : '可实时') : '待接入'}
              </span>
            </span>
            <span>{strategy.description}</span>
          </button>
        );
      })}
    </div>
  );
}

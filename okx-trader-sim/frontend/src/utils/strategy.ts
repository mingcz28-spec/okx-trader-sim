import type { StrategyDefinition, StrategyParameter, StrategyParameterSet, StrategyType } from '../types';
import { formatNumber } from './format';

export const DEFAULT_STRATEGY_TYPE: StrategyType = 'buy-sell';
export const DEFAULT_STRATEGY_PARAMS: StrategyParameterSet = {
  movingAveragePeriod: 10,
  stopLossPct: 1,
  trailingDrawdownPct: 2,
  leverage: 3,
};

export function findStrategyDefinition(
  strategies: StrategyDefinition[],
  strategyType: StrategyType,
): StrategyDefinition | null {
  return strategies.find((item) => item.id === strategyType) ?? null;
}

export function getStrategyName(
  strategies: StrategyDefinition[],
  strategyType: StrategyType,
): string {
  return findStrategyDefinition(strategies, strategyType)?.name ?? strategyType;
}

export function formatStrategyParams(
  parameterDefinitions: StrategyParameter[],
  params: StrategyParameterSet,
): string {
  const values: Record<string, number> = {
    movingAveragePeriod: params.movingAveragePeriod,
    stopLossPct: params.stopLossPct,
    trailingDrawdownPct: params.trailingDrawdownPct,
    leverage: params.leverage,
  };

  return parameterDefinitions
    .map((parameter) => {
      const precision = parameter.id === 'movingAveragePeriod' ? 0 : 2;
      return `${parameter.label} ${formatNumber(values[parameter.id] ?? parameter.value, precision)}${parameter.unit}`;
    })
    .join(' / ');
}

export function getLeveragedStopLossValidationMessage(
  params: StrategyParameterSet,
): string {
  return params.stopLossPct * params.leverage > 10 ? '止损比例 * 杠杆不能超过 10%。' : '';
}

export function sameStrategyParams(
  left: StrategyParameterSet,
  right: StrategyParameterSet,
): boolean {
  return left.movingAveragePeriod === right.movingAveragePeriod
    && Math.abs(left.stopLossPct - right.stopLossPct) < 0.0001
    && Math.abs(left.trailingDrawdownPct - right.trailingDrawdownPct) < 0.0001
    && Math.abs(left.leverage - right.leverage) < 0.0001;
}

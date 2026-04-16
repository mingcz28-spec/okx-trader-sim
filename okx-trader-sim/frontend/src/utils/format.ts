export function formatNumber(value: number | null | undefined, maximumFractionDigits = 4) {
  return new Intl.NumberFormat('en-CA', { maximumFractionDigits }).format(Number(value ?? 0));
}

export function formatPercent(value: number | null | undefined, digits = 2) {
  return `${formatNumber(Number(value ?? 0) * 100, digits)}%`;
}

export function formatSigned(value: number | null | undefined, digits = 2) {
  const n = Number(value ?? 0);
  return `${n > 0 ? '+' : ''}${formatNumber(n, digits)}`;
}

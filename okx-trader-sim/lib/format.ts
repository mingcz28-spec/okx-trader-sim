export function formatCurrency(value: number, currency: 'USD' | 'CAD' = 'USD') {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatNumber(value: number, maximumFractionDigits = 4) {
  return new Intl.NumberFormat('en-CA', {
    maximumFractionDigits,
  }).format(value);
}

type Props = {
  message?: string;
  error?: string;
};

export function StatusBanner({ message, error }: Props) {
  if (!message && !error) return null;
  return <div className={error ? 'statusBanner error' : 'statusBanner'}>{error || message}</div>;
}

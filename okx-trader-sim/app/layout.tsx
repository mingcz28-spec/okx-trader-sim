import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'OKX Trader Sim',
  description: '模拟盘合约交易控制台',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

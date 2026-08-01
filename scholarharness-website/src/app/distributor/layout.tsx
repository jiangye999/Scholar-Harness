import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '分销合作中心 | Scholar Harness',
  description: '查看邀请码带来的注册、套餐购买、净销售额和应计分成。',
  robots: {
    index: false,
    follow: false,
  },
};

export default function DistributorLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}

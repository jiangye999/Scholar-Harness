import { describe, expect, it } from 'vitest';

import {
  calculateCommission,
  parseReportingPeriod,
} from '../../server/routes/distributors';

describe('distributor reporting', () => {
  it('builds an Asia/Shanghai monthly reporting window', () => {
    expect(parseReportingPeriod('month', '2026-07')).toEqual({
      type: 'month',
      key: '2026-07',
      start: '2026-07-01T00:00:00+08:00',
      end: '2026-08-01T00:00:00+08:00',
      label: '2026 年 7 月',
    });
  });

  it('builds a yearly reporting window', () => {
    expect(parseReportingPeriod('year', '2026')).toEqual({
      type: 'year',
      key: '2026',
      start: '2026-01-01T00:00:00+08:00',
      end: '2027-01-01T00:00:00+08:00',
      label: '2026 年',
    });
  });

  it('calculates commission from net revenue and clamps invalid rates', () => {
    expect(calculateCommission(123.45, 30)).toBe(37.04);
    expect(calculateCommission(123.45, 100)).toBe(123.45);
    expect(calculateCommission(123.45, 150)).toBe(123.45);
    expect(calculateCommission(-10, 30)).toBe(0);
  });
});

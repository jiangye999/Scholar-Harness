export { GBT7714Formatter } from './gbt7714';
export { APAFormatter } from './apa';

import { GBT7714Formatter } from './gbt7714';
import { APAFormatter } from './apa';
import type { ReferenceStyle, UnifiedLiterature, FormattedReference } from '../../../types/literature';

export class ReferenceFormatterFactory {
  static create(style: ReferenceStyle) {
    switch (style) {
      case 'gbt7714':
        return new GBT7714Formatter();
      case 'apa':
        return new APAFormatter();
      default:
        return new GBT7714Formatter();
    }
  }

  static formatReferences(
    literatures: UnifiedLiterature[],
    style: ReferenceStyle,
    citationOrder?: Map<string, number>
  ): FormattedReference[] {
    const formatter = this.create(style);
    return formatter.formatAll(literatures, citationOrder);
  }
}

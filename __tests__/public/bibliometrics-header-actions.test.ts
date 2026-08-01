import * as fs from 'fs';
import * as path from 'path';

import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.join(process.cwd(), 'src', 'public', 'bibliometrics.js'),
  'utf-8'
);

describe('bibliometrics header actions', () => {
  it('does not render the cross-workflow bubble group in the upper-right corner', () => {
    expect(source).not.toContain("renderAcademicWorkflowTopActions('bibliometrics')");
    expect(source).toContain('bibliometricsFullscreenBtn');
    expect(source).toContain('refreshBibliometrics()');
    expect(source).toContain('closeBibliometricsDialog()');
  });

  it('groups the dense toolbar actions into upload and download menus', () => {
    expect(source).toContain("renderBibliometricsGroupedActionMenu('bibliometricsUploadMenu', '上传'");
    expect(source).toContain("renderBibliometricsGroupedActionMenu('bibliometricsDownloadMenu', '下载'");
    expect(source).toContain("action: 'uploadBibliometricsWosTxt'");
    expect(source).toContain("action: 'uploadBibliometricsJournalQualityTable'");
    expect(source).toContain("action: 'downloadBibliometricsExcel'");
    expect(source).toContain("action: 'downloadBibliometricsDatabaseExcel'");
    expect(source).toContain("action: 'downloadBibliometricsFiguresZip'");
    expect(source).toContain("action: 'downloadBibliometricsNetworkJson'");
    expect(source).toContain("id: 'bibliometricsRChartBtn'");
    expect(source).toContain("action: 'showBibliometricsJournalStyleDialog'");
    expect(source).toContain('aria-haspopup="menu"');
    expect(source).toContain('aria-expanded="false"');
  });

  it('places the grouped menus and analysis tabs together beside the title', () => {
    const modalMarkupStart = source.indexOf('modal.innerHTML');
    const titleIndex = source.indexOf('>文献计量分析</div>', modalMarkupStart);
    const uploadIndex = source.indexOf(
      "renderBibliometricsGroupedActionMenu('bibliometricsUploadMenu'",
      titleIndex
    );
    const downloadIndex = source.indexOf(
      "renderBibliometricsGroupedActionMenu('bibliometricsDownloadMenu'",
      uploadIndex
    );
    const tabsIndex = source.indexOf('id="bibliometricsTabs"', downloadIndex);
    const subtitleIndex = source.indexOf('id="bibliometricsSubtitle"', tabsIndex);

    expect(titleIndex).toBeGreaterThan(modalMarkupStart);
    expect(uploadIndex).toBeGreaterThan(titleIndex);
    expect(downloadIndex).toBeGreaterThan(uploadIndex);
    expect(tabsIndex).toBeGreaterThan(downloadIndex);
    expect(subtitleIndex).toBeGreaterThan(tabsIndex);
    expect(source).toContain(
      'id="bibliometricsTabs" style="display:flex;align-items:center;justify-content:flex-start;'
    );
    expect(source).not.toContain(
      '<div style="display:flex;align-items:center;justify-content:flex-start;padding:10px 18px;'
    );
    expect(source).toContain(
      '.bibliometrics-grouped-action-item{border:0!important;box-shadow:none!important;}'
    );
  });

  it('moves the overview metrics into the subtitle and omits redundant metric cards', () => {
    expect(source).not.toContain("panel('当前计量学数据库'");
    expect(source).not.toContain("metricCard('文献总数'");
    expect(source).not.toContain('function metricCard(');
    expect(source).toContain("' · 文献 ' + (s.total || 0) + ' 篇'");
    expect(source).toContain("' · 年份 ' +");
    expect(source).toContain("' · 期刊 ' + (s.journalCount || 0) + ' 种'");
    expect(source).toContain("' · 关键词 ' + (s.keywordCount || 0) + ' 个'");
    expect(source).toContain(
      "' · 参考文献 ' + (dataset.citedReferenceCount || 0) + ' 条'"
    );
  });

  it('does not render the automatic chart artifact inventory in the overview', () => {
    expect(source).not.toContain("panel('自动图表产物'");
    expect(source).not.toContain('function renderArtifactSummary(');
    expect(source).toContain('bibliometricsState.artifacts = data.artifacts || null');
    expect(source).toContain("action: 'downloadBibliometricsFiguresZip'");
  });
});

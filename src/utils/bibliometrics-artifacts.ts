import * as fs from 'fs';
import * as path from 'path';
import type {
  BibliometricAnalysis,
  BibliometricNetwork,
  BibliometricRankItem,
} from './bibliometrics';
import type { WosPlainTextDataset } from './wos-plain-text';

export interface BibliometricFigureArtifact {
  id: string;
  section: 'methods' | 'results' | 'discussion' | 'supplementary';
  title: string;
  filename: string;
  relativePath: string;
  description: string;
  dataUsed: string[];
  status: 'ready' | 'empty';
}

export interface BibliometricTableArtifact {
  id: string;
  title: string;
  filename: string;
  relativePath: string;
  description: string;
}

export interface BibliometricArtifactManifest {
  datasetId: string;
  generatedAt: string;
  outputDirName: string;
  figures: BibliometricFigureArtifact[];
  tables: BibliometricTableArtifact[];
  paperFigureInstructions: string[];
}

interface FigureSpec {
  id: string;
  section: BibliometricFigureArtifact['section'];
  title: string;
  filename: string;
  description: string;
  dataUsed: string[];
  svg: string;
  status: 'ready' | 'empty';
}

const DARK = '#0f3d31';
const GREEN = '#1f6f54';
const GREEN_2 = '#4d8a6b';
const GOLD = '#d9a441';
const LIGHT = '#e8f1ed';
const GRID = '#dce8e3';
const TEXT = '#16231f';
const MUTED = '#5f6f68';
const FONT = '"Times New Roman", "SimSun", serif';

export function buildBibliometricArtifacts(args: {
  analysis: BibliometricAnalysis;
  dataset: WosPlainTextDataset;
  outputDir: string;
}): BibliometricArtifactManifest {
  fs.mkdirSync(args.outputDir, { recursive: true });
  const figures = buildFigureSpecs(args.analysis, args.dataset);
  const figureArtifacts: BibliometricFigureArtifact[] = figures.map(spec => {
    fs.writeFileSync(path.join(args.outputDir, spec.filename), spec.svg, 'utf-8');
    return {
      id: spec.id,
      section: spec.section,
      title: spec.title,
      filename: spec.filename,
      relativePath: spec.filename,
      description: spec.description,
      dataUsed: spec.dataUsed,
      status: spec.status,
    };
  });

  const tables = writeTables(args.outputDir, args.analysis, args.dataset);
  const manifest: BibliometricArtifactManifest = {
    datasetId: args.dataset.id,
    generatedAt: new Date().toISOString(),
    outputDirName: path.basename(args.outputDir),
    figures: figureArtifacts,
    tables,
    paperFigureInstructions: figureArtifacts
      .filter(figure => figure.status === 'ready')
      .map((figure, index) => `Figure ${index + 1}. ${figure.title}. 文件：${figure.filename}。用于论文 ${figure.section} 部分；数据来源：${figure.dataUsed.join(', ')}。`),
  };

  fs.writeFileSync(path.join(args.outputDir, 'figure-manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
  fs.writeFileSync(path.join(args.outputDir, 'figure-index.md'), buildFigureIndexMarkdown(manifest), 'utf-8');
  return manifest;
}

export function readBibliometricArtifactManifest(outputDir: string): BibliometricArtifactManifest | null {
  const manifestPath = path.join(outputDir, 'figure-manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as BibliometricArtifactManifest;
  } catch {
    return null;
  }
}

function buildFigureSpecs(analysis: BibliometricAnalysis, dataset: WosPlainTextDataset): FigureSpec[] {
  return [
    {
      id: 'fig_01_annual_publication_trend',
      section: 'results',
      title: 'Annual publication trend',
      filename: 'figure1.svg',
      description: '年度发文量和累计发文量，用于结果部分开头说明领域增长趋势。',
      dataUsed: ['PY', 'YearTrend'],
      ...lineBarChart({
        title: 'Annual publication trend',
        xLabel: 'Year',
        yLabel: 'Records',
        rows: analysis.yearTrend.map(item => ({ label: String(item.year), value: item.count, lineValue: item.cumulative })),
      }),
    },
    {
      id: 'fig_02_source_journals',
      section: 'results',
      title: 'Top source journals',
      filename: 'figure2.svg',
      description: '核心来源期刊分布，用于说明样本文献来源结构。',
      dataUsed: ['SO', 'TopJournals'],
      ...horizontalBarChart('Top source journals', analysis.topJournals.slice(0, 15), 'Records'),
    },
    {
      id: 'fig_03_top_authors',
      section: 'results',
      title: 'Top productive authors',
      filename: 'figure3.svg',
      description: '高产作者分布，用于作者贡献和合作格局前置描述。',
      dataUsed: ['AU', 'AF', 'TopAuthors'],
      ...horizontalBarChart('Top productive authors', analysis.topAuthors.slice(0, 15), 'Records'),
    },
    {
      id: 'fig_04_keyword_frequency',
      section: 'results',
      title: 'High-frequency keywords',
      filename: 'figure4.svg',
      description: '高频关键词，用于概括研究热点。',
      dataUsed: ['DE', 'ID', 'WC', 'SC', 'TopKeywords'],
      ...horizontalBarChart('High-frequency keywords', analysis.topKeywords.slice(0, 20), 'Frequency'),
    },
    {
      id: 'fig_05_keyword_cooccurrence',
      section: 'results',
      title: 'Keyword co-occurrence network',
      filename: 'figure5.svg',
      description: '关键词共现网络，用于识别热点主题之间的关联。',
      dataUsed: ['DE', 'ID', 'WC', 'SC', 'KeywordNetwork'],
      ...networkFigure('Keyword co-occurrence network', analysis.keywordNetwork, 'keyword'),
    },
    {
      id: 'fig_06_keyword_year_trends',
      section: 'results',
      title: 'Yearly trends of mainstream keywords',
      filename: 'figure6.svg',
      description: '主流关键词年际变化趋势，用于解释热点主题随时间变化。',
      dataUsed: ['PY', 'DE', 'ID', 'KeywordYearTrends'],
      ...multiLineTrend('Yearly trends of mainstream keywords', analysis.keywordYearTrends.slice(0, 8)),
    },
    {
      id: 'fig_07_keyword_bursts',
      section: 'results',
      title: 'Burst keywords',
      filename: 'figure7.svg',
      description: '突现关键词，用于识别近期增长较快的研究前沿。',
      dataUsed: ['PY', 'DE', 'ID', 'KeywordBursts'],
      ...burstChart('Burst keywords', analysis.keywordBursts.slice(0, 20)),
    },
    {
      id: 'fig_08_topic_evolution',
      section: 'discussion',
      title: 'Topic evolution by period',
      filename: 'figure8.svg',
      description: '按时间阶段展示代表性主题词，用于讨论研究前沿迁移。',
      dataUsed: ['PY', 'DE', 'ID', 'TopicEvolution'],
      ...topicEvolutionFigure(analysis),
    },
    {
      id: 'fig_09_co_citation',
      section: 'results',
      title: 'Co-citation network',
      filename: 'figure9.svg',
      description: '共被引网络，用于识别共同知识基础和经典文献群。',
      dataUsed: ['CR', 'CoCitationNetwork'],
      ...networkFigure('Co-citation network', analysis.coCitationNetwork, 'reference'),
    },
    {
      id: 'fig_10_bibliographic_coupling',
      section: 'results',
      title: 'Bibliographic coupling network',
      filename: 'figure10.svg',
      description: '文献耦合网络，用于识别共享参考文献较多的研究路径。',
      dataUsed: ['CR', 'BibliographicCouplingNetwork'],
      ...networkFigure('Bibliographic coupling network', analysis.bibliographicCouplingNetwork, 'literature'),
    },
    {
      id: 'fig_11_collaboration',
      section: 'results',
      title: 'Collaboration networks',
      filename: 'figure11.svg',
      description: '作者、机构和国家合作格局合并图。',
      dataUsed: ['AU', 'AF', 'C1', 'AuthorNetwork', 'InstitutionNetwork', 'CountryNetwork'],
      ...collaborationFigure(analysis),
    },
    {
      id: 'fig_12_data_quality',
      section: 'methods',
      title: 'Data completeness and quality control',
      filename: 'figure12.svg',
      description: '字段覆盖率和 WoS 解析质量，用于方法部分报告数据质量。',
      dataUsed: ['UT', 'DI', 'AB', 'CR', 'C1', 'NR', 'QualityReport'],
      ...qualityFigure(analysis, dataset),
    },
  ];
}

function writeTables(outputDir: string, analysis: BibliometricAnalysis, dataset: WosPlainTextDataset): BibliometricTableArtifact[] {
  const tables: Array<{ id: string; title: string; filename: string; description: string; content: string }> = [
    {
      id: 'table_01_dataset_quality',
      title: 'Dataset quality report',
      filename: 'table-01-dataset-quality.csv',
      description: 'WoS Plain Text 解析质量和字段覆盖率。',
      content: toCsv([
        ['metric', 'value'],
        ['dataset_id', dataset.id],
        ['source_file', dataset.sourceFileName],
        ['records', dataset.quality.recordCount],
        ['cited_references', dataset.quality.citedReferenceCount],
        ['unique_references', dataset.quality.uniqueReferenceCount],
        ['references_with_doi', dataset.quality.referencesWithDoi],
        ['references_with_year', dataset.quality.referencesWithYear],
        ['doi_count', dataset.quality.doiCount],
        ['abstract_count', dataset.quality.abstractCount],
        ['author_count', dataset.quality.authorCount],
        ['affiliation_rows', dataset.quality.affiliationCount],
        ['keyword_count', dataset.quality.keywordCount],
        ['nr_mismatch_count', dataset.quality.nrMismatchCount],
        ['author_name_mismatch_count', dataset.quality.authorNameMismatchCount],
      ]),
    },
    {
      id: 'table_02_top_rankings',
      title: 'Top rankings',
      filename: 'table-02-top-rankings.csv',
      description: 'Top 期刊、作者和关键词。',
      content: toCsv([
        ['type', 'rank', 'label', 'count', 'percentage'],
        ...rankRows('journal', analysis.topJournals),
        ...rankRows('author', analysis.topAuthors),
        ...rankRows('keyword', analysis.topKeywords),
      ]),
    },
    {
      id: 'table_03_network_summary',
      title: 'Network summary',
      filename: 'table-03-network-summary.csv',
      description: '各网络节点数和边数。',
      content: toCsv([
        ['network', 'nodes', 'edges'],
        ['keyword', analysis.keywordNetwork.nodes.length, analysis.keywordNetwork.edges.length],
        ['author', analysis.authorNetwork.nodes.length, analysis.authorNetwork.edges.length],
        ['institution', analysis.institutionNetwork.nodes.length, analysis.institutionNetwork.edges.length],
        ['country', analysis.countryNetwork.nodes.length, analysis.countryNetwork.edges.length],
        ['co_citation', analysis.coCitationNetwork.nodes.length, analysis.coCitationNetwork.edges.length],
        ['bibliographic_coupling', analysis.bibliographicCouplingNetwork.nodes.length, analysis.bibliographicCouplingNetwork.edges.length],
      ]),
    },
  ];

  return tables.map(table => {
    fs.writeFileSync(path.join(outputDir, table.filename), table.content, 'utf-8');
    return {
      id: table.id,
      title: table.title,
      filename: table.filename,
      relativePath: table.filename,
      description: table.description,
    };
  });
}

function horizontalBarChart(title: string, rows: BibliometricRankItem[], xLabel: string): { svg: string; status: 'ready' | 'empty' } {
  const data = rows.filter(row => row.label && row.label !== '未解析' && row.count > 0);
  if (!data.length) return emptySvg(title, 'No ranking data available.');
  const width = 1100;
  const height = Math.max(430, 92 + data.length * 30);
  const plot = { x: 270, y: 64, w: 750, h: height - 118 };
  const max = Math.max(...data.map(row => row.count), 1);
  const barH = Math.min(22, plot.h / data.length - 6);
  const elements = data.map((row, index) => {
    const y = plot.y + index * (plot.h / data.length) + 3;
    const w = Math.max(3, (row.count / max) * plot.w);
    return [
      `<text x="${plot.x - 12}" y="${y + barH * 0.72}" text-anchor="end" class="small">${escapeXml(truncate(row.label, 34))}</text>`,
      `<rect x="${plot.x}" y="${y}" width="${w}" height="${barH}" rx="3" fill="${index % 2 ? GREEN_2 : GREEN}"/>`,
      `<text x="${plot.x + w + 8}" y="${y + barH * 0.72}" class="small">${row.count}</text>`,
    ].join('\n');
  }).join('\n');
  return {
    status: 'ready',
    svg: svgShell(width, height, title, [
      axisFrame(plot),
      elements,
      `<text x="${plot.x + plot.w / 2}" y="${height - 25}" text-anchor="middle" class="axis">${escapeXml(xLabel)}</text>`,
    ].join('\n')),
  };
}

function lineBarChart(args: {
  title: string;
  xLabel: string;
  yLabel: string;
  rows: Array<{ label: string; value: number; lineValue: number }>;
}): { svg: string; status: 'ready' | 'empty' } {
  const data = args.rows.filter(row => row.value > 0);
  if (!data.length) return emptySvg(args.title, 'No annual trend data available.');
  const width = 1100;
  const height = 520;
  const plot = { x: 86, y: 70, w: 940, h: 340 };
  const maxBar = Math.max(...data.map(row => row.value), 1);
  const maxLine = Math.max(...data.map(row => row.lineValue), 1);
  const step = plot.w / Math.max(1, data.length);
  const barW = Math.min(56, step * 0.58);
  const bars = data.map((row, index) => {
    const h = (row.value / maxBar) * plot.h;
    const x = plot.x + index * step + (step - barW) / 2;
    const y = plot.y + plot.h - h;
    return `<rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="4" fill="${GREEN}"/><text x="${x + barW / 2}" y="${plot.y + plot.h + 24}" text-anchor="middle" class="small">${escapeXml(row.label)}</text>`;
  }).join('\n');
  const points = data.map((row, index) => {
    const x = plot.x + index * step + step / 2;
    const y = plot.y + plot.h - (row.lineValue / maxLine) * plot.h;
    return { x, y };
  });
  const polyline = points.map(point => `${point.x},${point.y}`).join(' ');
  const pointSvg = points.map(point => `<circle cx="${point.x}" cy="${point.y}" r="4" fill="${GOLD}" stroke="${DARK}" stroke-width="1"/>`).join('\n');
  return {
    status: 'ready',
    svg: svgShell(width, height, args.title, [
      grid(plot, 5),
      axisFrame(plot),
      bars,
      `<polyline points="${polyline}" fill="none" stroke="${GOLD}" stroke-width="3"/>`,
      pointSvg,
      `<text x="${plot.x - 54}" y="${plot.y + plot.h / 2}" transform="rotate(-90 ${plot.x - 54} ${plot.y + plot.h / 2})" text-anchor="middle" class="axis">${escapeXml(args.yLabel)}</text>`,
      `<text x="${plot.x + plot.w / 2}" y="${height - 32}" text-anchor="middle" class="axis">${escapeXml(args.xLabel)}</text>`,
      legend(plot.x + plot.w - 210, plot.y - 22, [['Annual records', GREEN], ['Cumulative records', GOLD]]),
    ].join('\n')),
  };
}

function multiLineTrend(
  title: string,
  series: Array<{ keyword: string; points: Array<{ year: number; count: number }> }>
): { svg: string; status: 'ready' | 'empty' } {
  const usable = series.filter(item => item.points.length > 0);
  if (!usable.length) return emptySvg(title, 'No keyword-year trend data available.');
  const width = 1120;
  const height = 560;
  const plot = { x: 82, y: 72, w: 820, h: 350 };
  const years = Array.from(new Set(usable.flatMap(item => item.points.map(point => point.year)))).sort((a, b) => a - b);
  const max = Math.max(...usable.flatMap(item => item.points.map(point => point.count)), 1);
  const colors = [DARK, GREEN, GREEN_2, GOLD, '#6d7d39', '#8fb7a1', '#2f5d50', '#a5c9b4'];
  const xForYear = (year: number) => {
    const index = years.indexOf(year);
    return plot.x + (years.length <= 1 ? plot.w / 2 : (index / (years.length - 1)) * plot.w);
  };
  const lines = usable.map((item, index) => {
    const color = colors[index % colors.length];
    const points = item.points
      .sort((a, b) => a.year - b.year)
      .map(point => ({ x: xForYear(point.year), y: plot.y + plot.h - (point.count / max) * plot.h }));
    return [
      `<polyline points="${points.map(point => `${point.x},${point.y}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2.5"/>`,
      ...points.map(point => `<circle cx="${point.x}" cy="${point.y}" r="3.5" fill="${color}"/>`),
      `<rect x="${930}" y="${78 + index * 24}" width="12" height="12" fill="${color}"/><text x="948" y="${89 + index * 24}" class="small">${escapeXml(truncate(item.keyword, 22))}</text>`,
    ].join('\n');
  }).join('\n');
  const xLabels = years.map(year => `<text x="${xForYear(year)}" y="${plot.y + plot.h + 24}" text-anchor="middle" class="small">${year}</text>`).join('\n');
  return {
    status: 'ready',
    svg: svgShell(width, height, title, [grid(plot, 5), axisFrame(plot), lines, xLabels].join('\n')),
  };
}

function burstChart(title: string, rows: Array<{ keyword: string; score: number; recentCount: number; baselineCount: number }>): { svg: string; status: 'ready' | 'empty' } {
  const data = rows.filter(row => row.score > 0).map(row => ({ label: row.keyword, count: row.score, percentage: row.recentCount - row.baselineCount }));
  return horizontalBarChart(title, data, 'Burst score');
}

function topicEvolutionFigure(analysis: BibliometricAnalysis): { svg: string; status: 'ready' | 'empty' } {
  const periods = analysis.topicEvolution.filter(period => period.topKeywords.length > 0);
  if (!periods.length) return emptySvg('Topic evolution by period', 'No topic evolution data available.');
  const width = 1120;
  const height = Math.max(480, 110 + periods.length * 96);
  const rowH = 82;
  const body = periods.map((period, index) => {
    const y = 80 + index * rowH;
    const keywords = period.topKeywords.slice(0, 8);
    const max = Math.max(...keywords.map(item => item.count), 1);
    return [
      `<text x="70" y="${y + 30}" class="label">${escapeXml(period.period)}</text>`,
      ...keywords.map((item, keywordIndex) => {
        const r = 8 + (item.count / max) * 18;
        const x = 250 + keywordIndex * 100;
        return `<circle cx="${x}" cy="${y + 30}" r="${r}" fill="${keywordIndex % 2 ? GREEN_2 : GREEN}" opacity="0.86"/><text x="${x}" y="${y + 68}" text-anchor="middle" class="tiny">${escapeXml(truncate(item.label, 13))}</text>`;
      }),
    ].join('\n');
  }).join('\n');
  return {
    status: 'ready',
    svg: svgShell(width, height, 'Topic evolution by period', [
      `<rect x="44" y="52" width="1032" height="${height - 96}" fill="${LIGHT}" opacity="0.45" rx="8"/>`,
      body,
      `<text x="250" y="${height - 28}" class="tiny" fill="${MUTED}">Bubble size indicates keyword frequency within each period.</text>`,
    ].join('\n')),
  };
}

function networkFigure(title: string, network: BibliometricNetwork, kind: string): { svg: string; status: 'ready' | 'empty' } {
  if (!network.nodes.length || !network.edges.length) return emptySvg(title, 'Network edges are insufficient for visualization.');
  const width = 1120;
  const height = 660;
  return {
    status: 'ready',
    svg: svgShell(width, height, title, networkPanelSvg(network, 52, 74, 1016, 520, kind)),
  };
}

function collaborationFigure(analysis: BibliometricAnalysis): { svg: string; status: 'ready' | 'empty' } {
  const hasAny = [analysis.authorNetwork, analysis.institutionNetwork, analysis.countryNetwork].some(network => network.nodes.length && network.edges.length);
  if (!hasAny) return emptySvg('Collaboration networks', 'Collaboration network data are insufficient.');
  const width = 1200;
  const height = 760;
  return {
    status: 'ready',
    svg: svgShell(width, height, 'Collaboration networks', [
      networkPanelSvg(analysis.authorNetwork, 44, 80, 540, 285, 'authors'),
      networkPanelSvg(analysis.institutionNetwork, 616, 80, 540, 285, 'institutions'),
      networkPanelSvg(analysis.countryNetwork, 330, 410, 540, 285, 'countries/regions'),
    ].join('\n')),
  };
}

function qualityFigure(analysis: BibliometricAnalysis, dataset: WosPlainTextDataset): { svg: string; status: 'ready' | 'empty' } {
  const rows: BibliometricRankItem[] = [
    { label: 'Records with DOI', count: dataset.quality.doiCount, percentage: percentage(dataset.quality.doiCount, dataset.quality.recordCount) },
    { label: 'Records with abstract', count: dataset.quality.abstractCount, percentage: percentage(dataset.quality.abstractCount, dataset.quality.recordCount) },
    { label: 'Records with references', count: analysis.summary.referenceCount, percentage: percentage(analysis.summary.referenceCount, dataset.quality.recordCount) },
    { label: 'References with DOI', count: dataset.quality.referencesWithDoi, percentage: percentage(dataset.quality.referencesWithDoi, dataset.quality.citedReferenceCount) },
    { label: 'References with year', count: dataset.quality.referencesWithYear, percentage: percentage(dataset.quality.referencesWithYear, dataset.quality.citedReferenceCount) },
    { label: 'Affiliation rows', count: dataset.quality.affiliationCount, percentage: percentage(dataset.quality.affiliationCount, Math.max(1, dataset.quality.recordCount)) },
  ];
  return horizontalBarChart('Data completeness and quality control', rows, 'Count');
}

function networkPanelSvg(network: BibliometricNetwork, x: number, y: number, width: number, height: number, label: string): string {
  if (!network.nodes.length || !network.edges.length) {
    return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="8" fill="${LIGHT}" opacity="0.45"/><text x="${x + width / 2}" y="${y + height / 2}" text-anchor="middle" class="small" fill="${MUTED}">${escapeXml(label)}: insufficient data</text>`;
  }
  const nodes = network.nodes.slice(0, 45);
  const nodeIds = new Set(nodes.map(node => node.id));
  const edges = network.edges.filter(edge => nodeIds.has(edge.source) && nodeIds.has(edge.target)).slice(0, 90);
  const cx = x + width / 2;
  const cy = y + height / 2 + 12;
  const radius = Math.min(width, height) * 0.36;
  const maxValue = Math.max(...nodes.map(node => node.value), 1);
  const positions = new Map<string, { x: number; y: number }>();
  nodes.forEach((node, index) => {
    const angle = (Math.PI * 2 * index) / nodes.length - Math.PI / 2;
    const ring = radius * (0.62 + (index % 3) * 0.14);
    positions.set(node.id, { x: cx + Math.cos(angle) * ring, y: cy + Math.sin(angle) * ring });
  });
  const edgeMax = Math.max(...edges.map(edge => edge.weight), 1);
  const edgeSvg = edges.map(edge => {
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    if (!source || !target) return '';
    return `<line x1="${source.x}" y1="${source.y}" x2="${target.x}" y2="${target.y}" stroke="${GREEN_2}" stroke-opacity="0.26" stroke-width="${1 + (edge.weight / edgeMax) * 4}"/>`;
  }).join('\n');
  const nodeSvg = nodes.map((node, index) => {
    const point = positions.get(node.id);
    if (!point) return '';
    const r = 5 + Math.sqrt(node.value / maxValue) * 16;
    const showLabel = index < 18;
    return [
      `<circle cx="${point.x}" cy="${point.y}" r="${r}" fill="${index % 2 ? GREEN_2 : GREEN}" stroke="${DARK}" stroke-width="1" opacity="0.92"/>`,
      showLabel ? `<text x="${point.x}" y="${point.y - r - 5}" text-anchor="middle" class="tiny">${escapeXml(truncate(node.label, 16))}</text>` : '',
    ].join('\n');
  }).join('\n');
  return [
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="8" fill="${LIGHT}" opacity="0.35"/>`,
    `<text x="${x + 16}" y="${y + 25}" class="label">${escapeXml(label)}</text>`,
    edgeSvg,
    nodeSvg,
  ].join('\n');
}

function svgShell(width: number, height: number, title: string, body: string): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<style>',
    `text{font-family:${FONT};fill:${TEXT};letter-spacing:0}`,
    '.title{font-size:24px;font-weight:700}',
    '.label{font-size:16px;font-weight:700}',
    '.axis{font-size:14px}',
    '.small{font-size:12px}',
    '.tiny{font-size:10px}',
    '</style>',
    '<rect width="100%" height="100%" fill="#ffffff"/>',
    `<text x="44" y="38" class="title">${escapeXml(title)}</text>`,
    body,
    '</svg>',
  ].join('\n');
}

function emptySvg(title: string, message: string): { svg: string; status: 'empty' } {
  return {
    status: 'empty',
    svg: svgShell(960, 420, title, [
      `<rect x="64" y="96" width="832" height="230" rx="10" fill="${LIGHT}" opacity="0.65"/>`,
      `<text x="480" y="205" text-anchor="middle" class="label" fill="${MUTED}">${escapeXml(message)}</text>`,
    ].join('\n')),
  };
}

function axisFrame(plot: { x: number; y: number; w: number; h: number }): string {
  return `<line x1="${plot.x}" y1="${plot.y + plot.h}" x2="${plot.x + plot.w}" y2="${plot.y + plot.h}" stroke="${DARK}" stroke-width="1.2"/><line x1="${plot.x}" y1="${plot.y}" x2="${plot.x}" y2="${plot.y + plot.h}" stroke="${DARK}" stroke-width="1.2"/>`;
}

function grid(plot: { x: number; y: number; w: number; h: number }, count: number): string {
  return Array.from({ length: count + 1 }, (_, index) => {
    const y = plot.y + (plot.h / count) * index;
    return `<line x1="${plot.x}" y1="${y}" x2="${plot.x + plot.w}" y2="${y}" stroke="${GRID}" stroke-width="1"/>`;
  }).join('\n');
}

function legend(x: number, y: number, rows: Array<[string, string]>): string {
  return rows.map((row, index) =>
    `<rect x="${x}" y="${y + index * 20}" width="13" height="13" fill="${row[1]}"/><text x="${x + 20}" y="${y + 11 + index * 20}" class="small">${escapeXml(row[0])}</text>`
  ).join('\n');
}

function buildFigureIndexMarkdown(manifest: BibliometricArtifactManifest): string {
  return [
    '# Bibliometric Figure Manifest',
    '',
    `Dataset: ${manifest.datasetId}`,
    `Generated: ${manifest.generatedAt}`,
    '',
    '## Figures',
    '',
    ...manifest.figures.map((figure, index) => `${index + 1}. **${figure.title}** (${figure.status}) - ${figure.filename}\n   - Section: ${figure.section}\n   - Data: ${figure.dataUsed.join(', ')}\n   - Use: ${figure.description}`),
    '',
    '## Tables',
    '',
    ...manifest.tables.map((table, index) => `${index + 1}. **${table.title}** - ${table.filename}\n   - ${table.description}`),
  ].join('\n');
}

function rankRows(type: string, rows: BibliometricRankItem[]): Array<Array<string | number>> {
  return rows.map((row, index) => [type, index + 1, row.label, row.count, row.percentage]);
}

function toCsv(rows: Array<Array<string | number | boolean | null>>): string {
  return rows.map(row => row.map(value => {
    const text = String(value ?? '');
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }).join(',')).join('\n');
}

function percentage(count: number, total: number): number {
  return total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
}

function escapeXml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

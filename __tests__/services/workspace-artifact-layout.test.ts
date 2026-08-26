import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  AI_WORKSPACE_CONTAINER_NAME,
  PROJECT_CUMULATIVE_ARTIFACTS_DIRECTORY_NAME,
  buildIntegratedDocx,
  canonicalAssetFilename,
  classifyAssetRole,
  figureTableDisplayLabel,
  importSourceWorkspaceAssets,
  organizeFigureTableAssets,
  parseFigureTableKey,
  scanFigureTableAssets,
} from '../../src/server/services/workspace-artifact-layout';

let tempRoot = '';

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

function createTestPng(width: number, height: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  const idat = zlib.deflateSync(scanlines);
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function createTempAiWorkRoot(): string {
  const root = fs.mkdtempSync(path.join(tempRoot, 'ai-work-'));
  fs.mkdirSync(path.join(root, 'drafts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'figures_tables'), { recursive: true });
  return root;
}

/** Minimal zip reader via the central directory (tolerates data descriptors). */
function readZipEntry(buffer: Buffer, entryName: string): Buffer | null {
  // Locate End Of Central Directory record.
  const eocdSignature = 0x06054b50;
  let eocdOffset = -1;
  const searchStart = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= searchStart; offset -= 1) {
    if (buffer.readUInt32LE(offset) === eocdSignature) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) return null;
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  const centralSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralEnd = centralOffset + centralSize;
  let offset = centralOffset;
  while (offset + 46 <= centralEnd) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const name = buffer.toString('latin1', offset + 46, offset + 46 + nameLength);
    const localOffset = buffer.readUInt32LE(offset + 42);
    if (name === entryName) {
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const data = buffer.subarray(dataStart, dataStart + compressedSize);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return zlib.inflateRawSync(data);
      throw new Error(`Unsupported zip method ${method} for ${entryName}`);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

beforeAll(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-layout-test-'));
});

afterAll(() => {
  if (tempRoot && fs.existsSync(tempRoot)) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe('parseFigureTableKey', () => {
  it('parses latin and CJK figure/table keys', () => {
    expect(parseFigureTableKey('figure1')).toEqual({ kind: 'figure', index: 1 });
    expect(parseFigureTableKey('Figure 3')).toEqual({ kind: 'figure', index: 3 });
    expect(parseFigureTableKey('fig2')).toEqual({ kind: 'figure', index: 2 });
    expect(parseFigureTableKey('图 4')).toEqual({ kind: 'figure', index: 4 });
    expect(parseFigureTableKey('table1')).toEqual({ kind: 'table', index: 1 });
    expect(parseFigureTableKey('Table 12')).toEqual({ kind: 'table', index: 12 });
    expect(parseFigureTableKey('表 5')).toEqual({ kind: 'table', index: 5 });
  });

  it('rejects names without a numeric index', () => {
    expect(parseFigureTableKey('last_plot')).toBeNull();
    expect(parseFigureTableKey('figure_')).toBeNull();
    expect(parseFigureTableKey('summary')).toBeNull();
    expect(parseFigureTableKey('')).toBeNull();
  });

  it('produces display labels', () => {
    expect(figureTableDisplayLabel('figure1')).toBe('Figure 1');
    expect(figureTableDisplayLabel('table2')).toBe('Table 2');
  });
});

describe('canonicalAssetFilename / classifyAssetRole', () => {
  it('classifies asset roles by extension', () => {
    expect(classifyAssetRole('a.png')).toBe('image');
    expect(classifyAssetRole('a.pdf')).toBe('pdf');
    expect(classifyAssetRole('a.R')).toBe('code');
    expect(classifyAssetRole('a.py')).toBe('code');
    expect(classifyAssetRole('a.csv')).toBe('data');
    expect(classifyAssetRole('a.xlsx')).toBe('data');
    expect(classifyAssetRole('a.docx')).toBe('other');
  });

  it('builds canonical file names inside a figure/table folder', () => {
    expect(canonicalAssetFilename('figure1', 'image', 'fig1.png')).toBe('figure1.png');
    expect(canonicalAssetFilename('figure1', 'pdf', 'plot.pdf')).toBe('figure1.pdf');
    expect(canonicalAssetFilename('figure2', 'code', 'script.R')).toBe('figure2.R');
    expect(canonicalAssetFilename('table1', 'data', 'data.csv')).toBe('table1_data.csv');
  });
});

describe('organizeFigureTableAssets', () => {
  it('moves loose assets into canonical folders and word drafts into drafts/', async () => {
    const root = createTempAiWorkRoot();
    fs.writeFileSync(path.join(root, 'fig1.png'), createTestPng(8, 6));
    fs.writeFileSync(path.join(root, 'table2.csv'), 'a,b\n1,2\n');
    fs.writeFileSync(path.join(root, 'paper_draft.docx'), 'PK');
    fs.writeFileSync(path.join(root, 'mystery.xlsx'), 'x');
    fs.writeFileSync(path.join(root, 'plot_codes.R'), '# code');

    const result = await organizeFigureTableAssets(root, { mode: 'move' });

    expect(fs.existsSync(path.join(root, 'figures_tables', 'figure1', 'figure1.png'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'figures_tables', 'table2', 'table2_data.csv'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'drafts', 'paper_draft.docx'))).toBe(true);

    expect(result.moved.map(item => item.to)).toContain('figures_tables/figure1/figure1.png');
    expect(result.moved.map(item => item.to)).toContain('figures_tables/table2/table2_data.csv');
    expect(result.moved.map(item => item.to)).toContain('drafts/paper_draft.docx');

    const unclassifiedPaths = result.unclassified.map(item => item.path);
    expect(unclassifiedPaths).toContain('mystery.xlsx');
    expect(unclassifiedPaths).toContain('plot_codes.R');
  });

  it('dry-run reports moves without touching files', async () => {
    const root = createTempAiWorkRoot();
    fs.writeFileSync(path.join(root, 'figure2.png'), createTestPng(8, 6));

    const result = await organizeFigureTableAssets(root, { mode: 'dry-run' });

    expect(result.moved.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(root, 'figure2.png'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'figures_tables', 'figure2', 'figure2.png'))).toBe(false);
  });

  it('scan groups already-canonical assets without moving them again', async () => {
    const root = createTempAiWorkRoot();
    const figure1Dir = path.join(root, 'figures_tables', 'figure1');
    fs.mkdirSync(figure1Dir, { recursive: true });
    fs.writeFileSync(path.join(figure1Dir, 'figure1.png'), createTestPng(8, 6));
    fs.writeFileSync(path.join(figure1Dir, 'figure1_data.csv'), 'x\n1\n');

    const { entries } = await scanFigureTableAssets(root);
    const figure1 = entries.find(entry => entry.key === 'figure1');
    expect(figure1).toBeDefined();
    expect(figure1!.assets.map(asset => asset.role)).toContain('image');
    expect(figure1!.assets.map(asset => asset.role)).toContain('data');
    expect(figure1!.assets.every(asset => asset.canonical)).toBe(true);
  });
});

describe('importSourceWorkspaceAssets', () => {
  it('copies source assets into the canonical structure without touching the source', async () => {
    const sourceRoot = fs.mkdtempSync(path.join(tempRoot, 'source-'));
    const aiWorkRoot = createTempAiWorkRoot();

    const sourceFigureDir = path.join(sourceRoot, 'results');
    fs.mkdirSync(sourceFigureDir, { recursive: true });
    const pngBuffer = createTestPng(16, 10);
    fs.writeFileSync(path.join(sourceFigureDir, 'fig1.png'), pngBuffer);
    fs.writeFileSync(path.join(sourceRoot, 'manuscript.docx'), 'PK-draft');
    fs.writeFileSync(path.join(sourceRoot, 'notes.xlsx'), 'x');

    const result = await importSourceWorkspaceAssets(sourceRoot, aiWorkRoot, { mode: 'copy' });

    // Copied into the canonical structure.
    expect(fs.existsSync(path.join(aiWorkRoot, 'figures_tables', 'figure1', 'figure1.png'))).toBe(true);
    expect(fs.existsSync(path.join(aiWorkRoot, 'drafts', 'manuscript.docx'))).toBe(true);
    expect(result.imported.length).toBe(2);
    const unclassifiedPaths = result.unclassified.map(item => item.path);
    expect(unclassifiedPaths).toContain('notes.xlsx');

    // Source files remain untouched.
    expect(fs.readFileSync(path.join(sourceFigureDir, 'fig1.png'))).toEqual(pngBuffer);
    expect(fs.readFileSync(path.join(sourceRoot, 'manuscript.docx')).toString('latin1')).toBe('PK-draft');
    expect(fs.existsSync(path.join(sourceFigureDir, 'fig1.png'))).toBe(true);
    expect(fs.existsSync(path.join(sourceRoot, 'manuscript.docx'))).toBe(true);
  });

  it('is idempotent: re-import only copies newly added source files (incremental growth)', async () => {
    const sourceRoot = fs.mkdtempSync(path.join(tempRoot, 'source-incremental-'));
    const aiWorkRoot = createTempAiWorkRoot();

    fs.writeFileSync(path.join(sourceRoot, 'figure1.png'), createTestPng(8, 6));
    const first = await importSourceWorkspaceAssets(sourceRoot, aiWorkRoot, { mode: 'copy' });
    expect(first.imported.length).toBe(1);

    // Re-import with no changes: nothing new.
    const second = await importSourceWorkspaceAssets(sourceRoot, aiWorkRoot, { mode: 'copy' });
    expect(second.imported.length).toBe(0);
    expect(second.skipped.length).toBe(1); // figure1.png already exists in the AI work root

    // A newly added table is picked up on the next run.
    fs.writeFileSync(path.join(sourceRoot, 'table2.csv'), 'a,b\n1,2\n');
    const third = await importSourceWorkspaceAssets(sourceRoot, aiWorkRoot, { mode: 'copy' });
    expect(third.imported.map(item => item.to)).toContain('figures_tables/table2/table2_data.csv');

    const { entries } = await scanFigureTableAssets(aiWorkRoot);
    const keys = entries.map(entry => entry.key);
    expect(keys).toContain('figure1');
    expect(keys).toContain('table2');
  });

  it('never treats the AI workspace container as source material', async () => {
    const sourceRoot = fs.mkdtempSync(path.join(tempRoot, 'source-nested-'));
    // Simulate the real layout: the AI workspace container lives inside the user root.
    const container = path.join(sourceRoot, AI_WORKSPACE_CONTAINER_NAME, 'Conversation-test');
    const aiWorkRoot = path.join(container);
    fs.mkdirSync(path.join(aiWorkRoot, 'figures_tables', 'figure9'), { recursive: true });
    fs.writeFileSync(path.join(aiWorkRoot, 'figures_tables', 'figure9', 'figure9.png'), createTestPng(8, 6));
    fs.writeFileSync(path.join(sourceRoot, 'figure1.png'), createTestPng(8, 6));

    const result = await importSourceWorkspaceAssets(sourceRoot, aiWorkRoot, { mode: 'copy' });

    // Only the source file is imported; the container's own figure9 is not copied again.
    expect(result.imported.map(item => item.to)).toContain('figures_tables/figure1/figure1.png');
    expect(result.imported.map(item => item.to)).not.toContain('figures_tables/figure9/figure9.png');
  });
});

describe('buildIntegratedDocx', () => {
  it('keeps historical figures when a later conversation rebuilds the stable document', async () => {
    const projectRoot = path.join(tempRoot, 'cross-conversation-project');
    const firstConversation = path.join(projectRoot, 'Conversation-first');
    const secondConversation = path.join(projectRoot, 'Conversation-second');
    const firstFigureDir = path.join(firstConversation, 'figures_tables', 'figure1');
    const secondFigureDir = path.join(secondConversation, 'figures_tables', 'figure2');
    fs.mkdirSync(firstFigureDir, { recursive: true });
    fs.mkdirSync(secondFigureDir, { recursive: true });
    fs.writeFileSync(path.join(firstFigureDir, 'figure1.png'), createTestPng(80, 60));
    fs.writeFileSync(path.join(firstFigureDir, 'figure1_caption.txt'), 'Historical figure\nFirst conversation.');
    fs.writeFileSync(path.join(secondFigureDir, 'figure2.png'), createTestPng(90, 70));
    fs.writeFileSync(path.join(secondFigureDir, 'figure2_caption.txt'), 'Current figure\nSecond conversation.');

    await buildIntegratedDocx(firstConversation);
    const result = await buildIntegratedDocx(secondConversation);
    const docx = fs.readFileSync(result.docxPath);
    const documentXml = readZipEntry(docx, 'word/document.xml')!.toString('utf-8');

    expect(result.included.map(item => item.key)).toEqual(['figure1', 'figure2']);
    expect(readZipEntry(docx, 'word/media/figure1.png')).not.toBeNull();
    expect(readZipEntry(docx, 'word/media/figure2.png')).not.toBeNull();
    expect(documentXml).toContain('Historical figure');
    expect(documentXml).toContain('Current figure');
    expect(fs.existsSync(path.join(
      projectRoot,
      PROJECT_CUMULATIVE_ARTIFACTS_DIRECTORY_NAME,
      'figures_tables',
      'figure1',
      'figure1.png',
    ))).toBe(true);
  });

  it('embeds figure image with caption below and table with title above / note below', async () => {
    const root = createTempAiWorkRoot();

    const figure1Dir = path.join(root, 'figures_tables', 'figure1');
    fs.mkdirSync(figure1Dir, { recursive: true });
    fs.writeFileSync(path.join(figure1Dir, 'figure1.png'), createTestPng(120, 80));
    fs.writeFileSync(
      path.join(figure1Dir, 'figure1_caption.txt'),
      'Treatment effects by group\n数据来自实验记录。'
    );

    const table1Dir = path.join(root, 'figures_tables', 'table1');
    fs.mkdirSync(table1Dir, { recursive: true });
    fs.writeFileSync(
      path.join(table1Dir, 'table1_data.csv'),
      'group,mean,sd\ncontrol,10,1.2\ntreated,14,2.1\n'
    );
    fs.writeFileSync(
      path.join(table1Dir, 'table1_caption.txt'),
      'Summary statistics\n单位：%'
    );

    const result = await buildIntegratedDocx(root);

    expect(result.included.length).toBe(2);
    expect(result.skipped.length).toBe(0);
    expect(fs.existsSync(result.docxPath)).toBe(true);

    const docx = fs.readFileSync(result.docxPath);
    const documentXml = readZipEntry(docx, 'word/document.xml')!.toString('utf-8');
    const contentTypes = readZipEntry(docx, '[Content_Types].xml')!.toString('utf-8');
    const rels = readZipEntry(docx, 'word/_rels/document.xml.rels')!.toString('utf-8');

    // Embedded media + drawing + caption + table + note all present.
    expect(readZipEntry(docx, 'word/media/figure1.png')).not.toBeNull();
    expect(rels).toContain('media/figure1.png');
    expect(contentTypes).toContain('png');
    expect(documentXml).toContain('wp:inline');
    expect(documentXml).toContain('Treatment effects by group');
    expect(documentXml).toContain('<w:tbl>');
    expect(documentXml).toContain('Summary statistics');
    expect(documentXml).toContain('单位：%');
    expect(documentXml).toContain('文件位置：');
    expect(documentXml).toContain('figure1.png');
    expect(documentXml).toContain('table1_data.csv');

    // Caption must appear AFTER the image drawing; table note AFTER the table.
    const drawingIndex = documentXml.indexOf('wp:inline');
    const captionIndex = documentXml.indexOf('Treatment effects by group');
    expect(captionIndex).toBeGreaterThan(drawingIndex);

    const tableStart = documentXml.indexOf('<w:tbl>');
    const tableTitleIndex = documentXml.indexOf('Summary statistics');
    expect(tableTitleIndex).toBeGreaterThan(-1);
    expect(tableTitleIndex).toBeLessThan(tableStart);

    const tableEnd = documentXml.indexOf('</w:tbl>');
    const noteIndex = documentXml.indexOf('单位：%');
    expect(noteIndex).toBeGreaterThan(tableEnd);
  });

  it('skips figure folders without images and table folders without csv data', async () => {
    const root = createTempAiWorkRoot();
    const figure3Dir = path.join(root, 'figures_tables', 'figure3');
    fs.mkdirSync(figure3Dir, { recursive: true });
    fs.writeFileSync(path.join(figure3Dir, 'figure3.R'), '# code only');

    const table4Dir = path.join(root, 'figures_tables', 'table4');
    fs.mkdirSync(table4Dir, { recursive: true });
    fs.writeFileSync(path.join(table4Dir, 'table4.pdf'), '%pdf');

    const result = await buildIntegratedDocx(root);
    const skippedKeys = result.skipped.map(item => item.key);
    expect(skippedKeys).toContain('figure3');
    expect(skippedKeys).toContain('table4');
  });

  it('builds the stable supplementary Word from supplementary figure/table folders', async () => {
    const root = createTempAiWorkRoot();
    const figureDir = path.join(root, 'supplementary', 'figure1');
    const tableDir = path.join(root, 'supplementary', 'table1');
    fs.mkdirSync(figureDir, { recursive: true });
    fs.mkdirSync(tableDir, { recursive: true });
    fs.writeFileSync(path.join(figureDir, 'figure1.png'), createTestPng(100, 60));
    fs.writeFileSync(path.join(figureDir, 'figure1_caption.txt'), 'Supplementary Figure S1\n完整图注。');
    fs.writeFileSync(path.join(tableDir, 'table1_data.csv'), 'group,value\nA,1\nB,2\n');
    fs.writeFileSync(path.join(tableDir, 'table1_caption.txt'), 'Supplementary Table S1\n完整表注。');

    const result = await buildIntegratedDocx(root, {}, { collection: 'supplementary' });

    expect(result.docxPath).toBe(path.join(root, 'supplementary', 'supplementary-materials.docx'));
    expect(result.included).toHaveLength(2);
    const documentXml = readZipEntry(fs.readFileSync(result.docxPath), 'word/document.xml')!.toString('utf-8');
    expect(documentXml).toContain('补充材料（图片与表格）');
    expect(documentXml).toContain('Supplementary Figure S1');
    expect(documentXml).toContain('Supplementary Table S1');
    expect(documentXml.match(/文件位置：/g)).toHaveLength(2);
  });
});

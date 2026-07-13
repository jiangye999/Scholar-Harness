import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

import { describe, expect, it } from "vitest";
import {
  buildWordDraftDocxBuffer,
  buildWordDraftDocumentXml,
  buildWordDraftStylesXml,
  extractReferenceBlockForWord,
  writeWordDraftDocx,
} from "../../src/utils/word-draft-docx";

const REFERENCE_WITH_TRAILING_BODY = `References
[11] Yang J, et al. Will Maize-Based Cropping Systems Reduce Water Consumption without Compromise of Food Security in the North China Plain?[J]. Water, 2020, 12(5): 1281. DOI: 10.3390/w12051281. Agricultural soils constitute the predominant anthropogenic source of atmospheric nitrous oxide and nitric oxide.`;

describe("word draft DOCX export", () => {
  it("splits a DOI-terminated reference from the following prose paragraph", () => {
    const extracted = extractReferenceBlockForWord(REFERENCE_WITH_TRAILING_BODY);

    expect(extracted.references).toContain("Will Maize-Based Cropping Systems");
    expect(extracted.references).toContain("10.3390/w12051281");
    expect(extracted.references).not.toContain("Agricultural soils constitute");
    expect(extracted.trailingBody).toContain("Agricultural soils constitute");
  });

  it("renders references and the following prose as separate Word paragraphs with a blank line", () => {
    const xml = buildWordDraftDocumentXml(`\\section{Introduction}
${REFERENCE_WITH_TRAILING_BODY}`);

    const referenceItem = xml.match(/<w:pStyle w:val="ReferenceItem"\/>[\s\S]*?<\/w:p>/)?.[0] || "";
    expect(referenceItem).toContain("Will Maize-Based Cropping Systems");
    expect(referenceItem).not.toContain("Agricultural soils constitute");

    const referenceIndex = xml.indexOf("10.3390/w12051281");
    const trailingIndex = xml.indexOf("Agricultural soils constitute");
    expect(referenceIndex).toBeGreaterThan(-1);
    expect(trailingIndex).toBeGreaterThan(referenceIndex);
    expect(xml.slice(referenceIndex, trailingIndex)).toContain("<w:t></w:t>");
  });

  it('uses Times New Roman for all document runs and paragraph styles', () => {
    const content = '\\title{Test paper}\n\\section{Results}\n## Treatment response\nUpdated result.\n\nReferences\n[1] Zhang X. Test reference. 2026.';
    const documentXml = buildWordDraftDocumentXml(content);
    const stylesXml = buildWordDraftStylesXml();
    const expectedFonts = 'w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"';

    expect(documentXml).toContain(expectedFonts);
    expect(stylesXml).toContain(expectedFonts);
    expect(stylesXml.match(/w:eastAsia="Times New Roman"/g)?.length).toBeGreaterThanOrEqual(8);
    expect(`${documentXml}\n${stylesXml}`).not.toContain('SimSun');
  });

  it("builds a real DOCX archive buffer for deterministic file writes", async () => {
    const buffer = await buildWordDraftDocxBuffer('\\title{Test paper}\n\\section{Results}\nUpdated result.');

    expect(buffer.length).toBeGreaterThan(500);
    expect(buffer.subarray(0, 2).toString('ascii')).toBe('PK');
    expect(buffer.toString('latin1')).toContain('[Content_Types].xml');
  });

  it('overwrites an existing stale DOCX instead of treating it as a new result', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'scholar-harness-docx-'));
    const filePath = path.join(tempDir, 'paper-draft.docx');
    try {
      await writeFile(filePath, Buffer.from('stale file'));
      await writeWordDraftDocx(filePath, '\\title{Current draft}\n\\section{Discussion}\nNew content.');
      const updated = await readFile(filePath);

      expect(updated.subarray(0, 2).toString('ascii')).toBe('PK');
      expect(updated.toString('utf-8')).not.toBe('stale file');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

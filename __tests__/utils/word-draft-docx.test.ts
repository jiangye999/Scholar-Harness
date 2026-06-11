import { describe, expect, it } from "vitest";
import {
  buildWordDraftDocumentXml,
  extractReferenceBlockForWord,
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
});

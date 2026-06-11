import { CitationManager } from '../citation/citation-manager';
import { ReferenceFormatterFactory } from '../citation/formats';
import type {
  UnifiedLiterature,
  RetrievedDocument,
  ParagraphEvidence,
  WritingOutput,
  CitationStyle,
  ReferenceStyle,
  SentencePlan,
  SentenceEvidence,
} from '../../types/literature';
import type { APIClient } from '../../types';

interface GeneratorConfig {
  maxCitationsPerParagraph: number;
  citationStyle: CitationStyle;
  referenceStyle: ReferenceStyle;
  requireEvidence: boolean;
  allowParaphrasing: boolean;
}

export class ParagraphGenerator {
  private citationManager: CitationManager;
  private config: GeneratorConfig;
  private apiClient?: APIClient;
  private literatures: Map<string, UnifiedLiterature> = new Map();

  constructor(
    apiClient?: APIClient,
    config: Partial<GeneratorConfig> = {}
  ) {
    this.config = {
      maxCitationsPerParagraph: 3,
      citationStyle: 'numeric',
      referenceStyle: 'gbt7714',
      requireEvidence: true,
      allowParaphrasing: true,
      ...config,
    };
    this.citationManager = new CitationManager(this.config.citationStyle);
    this.apiClient = apiClient;
  }

  setLiteratures(literatures: Map<string, UnifiedLiterature>): void {
    this.literatures = literatures;
    this.citationManager.setLiteratures(literatures);
  }

  async generateParagraph(
    paragraphId: string,
    topic: string,
    retrievedDocs: RetrievedDocument[]
  ): Promise<ParagraphEvidence> {
    const evidenceIds = this.selectEvidence(retrievedDocs);

    let content: string;

    if (this.apiClient) {
      content = await this.generateWithAI(topic, evidenceIds);
    } else {
      content = this.generateFromEvidence(topic, evidenceIds);
    }

    const citations = this.citationManager.bindCitations(paragraphId, evidenceIds);
    const citationStr = this.citationManager.formatCitationMarks(citations);

    const contentWithCitations = citationStr
      ? `${content}${citationStr}`
      : content;

    return {
      paragraphId,
      content: contentWithCitations,
      evidenceIds,
      generated: true,
    };
  }

  async generate(
    topic: string,
    retrievedDocs: RetrievedDocument[],
    expectedParagraphs: number = 3
  ): Promise<WritingOutput> {
    this.citationManager.reset();
    this.citationManager.setLiteratures(this.literatures);

    const paragraphs: ParagraphEvidence[] = [];

    for (let i = 0; i < expectedParagraphs; i++) {
      const paraId = `para-${i}`;
      const para = await this.generateParagraph(paraId, topic, retrievedDocs);
      paragraphs.push(para);
    }

    const usedIds = this.citationManager.getUsedLiteratureIds();
    const usedLiteratures = usedIds
      .map((id: string) => this.literatures.get(id))
      .filter(Boolean) as UnifiedLiterature[];

    const citationOrder = new Map<string, number>(
      this.citationManager.getAllCitations().map((c: { literatureId: string; numericId?: number }) => [c.literatureId, c.numericId!])
    );

    const formatter = ReferenceFormatterFactory.create(this.config.referenceStyle);
    const references = formatter.formatAll(usedLiteratures, citationOrder);

    const generatedText = paragraphs.map(p => p.content).join('\n\n');

    return {
      generatedText,
      paragraphs,
      references,
      citationStyle: this.config.citationStyle,
      referenceStyle: this.config.referenceStyle,
      statistics: {
        totalParagraphs: paragraphs.length,
        totalCitations: this.citationManager.getCitationCount(),
        uniqueReferences: usedLiteratures.length,
      },
    };
  }

  private selectEvidence(
    documents: RetrievedDocument[],
    maxCount: number = this.config.maxCitationsPerParagraph
  ): string[] {
    const selected: string[] = [];
    const seenAuthors = new Set<string>();

    const sorted = documents.sort((a, b) => b.combinedScore - a.combinedScore);

    for (const doc of sorted) {
      if (selected.length >= maxCount) break;

      const firstAuthor = doc.authors[0]?.name;
      if (firstAuthor && !seenAuthors.has(firstAuthor)) {
        selected.push(doc.id);
        seenAuthors.add(firstAuthor);
      } else if (!firstAuthor) {
        selected.push(doc.id);
      }
    }

    return selected;
  }

  private async generateWithAI(topic: string, evidenceIds: string[]): Promise<string> {
    if (!this.apiClient) {
      return this.generateFromEvidence(topic, evidenceIds);
    }

    const evidence = evidenceIds.map(id => {
      const lit = this.literatures.get(id);
      if (!lit) return '';
      return `标题: ${lit.title || ''}\n作者: ${(lit.authors || []).map(a => a.name).join(', ')}\n年份: ${lit.year || ''}\n期刊: ${lit.journal || ''}\nDOI: ${lit.doi || 'N/A'}\n关键词: ${Array.isArray(lit.keywords) ? lit.keywords.join(', ') : (lit.keywords || '')}\n摘要: ${lit.abstract || ''}`;
    }).filter(Boolean).join('\n\n');

    const prompt = `Write an academic paragraph about "${topic}" based on the following evidence:

${evidence}

Requirements:
1. Use only the provided evidence
2. Write in academic style
3. Be concise and focused
4. Do not fabricate information

Write the paragraph:`;

    const response = await this.apiClient.chat({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      maxTokens: 1000,
    });

    return response.trim();
  }

  private generateFromEvidence(topic: string, evidenceIds: string[]): string {
    const evidence = evidenceIds.map(id => {
      const lit = this.literatures.get(id);
      if (!lit) return '';
      return `根据 ${lit.authors[0]?.name || '研究者'} (${lit.year}) 的研究，${lit.abstract}`;
    }).filter(Boolean).join(' ');

    return `Regarding ${topic}, existing research provides valuable insights. ${evidence}`;
  }

  getCitationManager(): CitationManager {
    return this.citationManager;
  }

  setConfig(config: Partial<GeneratorConfig>): void {
    Object.assign(this.config, config);
    this.citationManager.setStyle(this.config.citationStyle);
  }

  // ========== 句子级生成方法 ==========

  async generateSentenceLevel(
    paragraphTopic: string,
    sentencePlans: SentencePlan[],
    allRetrievedDocs: RetrievedDocument[]
  ): Promise<ParagraphEvidence & { sentences: SentenceEvidence[] }> {
    const sentences: SentenceEvidence[] = [];
    const paragraphId = `para-${Date.now()}`;

    for (const plan of sentencePlans) {
      const relevantDocs = this.filterDocsForSentence(plan, allRetrievedDocs);
      const sentenceEvidence = await this.generateSingleSentence(plan, relevantDocs);
      sentences.push(sentenceEvidence);
    }

    const content = sentences.map(s => s.content).join(' ');
    const allEvidenceIds = [...new Set(sentences.flatMap(s => s.evidenceIds))];

    const citations = this.citationManager.bindCitations(paragraphId, allEvidenceIds);
    const citationStr = this.citationManager.formatCitationMarks(citations);

    const contentWithCitations = citationStr
      ? `${content}${citationStr}`
      : content;

    return {
      paragraphId,
      content: contentWithCitations,
      evidenceIds: allEvidenceIds,
      generated: true,
      sentences,
    };
  }

  private filterDocsForSentence(
    plan: SentencePlan,
    allDocs: RetrievedDocument[]
  ): RetrievedDocument[] {
    return allDocs.filter(doc => {
      const docText = `${doc.title || ''} ${doc.abstract || ''} ${Array.isArray(doc.keywords) ? doc.keywords.join(' ') : (doc.keywords || '')}`.toLowerCase();
      const matchCount = plan.keywords.reduce((count, keyword) => {
        return count + (docText.includes(keyword.toLowerCase()) ? 1 : 0);
      }, 0);
      return matchCount > 0;
    }).sort((a, b) => {
      const scoreA = this.calculateSentenceMatchScore(a, plan.keywords);
      const scoreB = this.calculateSentenceMatchScore(b, plan.keywords);
      return scoreB - scoreA;
    }).slice(0, plan.expectedCitations + 2);
  }

  private calculateSentenceMatchScore(doc: RetrievedDocument, keywords: string[]): number {
    const docText = `${doc.title || ''} ${doc.abstract || ''} ${Array.isArray(doc.keywords) ? doc.keywords.join(' ') : (doc.keywords || '')}`.toLowerCase();
    return keywords.reduce((score, keyword) => {
      return score + (docText.includes(keyword.toLowerCase()) ? 1 : 0);
    }, 0);
  }

  private async generateSingleSentence(
    plan: SentencePlan,
    relevantDocs: RetrievedDocument[]
  ): Promise<SentenceEvidence> {
    if (!this.apiClient || relevantDocs.length === 0) {
      return {
        sentenceId: plan.sentenceId,
        content: `${plan.intent} (相关文献支持)`,
        evidenceIds: relevantDocs.map(d => d.id),
        intent: plan.intent,
      };
    }

    const prompt = this.formatSentencePrompt(plan.intent, relevantDocs);

    const response = await this.apiClient.chat({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      maxTokens: 500,
    });

    return {
      sentenceId: plan.sentenceId,
      content: response.trim(),
      evidenceIds: relevantDocs.map(d => d.id),
      intent: plan.intent,
    };
  }

  private formatSentencePrompt(intent: string, docs: RetrievedDocument[]): string {
    const docsInfo = docs.map((doc, index) => {
      return `文献 ${index + 1}:
标题: ${doc.title}
作者: ${doc.authors.map(a => a.name).join(', ')}
年份: ${doc.year}
期刊: ${doc.journal || ''}
DOI: ${doc.doi || 'N/A'}
关键词: ${Array.isArray(doc.keywords) ? doc.keywords.join(', ') : (doc.keywords || '')}
摘要: ${doc.abstract || ''}

`;
    }).join('');

    return `请根据以下文献信息，撰写一个学术句子。

写作意图: ${intent}

可用文献：
${docsInfo}

要求：
1. 基于提供的文献信息撰写
2. 使用学术写作风格
3. 可以引用多篇文献
4. 不要编造文献中不存在的信息
5. 句子长度适中（20-50字）

请直接输出句子内容，不需要额外说明：`;
  }
}

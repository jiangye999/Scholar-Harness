import type { APIClient, ChapterPlan, GeneratedSkill, LiteratureReference } from '../types';
export interface SecondaryAgentConfig {
    models: Record<string, string>;
}
export declare class SecondaryAgent {
    private apiClient;
    private models;
    constructor(apiClient: APIClient, config: SecondaryAgentConfig);
    writeSection(input: {
        skill: GeneratedSkill;
        chapterPlan: ChapterPlan;
        researchContent: string;
        styleGuide?: string;
        chapterName: string;
    }): Promise<string>;
    private buildWritingPrompt;
    private addCitations;
    private analyzeCitationNeeds;
    private formatLatex;
    searchLiterature(query: string): Promise<LiteratureReference[]>;
}
export default SecondaryAgent;
//# sourceMappingURL=secondary-agent.d.ts.map
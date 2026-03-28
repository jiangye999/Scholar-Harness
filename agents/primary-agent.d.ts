import { z } from 'zod';
import type { APIClient } from '../types/api';
export declare const ChapterPlanSchema: z.ZodObject<{
    chapterName: z.ZodString;
    writingFocus: z.ZodString;
    keyPoints: z.ZodArray<z.ZodString, "many">;
    specialRequirements: z.ZodOptional<z.ZodString>;
    wordCountTarget: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    chapterName: string;
    writingFocus: string;
    keyPoints: string[];
    specialRequirements?: string | undefined;
    wordCountTarget?: number | undefined;
}, {
    chapterName: string;
    writingFocus: string;
    keyPoints: string[];
    specialRequirements?: string | undefined;
    wordCountTarget?: number | undefined;
}>;
export declare const SkillGenerationInputSchema: z.ZodObject<{
    chapterName: z.ZodString;
    userPlan: z.ZodObject<{
        chapterName: z.ZodString;
        writingFocus: z.ZodString;
        keyPoints: z.ZodArray<z.ZodString, "many">;
        specialRequirements: z.ZodOptional<z.ZodString>;
        wordCountTarget: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        chapterName: string;
        writingFocus: string;
        keyPoints: string[];
        specialRequirements?: string | undefined;
        wordCountTarget?: number | undefined;
    }, {
        chapterName: string;
        writingFocus: string;
        keyPoints: string[];
        specialRequirements?: string | undefined;
        wordCountTarget?: number | undefined;
    }>;
    styleGuide: z.ZodOptional<z.ZodString>;
    researchContent: z.ZodString;
}, "strip", z.ZodTypeAny, {
    chapterName: string;
    userPlan: {
        chapterName: string;
        writingFocus: string;
        keyPoints: string[];
        specialRequirements?: string | undefined;
        wordCountTarget?: number | undefined;
    };
    researchContent: string;
    styleGuide?: string | undefined;
}, {
    chapterName: string;
    userPlan: {
        chapterName: string;
        writingFocus: string;
        keyPoints: string[];
        specialRequirements?: string | undefined;
        wordCountTarget?: number | undefined;
    };
    researchContent: string;
    styleGuide?: string | undefined;
}>;
export type ChapterPlan = z.infer<typeof ChapterPlanSchema>;
export type SkillGenerationInput = z.infer<typeof SkillGenerationInputSchema>;
export interface GeneratedSkill {
    sectionName: string;
    userWritingFocus: string;
    userKeyPoints: string[];
    specialRequirements?: string;
    styleGuideContent: string;
    overallStructure: {
        paragraphCount: number;
        mainSections: string[];
        transitionStrategy: string;
    };
    paragraphDetails: Array<{
        paragraphId: number;
        title: string;
        purpose: string;
        contentOutline: string[];
        wordCountEstimate: number;
    }>;
    executionInstructions: string[];
}
export declare class PrimaryAgent {
    private apiClient;
    private model;
    constructor(apiClient: APIClient, model?: string);
    /**
     * 根据用户规划生成写作 skill
     */
    generateSkill(input: SkillGenerationInput): Promise<GeneratedSkill>;
    /**
     * 质量检查
     */
    qualityCheck(content: string, styleGuide: string, chapterPlan: ChapterPlan): Promise<string>;
    /**
     * 构建 skill 生成提示词
     */
    private buildSkillGenerationPrompt;
    /**
     * 解析 AI 响应
     */
    private parseSkillResponse;
    /**
     * 获取默认 skill
     */
    private getDefaultSkill;
}
export default PrimaryAgent;
//# sourceMappingURL=primary-agent.d.ts.map
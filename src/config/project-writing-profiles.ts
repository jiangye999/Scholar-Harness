export const DEFAULT_PROJECT_WRITING_PROFILE_ID = 'paper-writing';

export type ProjectWritingProfileId =
  | 'paper-writing'
  | 'paper-review'
  | 'grant-writing'
  | 'patent-writing'
  | 'software-copyright'
  | 'business-plan'
  | 'general-writing';

export interface ProjectWritingSectionProfile {
  id: string;
  title: string;
  purpose: string;
}

export interface ProjectWritingProfile {
  id: ProjectWritingProfileId;
  label: string;
  shortLabel: string;
  topicLabel: string;
  requirementLabel: string;
  oneClickTitle: string;
  oneClickAction: string;
  documentType: string;
  retrievalFocus: string;
  outlineInstruction: string;
  qualityInstruction: string;
  sections: ProjectWritingSectionProfile[];
  skillGuide: string;
}

export const PROJECT_WRITING_PROFILES: ProjectWritingProfile[] = [
  {
    id: 'paper-writing',
    label: '论文辅助写作',
    shortLabel: '论文写作',
    topicLabel: '论文主题',
    requirementLabel: '用户要求',
    oneClickTitle: '一键写论文',
    oneClickAction: '开始写论文',
    documentType: 'academic review article or research paper',
    retrievalFocus: 'peer-reviewed literature, evidence synthesis, citation-claim alignment, journal style',
    outlineInstruction: '规划为学术论文结构，优先覆盖 Introduction、Methods/Approach、Results/Evidence、Discussion、Conclusion 等章节。',
    qualityInstruction: '严格执行学术论文质量门：范围一致、引用支撑、证据边界、机制解释、研究空白、期刊风格。',
    sections: [
      { id: 'introduction', title: 'Introduction', purpose: '研究背景、问题、创新点和论文范围' },
      { id: 'methods', title: 'Methods / Approach', purpose: '研究方法、检索方法、分析框架或实验设计' },
      { id: 'results', title: 'Results / Evidence', purpose: '主要发现、证据综合和结果呈现' },
      { id: 'discussion', title: 'Discussion', purpose: '机制解释、证据强度、边界条件、矛盾、创新框架和意义' },
      { id: 'conclusion', title: 'Conclusion', purpose: '结论、贡献和未来方向' },
    ],
    skillGuide: '使用严谨学术论文写作方式。所有事实性论断都需要证据支撑，优先遵守 Auto Research 给出的 paperTopicReview、paperWritingBlueprint、contentEnhancementReport、证据层级、支持主张和 claimsToAvoid；避免泛泛综述、不受引用支持的强断言，以及把弱证据写成强结论。',
  },
  {
    id: 'paper-review',
    label: '论文辅助审阅',
    shortLabel: '论文审阅',
    topicLabel: '待审论文主题或标题',
    requirementLabel: '审阅要求',
    oneClickTitle: '一键审论文',
    oneClickAction: '开始审阅',
    documentType: 'academic manuscript review report',
    retrievalFocus: 'manuscript claims, methodological rigor, literature coverage, citation risks, revision roadmap',
    outlineInstruction: '规划为审稿报告结构，覆盖摘要诊断、主要问题、方法学审查、引用与文献审查、次要问题、修订建议。',
    qualityInstruction: '输出应像严格审稿意见：指出位置、风险、理由和可执行修改建议，避免泛泛表扬。',
    sections: [
      { id: 'summary', title: 'Manuscript Summary', purpose: '概括稿件主题、贡献主张和总体判断' },
      { id: 'major-issues', title: 'Major Issues', purpose: '列出影响录用的核心问题' },
      { id: 'methods-review', title: 'Methodological Review', purpose: '检查研究设计、方法、数据和可复现性' },
      { id: 'literature-citation-review', title: 'Literature and Citation Review', purpose: '检查文献覆盖和引用支撑关系' },
      { id: 'minor-issues', title: 'Minor Issues', purpose: '语言、格式、图表和局部表达问题' },
      { id: 'revision-roadmap', title: 'Revision Roadmap', purpose: '给出分优先级的修改路线图' },
    ],
    skillGuide: '扮演主编、方法学审稿人、领域审稿人和逻辑挑战者。每条意见要包含问题、风险和修改动作。',
  },
  {
    id: 'grant-writing',
    label: '基金辅助写作',
    shortLabel: '基金写作',
    topicLabel: '基金项目主题',
    requirementLabel: '申报要求',
    oneClickTitle: '一键写基金',
    oneClickAction: '开始写基金',
    documentType: 'research grant proposal',
    retrievalFocus: 'research significance, innovation, feasibility, technical route, expected outcomes',
    outlineInstruction: '规划为基金申请书结构，覆盖立项依据、研究目标、关键科学问题、研究内容、技术路线、创新点、基础条件和预期成果。',
    qualityInstruction: '强调科学问题凝练、创新性、可行性、技术路线闭环、风险预案和成果可考核性。',
    sections: [
      { id: 'background-significance', title: '立项依据与研究意义', purpose: '说明问题背景、需求和科学价值' },
      { id: 'objectives-questions', title: '研究目标与关键科学问题', purpose: '凝练目标、假设和关键问题' },
      { id: 'research-content', title: '研究内容', purpose: '拆解研究任务和具体内容' },
      { id: 'technical-route', title: '技术路线与方法', purpose: '说明方法、路线、数据和实验设计' },
      { id: 'innovation', title: '特色与创新点', purpose: '突出理论、方法或应用创新' },
      { id: 'feasibility', title: '研究基础与可行性', purpose: '证明团队、条件和前期基础' },
      { id: 'outcomes-plan', title: '预期成果与计划安排', purpose: '给出成果、进度和风险预案' },
    ],
    skillGuide: '基金文本要围绕“问题-目标-内容-方法-创新-可行性-成果”闭环展开，避免口号式创新。',
  },
  {
    id: 'patent-writing',
    label: '专利辅助写作',
    shortLabel: '专利写作',
    topicLabel: '发明/实用新型主题',
    requirementLabel: '技术交底与保护要求',
    oneClickTitle: '一键写专利',
    oneClickAction: '开始写专利',
    documentType: 'patent draft',
    retrievalFocus: 'technical problem, prior art, inventive step, embodiments, claims support',
    outlineInstruction: '规划为专利文本结构，覆盖技术领域、背景技术、发明内容、附图说明、具体实施方式和权利要求支撑。',
    qualityInstruction: '强调技术问题、技术方案、有益效果和权利要求支撑关系；避免把商业愿景写成技术特征。',
    sections: [
      { id: 'technical-field', title: '技术领域', purpose: '界定技术所属领域' },
      { id: 'background-art', title: '背景技术', purpose: '说明现有技术和不足' },
      { id: 'invention-summary', title: '发明内容', purpose: '说明技术问题、技术方案和有益效果' },
      { id: 'drawings', title: '附图说明', purpose: '说明附图和部件关系' },
      { id: 'embodiments', title: '具体实施方式', purpose: '给出可实施的技术方案细节' },
      { id: 'claims-support', title: '权利要求支撑要点', purpose: '梳理独立/从属权利要求的支撑材料' },
    ],
    skillGuide: '专利写作必须把每个效果落到技术特征，突出区别特征和可实施性。不要承诺无法由技术方案直接带来的效果。',
  },
  {
    id: 'software-copyright',
    label: '软著辅助写作',
    shortLabel: '软著写作',
    topicLabel: '软件名称或系统主题',
    requirementLabel: '软著材料要求',
    oneClickTitle: '一键写软著',
    oneClickAction: '开始写软著',
    documentType: 'software copyright documentation',
    retrievalFocus: 'software purpose, modules, workflow, operating environment, user manual, source description',
    outlineInstruction: '规划为软著说明材料，覆盖软件概述、运行环境、功能模块、业务流程、操作说明、技术特点和版本信息。',
    qualityInstruction: '强调功能边界清晰、模块命名一致、操作步骤可复现、避免夸大软件能力。',
    sections: [
      { id: 'software-overview', title: '软件概述', purpose: '说明软件用途、对象和应用场景' },
      { id: 'runtime-environment', title: '运行环境', purpose: '说明硬件、系统、依赖和部署条件' },
      { id: 'functional-modules', title: '功能模块', purpose: '描述模块组成和功能边界' },
      { id: 'workflow', title: '业务流程', purpose: '说明主要数据流和操作流程' },
      { id: 'user-guide', title: '使用说明', purpose: '给出用户操作步骤' },
      { id: 'technical-features', title: '技术特点与版本信息', purpose: '说明技术特点、版本和维护信息' },
    ],
    skillGuide: '软著材料要像可提交的软件说明书，模块、流程、界面和数据项要一致，避免营销化描述。',
  },
  {
    id: 'business-plan',
    label: '商业计划书辅助写作',
    shortLabel: '商业计划书',
    topicLabel: '项目/产品主题',
    requirementLabel: '计划书要求',
    oneClickTitle: '一键写商业计划书',
    oneClickAction: '开始写计划书',
    documentType: 'business plan',
    retrievalFocus: 'market pain points, solution, business model, competition, go-to-market, financial assumptions',
    outlineInstruction: '规划为商业计划书结构，覆盖执行摘要、市场问题、解决方案、产品服务、商业模式、竞争分析、运营计划、财务预测和融资需求。',
    qualityInstruction: '强调市场假设、客户画像、商业模式、竞争壁垒和财务逻辑的一致性，避免空泛口号。',
    sections: [
      { id: 'executive-summary', title: '执行摘要', purpose: '概括项目、价值主张和关键指标' },
      { id: 'market-problem', title: '市场痛点与机会', purpose: '说明客户、需求和市场规模' },
      { id: 'solution-product', title: '解决方案与产品服务', purpose: '描述产品、服务和差异化价值' },
      { id: 'business-model', title: '商业模式', purpose: '说明收入、成本、渠道和客户获取' },
      { id: 'competition', title: '竞争分析', purpose: '比较竞品和壁垒' },
      { id: 'operation-plan', title: '运营与实施计划', purpose: '说明团队、资源、里程碑和风险' },
      { id: 'financial-plan', title: '财务预测与融资需求', purpose: '说明核心假设、预测和资金用途' },
    ],
    skillGuide: '商业计划书要以客户和商业闭环为中心。所有市场、财务和增长判断应标注假设来源和不确定性。',
  },
  {
    id: 'general-writing',
    label: '其他文稿辅助写作',
    shortLabel: '通用文稿',
    topicLabel: '文稿主题',
    requirementLabel: '写作要求',
    oneClickTitle: '一键写文稿',
    oneClickAction: '开始写文稿',
    documentType: 'general professional document',
    retrievalFocus: 'document purpose, target audience, evidence, structure, tone and acceptance criteria',
    outlineInstruction: '根据用户目标自动规划文稿结构，优先明确受众、用途、核心论点、证据材料和交付格式。',
    qualityInstruction: '强调目标一致、结构清晰、材料可追溯、表达克制、格式符合用户要求。',
    sections: [
      { id: 'context-purpose', title: '背景与目标', purpose: '说明写作背景、受众和目标' },
      { id: 'core-content', title: '核心内容', purpose: '展开主要观点或材料' },
      { id: 'evidence-support', title: '依据与支撑', purpose: '列明事实、数据、材料或案例' },
      { id: 'implementation', title: '执行或应用建议', purpose: '给出行动方案或使用方式' },
      { id: 'summary', title: '总结', purpose: '收束结论和下一步' },
    ],
    skillGuide: '通用文稿要先锁定受众和用途，再选择结构和语气。不要套用论文、基金或商业计划书模板。',
  },
];

const PROFILE_BY_ID = new Map(PROJECT_WRITING_PROFILES.map(profile => [profile.id, profile]));

export function normalizeProjectWritingProfileId(value: unknown): ProjectWritingProfileId {
  const raw = typeof value === 'string' ? value.trim() : '';
  return PROFILE_BY_ID.has(raw as ProjectWritingProfileId)
    ? raw as ProjectWritingProfileId
    : DEFAULT_PROJECT_WRITING_PROFILE_ID;
}

export function getProjectWritingProfile(value: unknown): ProjectWritingProfile {
  return PROFILE_BY_ID.get(normalizeProjectWritingProfileId(value)) || PROJECT_WRITING_PROFILES[0];
}

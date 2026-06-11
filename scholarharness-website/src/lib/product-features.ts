import type { IconName } from "@/components/feature-icon";

export interface ProductFeature {
  slug: string;
  title: string;
  shortTitle: string;
  kicker: string;
  icon: IconName;
  headline: string;
  summary: string;
  homeIntro: string;
  highlights: string[];
  workflow: string[];
  outputs: string[];
  detailSections: Array<{
    title: string;
    body: string;
    points: string[];
  }>;
}

export const productFeatures: ProductFeature[] = [
  {
    slug: "auto-research",
    title: "Auto Research",
    shortTitle: "Auto Research",
    kicker: "自动调研与研究推进",
    icon: "search",
    headline: "把选题调研、资料整理和后续写作入口串成连续任务。",
    summary:
      "Auto Research 面向课题早期调研和持续资料追踪，帮助用户围绕研究问题自动组织检索、阅读、归纳和写作线索。",
    homeIntro:
      "适合从一个研究问题、关键词或课题方向出发，快速形成可继续写综述、写引言、做文献计量或做 Meta 分析的调研底稿。",
    highlights: ["自动拆解调研问题", "沉淀可复用调研结果", "作为一键写论文的数据来源"],
    workflow: ["输入课题方向", "生成调研问题与检索策略", "整理核心观点和证据", "输出可用于写作的研究脉络"],
    outputs: ["调研摘要", "研究问题列表", "关键文献与主题", "可选写作上下文"],
    detailSections: [
      {
        title: "从课题到研究脉络",
        body:
          "系统将宽泛选题拆成更小的研究问题、关键词组合和背景线索，避免用户一开始就陷入无结构的网页搜索或文献堆积。",
        points: ["生成可追踪的调研任务", "区分背景事实、研究争议和潜在创新点", "保留后续写作可调用的上下文"],
      },
      {
        title: "服务后续写作",
        body:
          "Auto Research 的调研结果会作为一键写论文的可选资料源，用户可以在写综述、引言或讨论时选择是否调用这些结果。",
        points: ["支持进入综述写作", "支持补充讨论式写作证据", "支持给文献计量和 Meta 分析提供问题框架"],
      },
    ],
  },
  {
    slug: "review-writing",
    title: "一键辅助写综述",
    shortTitle: "写综述",
    kicker: "综述草稿与章节组织",
    icon: "spark",
    headline: "从主题、文献库和调研结果出发，生成可继续编辑的综述结构。",
    summary:
      "面向系统综述、叙述性综述和文献计量式综述，系统会先组织章节逻辑，再结合证据材料生成草稿。",
    homeIntro:
      "不是简单续写，而是先建立综述问题、章节骨架、证据来源和期刊风格约束，再输出可编辑的综述草稿。",
    highlights: ["章节规划", "证据驱动写作", "可调用 Auto Research 结果"],
    workflow: ["选择综述主题", "选择文献库或调研结果", "确认章节重点", "生成综述草稿并持续修订"],
    outputs: ["综述提纲", "章节草稿", "可引用观点", "参考文献线索"],
    detailSections: [
      {
        title: "先规划再生成",
        body:
          "系统会先确定综述类型、核心问题、章节顺序和每一节的写作重点，再进入草稿生成，减少大段空泛文本。",
        points: ["支持引言、主体、展望等章节", "自动提示证据不足的段落", "保留用户自定义写作重点"],
      },
      {
        title: "与项目资料联动",
        body:
          "写综述时可以选择调用文献管理、文献计量结果、Auto Research 调研结果和用户上传材料。",
        points: ["优先使用项目内资料", "避免编造没有来源的数据", "支持后续讨论式修改"],
      },
    ],
  },
  {
    slug: "discussion-writing",
    title: "讨论式辅助写作",
    shortTitle: "讨论式写作",
    kicker: "边讨论边写论文",
    icon: "message",
    headline: "把论文写作变成可反复追问、修改和补证据的对话流程。",
    summary:
      "用户可以像和研究助理讨论一样推进写作：先问思路，再补证据，再改表达，系统根据当前项目上下文持续响应。",
    homeIntro:
      "适合用户在写作中不断调整论点、段落结构、数据解释、期刊风格和引用证据，而不是一次性生成整篇文章。",
    highlights: ["项目上下文记忆", "证据句调用", "可持续修订草稿"],
    workflow: ["提出写作需求", "调用项目上下文", "生成或修改段落", "继续追问、扩写、压缩或补证据"],
    outputs: ["章节段落", "论点结构", "证据句建议", "修改版草稿"],
    detailSections: [
      {
        title: "像讨论一样写作",
        body:
          "系统会根据用户当前问题判断需要调用哪些项目资料，例如 PDF 句子级论点库、文献计量分析结果或 Meta 分析结果。",
        points: ["支持自然语言追问", "支持按期刊风格修改", "支持逐段打磨而非整篇替换"],
      },
      {
        title: "用户可控的调用方式",
        body:
          "用户可以手动使用 /调用 指令明确调用某类分析结果；没有手动调用时，后端可以根据问题自动识别。",
        points: ["手动调用优先", "自动识别兜底", "降低错误调用原始数据的风险"],
      },
    ],
  },
  {
    slug: "bibliometrics",
    title: "文献计量分析全流程",
    shortTitle: "文献计量",
    kicker: "从导入到写作的文献计量链路",
    icon: "network",
    headline: "覆盖数据导入、网络分析、图表输出和文献计量论文写作。",
    summary:
      "支持围绕 WoS、CNKI 等文献数据开展关键词、作者、机构、主题聚类和趋势分析，并把结果提供给写作系统调用。",
    homeIntro:
      "用户上传文献计量数据后，系统生成结构化分析结果、图件和写作上下文，帮助完成文献计量分析文章。",
    highlights: ["纯文本格式识别", "图表与结果统一调用", "文献计量论文草稿"],
    workflow: ["上传文献计量数据", "解析文献元数据", "生成统计与网络图谱", "调用分析结果写作文献计量文章"],
    outputs: ["完整分析 JSON", "图件索引", "表格索引", "文献计量写作上下文"],
    detailSections: [
      {
        title: "完整分析结果可调用",
        body:
          "主页写作文献计量文章时，系统会调用用户已经分析好的文献计量结果和图片，而不是只调用原始上传文件。",
        points: ["支持 /调用文献计量分析结果", "保留图件和表格索引", "防止编造不存在的网络指标"],
      },
      {
        title: "面向论文写作",
        body:
          "分析结果会被组织成可写入方法、结果和讨论的上下文，用户可以继续让 AI 写摘要、引言、结果解释和图注。",
        points: ["方法参数可追溯", "结果段落可生成", "图表说明可连续编辑"],
      },
    ],
  },
  {
    slug: "meta-analysis",
    title: "Meta 分析全流程",
    shortTitle: "Meta 分析",
    kicker: "提取、编码、建模与作图",
    icon: "database",
    headline: "把 Meta 分析数据提取、编码表、模型配置和 R 作图工程化。",
    summary:
      "系统围绕效应量、因变量、处理组、研究字段、聚类稳健字段和模型设置组织 Meta 分析流程。",
    homeIntro:
      "用户完成数据提取后，可以在 Meta 分析页面配置效应量类型、因变量、模型和调节变量，并运行分析与 R 语言作图。",
    highlights: ["Meta 编码表", "混合效应模型", "森林图、漏斗图和敏感性分析"],
    workflow: ["提取每篇 PDF 的 Meta 数据", "统一单位与字段", "配置效应量和模型", "运行 Meta 分析并生成图件"],
    outputs: ["Meta 编码表", "效应量数据", "模型结果", "R 图件与运行日志"],
    detailSections: [
      {
        title: "工程化数据编码",
        body:
          "Meta 数据库会按 PDF 和 sheet 组织编码表，支持批量选择、删除行列、单位统一和图像数字化复核后的定点补录。",
        points: ["Obs# 与 Study# 自动填充", "新建列同步到所有 PDF", "提取结果不重置原表格"],
      },
      {
        title: "从模型到图件",
        body:
          "运行 Meta 分析时，系统按用户配置输出森林图、漏斗图、敏感性分析、Baujat 图、Egger 检验和调节变量模型。",
        points: ["支持混合效应模型", "支持聚类稳健思路", "日志在向导气泡中展示"],
      },
    ],
  },
  {
    slug: "ai-pdf-management",
    title: "AI 化文献管理",
    shortTitle: "AI 文献管理",
    kicker: "论文 PDF 深度解析与知识库",
    icon: "file",
    headline: "把文献管理从文件列表升级成可分析、可检索、可写作调用的知识库。",
    summary:
      "系统可以解析文献 PDF 正文、图片、表格和句子级论点，并支持深度分析、论文一览图和后续写作调用。",
    homeIntro:
      "适合长期项目中管理大量文献：每篇论文都可以被解析、深度分析、提取论点并沉淀到项目知识库。",
    highlights: ["PDF 深度分析", "论文一览图", "句子级论点库"],
    workflow: ["上传 PDF", "解析文本与图件", "生成深度分析和一览图", "进入句子级检索和写作调用"],
    outputs: ["PDF 摘要", "深度分析", "论文一览图 SVG", "句子级论点"],
    detailSections: [
      {
        title: "可降级的解析链路",
        body:
          "PDF 文本提取支持 Codex、小牛马、本地解析工具和用户可选外部工具的降级链路，尽量保证不同 PDF 都能进入分析流程。",
        points: ["支持 LiteParse / Marker / pdf-marker-md 配置", "缓存已解析文本", "失败时保留可读错误提示"],
      },
      {
        title: "服务写作和 Meta 提取",
        body:
          "文献管理不是孤立页面，深度分析结果、图像复核和提取数据会继续进入讨论式写作、Meta 分析和一键写论文。",
        points: ["支持本地 SVG 一览图", "支持图像数字化复核", "支持 PDF 级证据沉淀"],
      },
    ],
  },
  {
    slug: "data-analysis-r-plot",
    title: "一键数据分析 + R 语言作图",
    shortTitle: "数据分析 + R 作图",
    kicker: "统计分析与论文级图件",
    icon: "chart",
    headline: "上传数据后完成分析配置、统计结果解释和 R 语言出图。",
    summary:
      "系统支持通用数据分析、显著性信息整理、R 代码生成和本地 R 执行，帮助用户形成可放入论文的图表。",
    homeIntro:
      "用户在数据分析页面选择变量、分析方法和额外要求后，可以联动生成 R 作图代码并直接输出高分辨率图件。",
    highlights: ["变量选择", "显著性标注", "R 代码与图件输出"],
    workflow: ["上传数据表", "选择因变量和分析方法", "生成统计结果", "执行 R 代码并输出图件"],
    outputs: ["数据分析结果", "R 脚本", "PDF/PNG 图件", "结果解释"],
    detailSections: [
      {
        title: "从数据到统计结果",
        body:
          "通用数据分析会根据用户选择的变量和方法组织统计流程，避免把作图、统计和文字解释拆成多个互不连通的工具。",
        points: ["支持描述统计、相关、回归和分组比较", "保留用户额外要求", "显著性信息进入作图上下文"],
      },
      {
        title: "本地 R 语言出图",
        body:
          "R 语言作图模块会生成脚本、检测 R 环境和依赖，并把输出图件用于后续论文写作和结果解释。",
        points: ["支持一键安装 R 插件", "支持缺包提示", "支持高分辨率论文图件"],
      },
    ],
  },
];

export function getProductFeature(slug: string): ProductFeature | undefined {
  return productFeatures.find((feature) => feature.slug === slug);
}

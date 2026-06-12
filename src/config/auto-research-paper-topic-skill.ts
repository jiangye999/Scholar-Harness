import {
  REFERENCE_RELEVANCE_RESEARCH_ARTIFACTS,
  REFERENCE_RELEVANCE_WRITING_RULES,
} from './reference-relevance-constraint-skill';

export const AUTO_RESEARCH_PAPER_TOPIC_CONTENT_SKILL = `Paper Topic & Content Research Skill / 论文选题与内容研究前置审查 Skill

Core goal:
Before one-click paper writing, first decide whether the topic can be written, how large the scope should be, what evidence can support, what conclusions must not be written, and what writing blueprint should be handed to the writing system.

Required checks:
1. Paper type judgment: original research, narrative review, scoping review, systematic review, meta-analysis, method paper, technical protocol, policy report, case study, research proposal, or other. Explain recommended and not-recommended types, with missing materials if the user wants another type.
2. Topic size diagnosis: detect whether the topic is too broad, evidence is too narrow, the title promises more than the material supports, or the paper has no real scientific question. Output risk level: low, medium, high, or not recommended.
3. Research boundary lock: population/sample/object/system/scenario, intervention/exposure/method/variable, core indicators/outcomes, mechanism variables, time/space scale, comparison objects, what can be discussed, and what should be excluded or weakened.
4. Scientific question refinement: upgrade vague questions such as "effect of X on Y" or "review progress" into specific questions about conditions, objects, mechanisms, direct evidence, trade-offs, controversy, and unsupported claims.
5. Evidence-chain check: for each major claim, build claim -> evidence -> evidence type -> evidence strength -> writable conclusion -> conclusion to avoid. Separate direct evidence, adjacent evidence, and mechanistic evidence.
6. Innovation check: do not treat a new scenario, more references, generic framework, or "first review" as innovation unless the evidence supports it. Retain only innovation from new question, evidence grading, mechanism integration, scenario-specific framework, indicator system, context classification, controversy synthesis, gap identification, or decision framework.
7. Mechanism-chain check: connect intervention/exposure/method/variable -> intermediate mechanism/pathway/process -> indicator/outcome change -> response -> benefit/risk/performance/quality/trade-off. Mark weak mechanisms as possible explanations, not proven facts.
8. Results-Discussion-Conclusion boundary: Results state what was found; Discussion explains why and compares evidence; Conclusion states what can and cannot be generalized.
9. High-risk detection: topic larger than evidence, conclusion stronger than evidence, background larger than problem, vague mechanism, literature piling, discussion repeating results, conclusion repeating abstract, empty innovation, unclear boundary, mixed population/sample/object/system/scenario evidence, model/simulation/summary/adjacent evidence written as direct application conclusion, adjacent evidence treated as direct evidence, possible mechanism written as proven mechanism, unsupported outcome/effectiveness/performance/risk claims, many citations without answering a scientific question.
10. Writing blueprint: output recommended paper type, 3 titles, core research object, 2-3 core scientific questions, central argument, supported claims, claims to avoid, evidence hierarchy, proposed structure, required figures/tables, writing restrictions, and go/no-go decision.
11. Content thickness and argument enhancement: do not stop at "evidence is limited". Extract positive findings that are actually supported by the available material, and generate concrete structure for Results, Discussion, and Conclusion.
12. Required enhancement artifacts: Evidence Matrix, Core Evidence Dependency Check, Variable-Mechanism-Outcome Matrix, Quantitative Result Summary with NR for missing numbers, Indicator Boundary Check, Innovation Framework, Conceptual Framework figure, Evidence Strength Heatmap, Reference Relevance Matrix, Excluded References, Reference Cleaning Notes, and Final Writing Blueprint.
13. Tables and figures must be concrete. Do not merely say "add a table" or "add a figure"; provide the table rows or figure structure that downstream writing can use. Never invent values, statistics, references, or experiments.

${REFERENCE_RELEVANCE_RESEARCH_ARTIFACTS}

Forbidden:
- Do not directly write the full paper in this skill.
- Do not fabricate data, references, DOI, search process, statistical method, or experimental design.
- Do not package weak evidence as strong conclusions.
- Do not proceed to writing if topic scope, evidence chain, and content boundary are not clear.

Output decision:
可以进入写作 / 修改选题后进入写作 / 需要补充文献后再写 / 需要补充数据后再写 / 暂不建议写作.`;

export const AUTO_RESEARCH_PAPER_TOPIC_CONTENT_SKILL_FOR_WRITING = `Apply the Paper Topic & Content Research Skill before writing:
- Lock paper type, topic scope, research boundary, scientific questions, evidence hierarchy, supported claims, claims to avoid, mechanism chain, and writing warnings.
- If AutoResearch provides a paperWritingBlueprint or paperTopicReview, treat it as hard upstream guidance.
- Do not write conclusions that the blueprint marks as unsupported or avoid.
- If evidence is insufficient, narrow the topic, downgrade language, or mark missing information instead of inventing content.
- If AutoResearch provides contentEnhancementReport, treat it as hard upstream guidance for outline planning, Results structure, Discussion logic, Conclusion logic, required tables, required figures, claims allowed, and claims to avoid.
- Results should include evidence synthesis, positive findings, Evidence Matrix, Variable-Mechanism-Outcome Matrix, Quantitative Result Summary when values exist, and Indicator Boundary Check.
- Discussion should explain the innovation framework, mechanism pathways, evidence strength heatmap, trade-offs, and conditions under which findings hold.
- Conclusion should contain a positive finding, conditional interpretation, framework contribution, and future validation direction, not only limitations.
- Keep Results, Discussion, and Conclusion boundaries clear.

${REFERENCE_RELEVANCE_WRITING_RULES}`;

# SCI Discussion Writing Skill

## Purpose
Help an AI write a Discussion section that **interprets results, connects them to prior literature, acknowledges limitations, and explains why the study matters**.

## When to Use
Use this skill for the Discussion of an SCI original research paper.

## Inputs Required
Provide:
- main findings
- hypotheses / predictions from the Introduction
- supporting and conflicting literature
- surprising findings
- limitations
- practical or theoretical implications
- future directions

## Output Goal
Produce a Discussion that begins with the study’s main findings and expands outward to significance, literature integration, caveats, and future work.

## Core Logic
The Discussion should move from **small to big**, reversing the narrowing pattern of the Introduction.

## Narrative Arc
The AI should usually include:
1. brief summary of overall findings
2. interpretation of the main findings
3. connection to hypotheses / predictions
4. agreement or conflict with prior studies
5. alternative explanations or unexpected findings
6. limitations / caveats
7. broader implications
8. future directions
9. a concluding close

## Writing Rules
1. Do not repeat the Results section line by line.
2. Interpret findings rather than merely restating them.
3. Explicitly reconnect findings to the Introduction’s hypotheses or predictions.
4. Compare the findings with previous studies.
5. Address contradictions and surprising outcomes honestly.
6. Acknowledge limitations to increase credibility.
7. Broaden to practical, theoretical, or field-level implications.
8. Keep speculation bounded by logic and evidence.
9. End with a concise conclusion or transition to a formal Conclusion section.

## Auto Research and One-Click Paper Integration
When Auto Research, one-click paper writing, PDF Wiki evidence, or an evidence/argument enhancement report is available, treat it as upstream writing control rather than optional background.

Use these upstream materials as hard constraints:
- paperTopicReview: paper type, topic risk level, evidence readiness, research boundary, mismatch points, high-risk issues
- paperWritingBlueprint: central argument, core scientific questions, supported claims, claims to avoid, evidence hierarchy, required figures/tables, writing warnings
- contentEnhancementReport: Evidence Matrix, Core Evidence Dependency Check, Variable-Mechanism-Outcome Matrix, Quantitative Result Summary, Indicator Boundary Check, Innovation Framework, Conceptual Framework figure, Evidence Strength Heatmap, Reference Cleaning Notes, Final Writing Blueprint
- citation/claim audit: whether each claim is supported directly, indirectly, weakly, or not supported
- PDF Wiki sentence-level evidence: exact sentence evidence and sentence evidence code
- embedding literature evidence: normal literature records with author-year citation metadata

### Discussion-Specific Use of Enhancement Artifacts
The Discussion must not only say "evidence is limited". It should extract the strongest positive findings that are actually supported, then explain their boundary and mechanism.

Use the enhancement artifacts as follows:
1. Evidence Matrix: decide which findings can be discussed as direct evidence, adjacent evidence, mechanistic evidence, or background-only evidence.
2. Core Evidence Dependency Check: make sure the central discussion claims depend on enough evidence; downgrade or remove unsupported claims.
3. Variable-Mechanism-Outcome Matrix: build the explanatory chain from management/intervention/exposure to mechanism variable, response indicator, and outcome.
4. Quantitative Result Summary: mention numeric direction, range, or NR status only when provided; never invent values.
5. Indicator Boundary Check: keep indicator meaning precise and avoid turning proxy indicators into broad conclusions.
6. Innovation Framework: state what the study contributes through question refinement, evidence grading, mechanism integration, regional/system boundary, indicator framework, scenario classification, controversy synthesis, gap identification, or decision framework.
7. Evidence Strength Heatmap: separate robust findings, conditional findings, weak signals, and unsupported claims.

### Preferred Discussion Logic
Use this paragraph logic when enough material is available:
1. Main answer: state the central interpretation and the boundary under which it holds.
2. Strongest finding: explain the best-supported positive finding and its evidence strength.
3. Mechanism: connect variable/mechanism/outcome rather than listing results.
4. Literature comparison: explain agreement, conflict, and likely reasons for divergence.
5. Innovation and contribution: show what the paper adds beyond more references or a new region.
6. Conditions and trade-offs: identify where the finding holds, where it may fail, and what trade-offs remain.
7. Limitations and future validation: say what cannot be generalized and what data or experiments are needed.

### Claim and Citation Rules
1. Do not write any claim listed in claimsToAvoid unless it is explicitly framed as unsupported, excluded, or needing future validation.
2. If a claim is only possible or mechanistic, write it as a possible explanation, not a proven causal conclusion.
3. If evidence is adjacent rather than direct, mark the boundary and avoid overgeneralization.
4. PDF Wiki sentence-level evidence must remain traceable to the sentence code when available. Use the traceable marker: 来源Wiki论点库: 句子证XXXXXXX（需核查）.
5. Embedding literature evidence should use normal in-text citation style, such as (Zhang et al., 2026), and should not be labeled as Wiki sentence evidence.
6. Do not output the vague marker "需核查引用是否直接支持". If support is uncertain, identify the specific source type and evidence code or citation needing review.

### Reference Relevance Constraint
Before using any reference in the Discussion, classify it internally as one of:
- Direct evidence: object/system, variable/intervention, method, and result match the Discussion claim.
- System-specific evidence: relevant only for a named subsystem, subgroup, region, method, or condition.
- Adjacent evidence: partially related and usable only for comparison, hypothesis, or bounded explanation.
- Mechanistic evidence: supports a pathway or process, but cannot alone prove the main conclusion.
- Background evidence: supports context or definitions only.
- Excluded evidence: unrelated, non-academic, unverifiable, missing author/year/source, garbled, tool-trace, or cross-domain evidence that cannot support this paper.

Use rules:
1. Direct and system-specific evidence may support Discussion claims, but system-specific evidence must state its boundary.
2. Adjacent and mechanistic evidence must be written with cautious language and cannot be presented as direct proof.
3. Background evidence must not support core findings or mechanisms.
4. Excluded evidence must not appear in正文 citations.
5. If author/year/source/DOI or source support is missing, write NR or 需要作者补充 instead of inventing metadata.
6. When an Auto Research Reference Relevance Matrix is available, obey its evidence type, evidence strength, use boundary, and exclusion notes.

## AI Workflow
### Step 1: Open with the answer
State the study’s main takeaway in a compact way.

### Step 2: Interpret the major findings
Explain what the observed patterns mean.

### Step 3: Reconnect to predictions
Show whether the findings supported, refined, or contradicted the original expectations.

### Step 4: Compare with literature
Discuss alignment, divergence, and possible reasons.

### Step 5: Handle complexity
Address surprising findings and alternative explanations.

### Step 6: Critique the study
Present limitations and caveats clearly but proportionately.

### Step 7: Broaden outward
Show how the work contributes to the field or practice.

### Step 8: Close strongly
End with future directions and a concise summative statement.

## Recommended Output Format
### Paragraph 1
Overall finding and main interpretation

### Paragraphs 2-4
Finding-by-finding interpretation with literature integration

### Penultimate Paragraph
Limitations and caveats

### Final Paragraph
Broader implications, future directions, concluding statement

## Quality Checklist
The AI must check:
- Does the section interpret rather than repeat?
- Are findings tied back to hypotheses?
- Are prior studies meaningfully integrated?
- Are limitations acknowledged?
- Is speculation controlled?
- Does the ending explain the study’s contribution?
- Are supported positive findings extracted instead of writing only limitations?
- Are claimsToAvoid removed, downgraded, or explicitly marked as unsupported?
- Are direct evidence, adjacent evidence, mechanistic evidence, and background evidence kept separate?
- Are mechanism pathways written as variable-mechanism-outcome chains?
- Are evidence strength, NR values, indicator boundaries, conditions, and trade-offs handled explicitly?
- Are PDF Wiki sentence codes and embedding literature citations kept in their correct formats?
- Is the Discussion different from Results and Conclusion in function?

## Do Not
- rewrite the Results section
- ignore contradictory findings
- hide limitations
- speculate beyond the data
- end without stating the contribution
- turn weak evidence into strong conclusions
- use "first study", "significant innovation", or broad causal claims without direct support
- cite PDF Wiki sentence evidence without a sentence evidence code when one is available
- label embedding literature evidence as Wiki sentence evidence

## Prompt Template
```text
You are writing the Discussion section of an SCI paper.

Task:
Write a Discussion that interprets the study findings, compares them with prior work, addresses limitations, and explains why the study matters.

Study information:
- Main findings:
- Hypotheses/predictions:
- Supporting prior studies:
- Conflicting prior studies:
- Surprising findings:
- Limitations:
- Practical/theoretical implications:
- Future directions:
- Journal / field tone if known:
- AutoResearch paperTopicReview if available:
- AutoResearch paperWritingBlueprint if available:
- AutoResearch contentEnhancementReport if available:
- Evidence Matrix / Variable-Mechanism-Outcome Matrix if available:
- Claims to avoid:
- Reference Relevance Matrix / Excluded References if available:
- PDF Wiki sentence evidence codes if available:
- Embedding literature evidence if available:

Requirements:
- interpret, do not merely repeat
- connect back to hypotheses
- integrate prior studies
- acknowledge limitations
- keep speculation evidence-based
- end with a strong conclusion
- follow the AutoResearch boundary, evidence hierarchy, supported claims, and claims-to-avoid
- explain mechanism pathways, evidence strength, conditions, trade-offs, and innovation framework
- keep Wiki sentence evidence traceable by sentence code and cite embedding literature normally
```

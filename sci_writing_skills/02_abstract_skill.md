# SCI Abstract Writing Skill

## Purpose
Help an AI write an SCI abstract that **summarizes the study’s problem, method, main results, and significance without drifting beyond the manuscript**.

## When to Use
Use this skill when drafting:
- an informative abstract
- a structured abstract
- a revised abstract after the paper is completed

## Inputs Required
Provide:
- study background
- research objective or hypothesis
- methods overview
- primary results
- main conclusion
- word limit
- abstract type (structured or unstructured)

## Output Goal
Produce a publication-ready abstract that is brief, complete, and consistent with the full manuscript.

## Abstract Logic
A strong SCI abstract should cover:
1. **Why the study matters**
2. **What was done**
3. **What was found**
4. **Why the result matters**

For original research, the default mode should be **informative** or **structured**.

## Writing Rules
1. State the purpose early; avoid long lead-ins.
2. Include the primary objective or hypothesis.
3. Summarize the method at a high but concrete level.
4. Report only the most important results.
5. Support conclusions with actual findings from the manuscript.
6. Do not include citations.
7. Do not introduce novel abbreviations.
8. Stay within the journal word limit.
9. Ensure there is no disconnect between the abstract and the full paper.

## AI Workflow
### Step 1: Distill the paper into four blocks
- Background / gap
- Methods
- Results
- Conclusion / significance

### Step 2: Keep only essential findings
Retain only the most decision-relevant results.

### Step 3: Match the journal format
- **Unstructured**: one coherent paragraph
- **Structured**: subheadings such as Background / Methods / Results / Conclusion

### Step 4: Tighten language
Remove:
- generic context
- repeated phrases
- unsupported interpretation
- details better left to the main text

## Recommended Output Format
### Version A: Structured Abstract
- Background:
- Methods:
- Results:
- Conclusion:

### Version B: Unstructured Abstract
One polished paragraph within the specified word limit.

## Quality Checklist
The AI must check:
- Is the objective explicit?
- Are the main methods visible?
- Are the most important results stated clearly?
- Does the conclusion reflect only what the data support?
- Are citations and new abbreviations absent?
- Is the abstract consistent with the paper?

## Do Not
- hide the contribution behind long background
- list every result
- make claims not supported by the data
- copy sentences mechanically from every section
- use references or unexplained abbreviations

## Prompt Template
```text
You are writing an SCI abstract.

Task:
Write both a structured and an unstructured abstract for the study below.

Study information:
- Background/gap:
- Objective or hypothesis:
- Methods:
- Primary results:
- Main conclusion:
- Word limit:
- Target journal / field:

Requirements:
- concise and informative
- no citations
- no novel abbreviations
- state the objective early
- include only results that support the conclusion
- remain fully consistent with the manuscript
```

# SCI Results Writing Skill

## Purpose
Help an AI write a Results section that **reports findings neutrally, logically, and transparently without slipping into interpretation**.

## When to Use
Use this skill when converting statistical output, model output, tables, figures, or experiment observations into SCI-style Results text.

## Inputs Required
Provide:
- study objectives or result subsections
- key findings
- supporting numerical/statistical outputs
- figure/table mapping
- any negative or non-significant results
- any deviations from the planned method affecting the results

## Output Goal
Produce a Results section that shows **what was found**, in a sequence that supports the paper’s logic.

## Core Structure
The AI should organize the Results section:
- from broad to specific, or
- from simple to complex, or
- by objective / experiment / trial / dataset

Use the same subheading logic introduced earlier in the paper where possible.

## Writing Rules
1. Present results neutrally.
2. Include all results needed to support the study conclusions.
3. Do not report only significant findings.
4. Include non-significant or "negative" findings when they matter.
5. Mention methodological deviations only when they affect interpretation of the results.
6. Do not duplicate every number already shown in tables/figures.
7. Refer readers to figures/tables for detailed values.
8. Report appropriate statistical information:
   - sample size or degrees of freedom
   - test statistic
   - p-value
   - effect size
   - uncertainty measure such as SD, SE, or 95% CI
9. Keep interpretation minimal; save meaning-making for Discussion.

## AI Workflow
### Step 1: Decide the reporting order
Choose one logic:
- objective by objective
- experiment by experiment
- dataset by dataset
- simple analyses before complex analyses

### Step 2: Draft the claim sentence for each result block
State the main observed pattern first.

### Step 3: Add support
Add only the necessary statistical or numerical evidence.

### Step 4: Link visuals
Reference the relevant figure or table rather than repeating all values.

### Step 5: Include completeness signals
Add:
- non-significant findings
- validation of novel methods if applicable
- results excluding alternative explanations where relevant

## Recommended Output Format
### Result Subsection A
Main pattern sentence + selective numerical/statistical support + figure/table citation

### Result Subsection B
...

## Quality Checklist
The AI must check:
- Is the reporting order logical?
- Are non-significant findings handled honestly?
- Are detailed numbers mostly housed in tables/figures?
- Is statistical reporting complete enough?
- Is interpretation restrained?
- Are subsection names consistent with the rest of the paper?

## Do Not
- explain why the results happened
- hide null results
- repeat the full content of tables in prose
- oversell weak patterns
- omit effect sizes or uncertainty when they matter

## Prompt Template
```text
You are writing the Results section of an SCI paper.

Task:
Turn the findings below into a neutral, logically ordered Results section.

Study information:
- Objectives / subsection structure:
- Main findings:
- Non-significant findings:
- Statistical outputs:
- Figure/table mapping:
- Deviations affecting results:
- Field / journal conventions:

Requirements:
- neutral reporting
- no interpretation beyond direct description
- include meaningful non-significant results
- use figure/table references efficiently
- include sample size, test statistics, p-values, and effect sizes when relevant
```

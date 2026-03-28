# SCI Methods Writing Skill

## Purpose
Help an AI write a Methods section that is **clear, reproducible, technically complete, and journal-compliant**.

## When to Use
Use this skill for:
- drafting a Methods section from lab notes or protocols
- reorganizing methods for clarity
- checking whether key reproducibility details are missing

## Inputs Required
Provide:
- study design
- data types
- variables and definitions
- subjects / samples / species
- setting / site / timeline
- materials / equipment / software
- experimental or sampling procedures
- outcome measurements
- data analysis plan
- ethics / approvals / permits

## Output Goal
Produce a Methods section that allows a knowledgeable reader to understand **what was done, with what, in what order, under what approvals, and how the data were analyzed**.

## Core Structure
Typical subheadings may include:
- Study design / overview
- Subjects or samples
- Materials / instruments
- Procedures / protocol
- Outcomes / measurements
- Data analysis
- Ethical approval

## Writing Rules
1. Explain how the methodology answers the research question.
2. Order subheadings chronologically or by procedure type.
3. Define variables and keep terminology/units consistent.
4. Include enough detail for reproducibility.
5. Include critical material details, quantities, concentrations, software, and manufacturer information when relevant.
6. Use citations instead of re-describing standard widely used methods in full.
7. If methods were adapted, explain the adaptation and why it was necessary.
8. Give the data analysis its own explicit subheading where appropriate.
9. Include alpha / significance / confidence interval levels.
10. Report test selection, assumptions, software, controls, transformations, and post-hoc analyses when applicable.
11. Include ethics approvals, permit numbers, and consent requirements when relevant.

## AI Workflow
### Step 1: Build the method skeleton
List the logical subheadings.

### Step 2: Fill operational details
For each subheading, specify:
- what
- who/what was studied
- how
- with what
- under what conditions

### Step 3: Write Data Analysis separately
Explain:
- variables collected
- preprocessing or transformations
- statistical or qualitative analyses
- rationale for test choice
- assumption checks
- software
- control of influencing factors
- post-hoc procedures

### Step 4: Add compliance information
Insert ethics, approvals, and permits.

### Step 5: Remove ambiguity
Check whether another researcher could replicate the workflow.

## Recommended Output Format
### Study Design
...

### Samples / Subjects
...

### Procedures
...

### Outcomes and Measurements
...

### Data Analysis
...

### Ethical Approval
...

## Quality Checklist
The AI must check:
- Is the order logical?
- Are all critical materials and procedures described?
- Are variables and units consistent?
- Is Data Analysis explicit and justified?
- Are ethics and approvals included if needed?
- Could an informed reader reproduce the work?

## Do Not
- mix Results into Methods
- omit key experimental conditions
- leave analysis choices unexplained
- use inconsistent variable names
- hide crucial details in vague wording
- forget ethics / approvals when required

## Prompt Template
```text
You are writing the Methods section of an SCI paper.

Task:
Write a clear, reproducible, publication-ready Methods section using the information below.

Study information:
- Research question:
- Study design:
- Data types:
- Variables:
- Subjects/samples:
- Site/time frame:
- Materials/equipment/software:
- Procedures:
- Outcome measurements:
- Data analysis:
- Ethics approvals / permits:
- Journal conventions if known:

Requirements:
- structured with subheadings
- reproducible and concise
- consistent terminology and units
- explicit Data Analysis subsection
- include ethics/permits where relevant
```

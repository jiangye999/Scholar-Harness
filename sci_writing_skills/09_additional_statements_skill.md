# SCI Additional Statements and Disclosures Skill

## Purpose
Help an AI draft the non-body sections commonly required by SCI journals, including **ethics, conflict of interest, funding, author contributions, corresponding author, ORCID, data availability, and single-submission statements**.

## When to Use
Use this skill near submission, or when preparing journal-compliant back matter.

## Inputs Required
Provide:
- whether human or animal subjects were involved
- ethics committee name and approval number
- informed consent details if applicable
- conflicts of interest
- funding sources
- author roles
- corresponding author information
- ORCID information
- data/code availability location
- repository DOI / URL if applicable
- statement that the manuscript is not under simultaneous review elsewhere

## Output Goal
Produce a set of short, formal, journal-ready disclosure statements.

## Common Statement Types
1. Ethical approval
2. Informed consent
3. Conflict of interest
4. Funding
5. Author contributions
6. Corresponding author identification
7. ORCID listing
8. Data availability / code availability
9. Single submission affirmation
10. Accessibility or funder-mandated open access statements if required

## Writing Rules
1. Use only verifiable facts supplied by the user.
2. Keep each statement short and formal.
3. Name the approving IRB/IACUC body and protocol number where applicable.
4. Disclose any relationship that could bias interpretation.
5. Clarify whether funders influenced study design, conduct, or reporting if relevant.
6. Describe author contributions by task.
7. State where the data/code can be accessed.
8. Match journal-specific wording when provided.

## AI Workflow
### Step 1: Identify which statements are required
Not every paper needs every statement in the same format.

### Step 2: Draft each item separately
Create a clean, labeled block for each disclosure.

### Step 3: Check compliance risk
Look for:
- missing protocol numbers
- missing conflict disclosures
- vague data availability language
- incomplete author contribution details

### Step 4: Convert to journal style
If the target journal provides templates, align wording with them.

## Recommended Output Format
### Ethical Approval
...

### Consent to Participate
...

### Conflict of Interest
...

### Funding
...

### Author Contributions
...

### Data Availability
...

### Corresponding Author
...

## Quality Checklist
The AI must check:
- Are the statements fact-based and specific?
- Are protocol numbers included where needed?
- Are COIs clearly disclosed or explicitly absent?
- Is data availability actionable?
- Are author roles clear?
- Does the output match likely journal expectations?

## Do Not
- invent compliance information
- soften or hide real conflicts
- give vague data availability without location details
- merge all disclosures into one confusing paragraph
- use placeholders in the final version unless explicitly requested

## Prompt Template
```text
You are drafting SCI journal disclosures and additional statements.

Task:
Write journal-ready statements for the categories below using only the supplied facts.

Submission facts:
- Human/animal subjects:
- Ethics committee and approval number:
- Informed consent:
- Conflicts of interest:
- Funding sources:
- Author roles:
- Corresponding author:
- ORCIDs:
- Data/code availability:
- Repository DOI/link:
- Single-submission confirmation:
- Target journal wording if known:

Requirements:
- factual and concise
- formal journal style
- no invented information
- output in clearly labeled sections
```

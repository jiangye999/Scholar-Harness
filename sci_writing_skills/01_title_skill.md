# SCI Title Writing Skill

## Purpose
Help an AI write a **precise, searchable, and journal-appropriate SCI paper title**.
This skill is based on guidance that titles in scientific manuscripts should be succinct, accurate, informative, aligned with the manuscript content, avoid jargon/abbreviations, and usually foreground the research topic plus one or two of the most important elements (population, method, outcome, or relationship).

## When to Use
Use this skill when you need to:
- draft a first title
- optimize a title for submission
- shorten a title to fit journal limits
- generate multiple title candidates with different styles

## Inputs Required
Provide the AI with:
- research topic
- study object / population / sample
- method or design
- core result or relationship
- target journal style if known
- title length limit if known

## Output Goal
Generate **3-5 candidate titles** and recommend the strongest one.

## Title Strategy
The AI should consider three common title modes:
1. **Descriptive / informative**: best default for most SCI papers
2. **Declarative**: acceptable when the main result is robust and journals allow it
3. **Interrogative**: usually less preferred for original research and more common in commentary/review contexts

## Writing Rules
1. Keep the title tightly aligned with manuscript scope.
2. Avoid overclaiming.
3. Avoid unnecessary phrases such as "a study of".
4. Avoid unexplained abbreviations and field-specific jargon where possible.
5. Include the general topic and one or two important manuscript elements:
   - population / species / sample
   - method / model / intervention
   - main outcome / association / relationship
6. Prefer clarity over cleverness.
7. Ensure the title is searchable in databases.

## AI Workflow
### Step 1: Extract title ingredients
The AI should identify:
- what was studied
- in whom / what / where
- how it was studied
- what was found or what relationship was tested

### Step 2: Draft a long factual title
Start with a full descriptive sentence containing all major elements.

### Step 3: Compress
Remove:
- filler phrases
- repeated concepts
- redundant methodological detail
- ornamental wording

### Step 4: Generate variants
Produce:
- one conservative descriptive title
- one slightly more result-oriented title
- one shorter journal-style title
- optional running title if requested

## Recommended Output Format
### Candidate Titles
1. ...
2. ...
3. ...

### Best Choice
- Selected title: ...
- Why it works: accuracy, scope fit, searchability, clarity

### Running Title (optional)
- ...

## Quality Checklist
The AI must check:
- Does the title match the manuscript exactly?
- Does it avoid unsupported conclusions?
- Does it include the key study element(s)?
- Is it free of vague filler?
- Can a target reader understand it quickly?

## Do Not
- exaggerate the finding
- introduce claims absent from the paper
- overstuff the title with too many variables
- use unexplained abbreviations
- make the title broader than the actual study

## Prompt Template
```text
You are writing the title of an SCI paper.

Task:
Generate 5 title candidates for the study below, then select the best one.

Study information:
- Topic:
- Population/sample:
- Method/design:
- Core finding or tested relationship:
- Field:
- Journal style or title limit:

Requirements:
- concise, accurate, informative
- no unnecessary jargon or unexplained abbreviations
- no overclaiming
- align strictly with manuscript content
- provide 1 best recommendation with rationale
```

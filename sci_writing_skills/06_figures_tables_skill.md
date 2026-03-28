# SCI Figures and Tables Skill

## Purpose
Help an AI design, describe, and quality-check figures and tables so they function as **stand-alone, readable, publication-ready evidence units**.

## When to Use
Use this skill when:
- deciding whether a result needs a figure or a table
- drafting figure legends
- drafting table titles/footnotes
- checking journal compliance for data displays

## Inputs Required
Provide:
- result to be visualized
- preferred format (figure or table)
- variables shown
- statistical summary
- data collection timing if relevant
- how data were collected
- journal specifications if known

## Output Goal
Produce a figure/table plan plus legend or title text that lets a reader understand the display **without needing to read the main narrative first**.

## Core Principles
A figure or table should be a stand-alone unit and should clearly show:
- title
- legend / footnote
- data labels or representation method
- what the reader should notice
- dates of collection where relevant
- how the data were obtained
- any other information needed for independent understanding

## Choosing Figure vs Table
### Use a figure when
- you want to emphasize patterns, trends, workflows, comparisons, or spatial structure
- a graph, image, map, or flowchart will communicate faster than text

### Use a table when
- exact values matter
- summary statistics, model outputs, or factor comparisons need precise display

## Writing Rules
1. Number figures and tables in order of first citation.
2. Match font type and readability to the manuscript.
3. Keep visuals simple and not visually busy.
4. Remove nonessential gridlines, clutter, and distracting marks.
5. Avoid red-green combinations that reduce accessibility.
6. Use legends that are clear, succinct, and informative.
7. Reserve figures for the most important, interesting, or unexpected findings.
8. Use as few border and grid lines as possible in tables.
9. For numeric tables, provide both absolute values and useful derivatives such as percentages when appropriate.
10. Follow journal requirements for file type, resolution, size, and placement.

## AI Workflow
### Step 1: Decide display type
Choose figure or table based on the communication goal.

### Step 2: Define the message
Write one sentence: "The reader should notice that..."

### Step 3: Build the metadata
Prepare:
- title
- legend or footnote
- labels / symbols / abbreviations
- methods note if needed
- statistical annotation logic

### Step 4: Check accessibility
Ensure:
- readable fonts
- clean layout
- non-confusing colors
- consistent naming

### Step 5: Check submission readiness
Verify:
- numbering
- size and resolution requirements
- whether files must be separate or embedded

## Recommended Output Format
### Display Choice
- Figure or Table:
- Why this format is best:

### Draft Title
...

### Draft Legend / Footnote
...

### Reader Should Notice
...

### Compliance Check
- numbering
- readability
- journal formatting
- accessibility

## Quality Checklist
The AI must check:
- Can the display stand alone?
- Is the display type appropriate?
- Is the legend concise but sufficient?
- Is clutter minimized?
- Are accessibility issues addressed?
- Does the display highlight the right result?

## Do Not
- make a figure for every result
- overload the legend with prose
- duplicate the same message in multiple display types
- use inaccessible color coding
- ignore journal formatting rules

## Prompt Template
```text
You are preparing figures/tables for an SCI paper.

Task:
Decide whether each result should be shown as a figure or table, then draft the title and legend/footnote.

Result information:
- Finding to present:
- Variables:
- Exact values needed? yes/no
- Pattern/trend emphasis needed? yes/no
- Statistical summary:
- Data collection timing:
- How data were collected:
- Journal figure/table requirements if known:

Requirements:
- stand-alone display
- concise, informative legend/title
- publication-ready and accessible
- avoid visual clutter
```

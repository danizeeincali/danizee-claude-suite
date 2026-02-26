/**
 * PM Workflow Shortcuts Plugin for Danizee Claude Suite
 * Provides `/w-` prefixed slash commands for product management workflows
 */

import fs from 'fs/promises';
import path from 'path';

/**
 * Get all PM workflow commands
 */
export function getCommands() {
  return {
    // =========================================================================
    // ACTION ITEMS
    // =========================================================================

    'w-action': {
      name: 'w-action',
      description: 'Add action item with Fibonacci auto-cascade priority enforcement',
      content: `# /w-action

Add action item with Fibonacci auto-cascade priority enforcement.

Fibonacci limits per priority: P1=1, P2=2, P3=3, P5=5, P8=8, P13=13. When a priority bucket overflows, the lowest-value item auto-cascades to the next bucket.

## Usage
\`\`\`
/w-action [description]
/w-action "Ship onboarding v2" --priority p1 --due friday
\`\`\`

---

## \u26a0\ufe0f MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Load current action items from storage
2. Parse new action item details (description, priority, due date, tags)
3. Enforce Fibonacci bucket limits - auto-cascade if overflow
4. Save action item
5. Confirm with updated priority dashboard

\u26a0\ufe0f VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- NEVER skip Fibonacci enforcement - limits are hard
- NEVER allow more than 1 P1 item without explicit user override
- ALWAYS show cascade effects before saving
- Auto-extract due dates from natural language ("friday", "next week", "end of sprint")

---

## Execution Protocol

### \u26d4 CHECKPOINT 1: Parse Input
**REQUIRED OUTPUT:**
- Description: _____
- Suggested priority: P___
- Due date: _____ (extracted or none)
- Tags: _____

**AUTO-PROCEED:** Continue to Fibonacci check.

---

### \u26d4 CHECKPOINT 2: Fibonacci Enforcement
**REQUIRED OUTPUT:**
- Current bucket counts:
| Priority | Limit | Current | After Add |
|----------|-------|---------|-----------|
| P1 | 1 | _____ | _____ |
| P2 | 2 | _____ | _____ |
| P3 | 3 | _____ | _____ |
| P5 | 5 | _____ | _____ |
| P8 | 8 | _____ | _____ |
| P13 | 13 | _____ | _____ |

- Overflow detected: yes/no
- Cascade plan: _____ (if overflow)

**USER GATE:** Use AskUserQuestion
- Question: "Add '[description]' as P[X] due [date]. [Cascade: item Y moves P2->P3]. Confirm?"
- Options: ["Confirm", "Change priority", "Edit details"]

STOP and wait for user response.

---

### \u26d4 CHECKPOINT 3: Save & Confirm
**REQUIRED OUTPUT:**
- Action item saved: ID ___
- Priority: P___
- Due: _____
- Cascades applied: _____
- Updated hit list (top 3)

**AUTO-PROCEED:** Workflow complete.

---

## Completion Checklist

- [ ] TodoWrite used at start
- [ ] Action item parsed
- [ ] Fibonacci limits checked and enforced
- [ ] Cascades applied (if any)
- [ ] Item saved to storage
- [ ] Updated dashboard shown

\u26a0\ufe0f Workflow INCOMPLETE until all boxes checked

## Example
\`\`\`
/w-action "Finalize pricing page copy" --priority p2 --due friday
\`\`\`
`
    },

    'w-action-done': {
      name: 'w-action-done',
      description: 'Multi-select completion with auto-promotion',
      content: `# /w-action-done

Multi-select action item completion with auto-promotion from lower priority buckets.

## Usage
\`\`\`
/w-action-done
/w-action-done 3,7,12
\`\`\`

---

## \u26a0\ufe0f MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Load current action items
2. Present items for selection (or use provided IDs)
3. Mark selected items complete
4. Auto-promote items from lower buckets to fill gaps
5. Show updated dashboard

\u26a0\ufe0f VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- NEVER delete items - mark as complete with timestamp
- ALWAYS check for auto-promotion opportunities after completion
- ALWAYS show before/after dashboard

---

## Execution Protocol

### \u26d4 CHECKPOINT 1: Select Items
**REQUIRED OUTPUT:**
- Active action items list with IDs, priorities, descriptions
- Items selected for completion: _____

**USER GATE:** Use AskUserQuestion
- Question: "Complete items [IDs]? [Show items list]"
- Options: ["Confirm", "Change selection", "Show all items"]

STOP and wait for user response.

---

### \u26d4 CHECKPOINT 2: Complete & Promote
**REQUIRED OUTPUT:**
- Items completed: _____
- Auto-promotions applied:
| Item | From | To | Reason |
|------|------|----|--------|
| _____ | P___ | P___ | Gap in P___ bucket |

- Updated dashboard:
| Priority | Count/Limit | Items |
|----------|-------------|-------|
| P1 | ___/1 | _____ |
| P2 | ___/2 | _____ |
| P3 | ___/3 | _____ |

**AUTO-PROCEED:** Workflow complete.

---

## Completion Checklist

- [ ] TodoWrite used at start
- [ ] Items selected for completion
- [ ] Items marked complete with timestamps
- [ ] Auto-promotion evaluated and applied
- [ ] Updated dashboard shown

\u26a0\ufe0f Workflow INCOMPLETE until all boxes checked

## Example
\`\`\`
/w-action-done 3,7
\`\`\`
`
    },

    'w-action-list': {
      name: 'w-action-list',
      description: 'List action items by priority with Fibonacci limit indicators',
      content: `# /w-action-list

List all action items organized by priority with Fibonacci limit indicators.

## Usage
\`\`\`
/w-action-list
/w-action-list --priority p1,p2
/w-action-list --overdue
/w-action-list --tag design
\`\`\`

---

## \u26a0\ufe0f MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Load all action items from storage
2. Apply filters (priority, overdue, tag)
3. Render priority dashboard with Fibonacci indicators
4. Highlight overdue and at-risk items

\u26a0\ufe0f VIOLATION: Any action before TodoWrite = restart workflow

---

## Execution Protocol

### \u26d4 CHECKPOINT 1: Load & Filter
**REQUIRED OUTPUT:**
- Total items: _____ (active) / _____ (completed)
- Filters applied: _____

**AUTO-PROCEED:** Continue to render.

---

### \u26d4 CHECKPOINT 2: Render Dashboard
**REQUIRED OUTPUT:**

**Priority Dashboard:**
| Priority | Usage | Items |
|----------|-------|-------|
| \ud83d\udd34 P1 | [N/1] | _____ |
| \ud83d\udfe0 P2 | [N/2] | _____ |
| \ud83d\udfe1 P3 | [N/3] | _____ |
| \ud83d\udfe2 P5 | [N/5] | _____ |
| \ud83d\udd35 P8 | [N/8] | _____ |
| \u26aa P13 | [N/13] | _____ |

**Overdue Items:** (if any)
| ID | Description | Due | Priority | Days Overdue |
|----|-------------|-----|----------|-------------|

**At Risk:** (due within 2 days)
| ID | Description | Due | Priority |
|----|-------------|-----|----------|

**AUTO-PROCEED:** Workflow complete.

---

## Completion Checklist

- [ ] TodoWrite used at start
- [ ] All items loaded
- [ ] Filters applied correctly
- [ ] Dashboard rendered with Fibonacci indicators
- [ ] Overdue and at-risk items highlighted

\u26a0\ufe0f Workflow INCOMPLETE until all boxes checked

## Example
\`\`\`
/w-action-list --overdue
\`\`\`
`
    },

    'w-action-rebalance': {
      name: 'w-action-rebalance',
      description: 'Batch priority moves using CLI syntax (1,2,rest->p3)',
      content: `# /w-action-rebalance

Batch-move action item priorities using concise CLI syntax. Supports moving specific items, ranges, or "rest" keyword.

## Usage
\`\`\`
/w-action-rebalance 1,2->p2
/w-action-rebalance rest->p5
/w-action-rebalance 4,7,9->p3 rest->p8
\`\`\`

---

## \u26a0\ufe0f MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Load current action items and priorities
2. Parse rebalance expression(s)
3. Simulate moves and check Fibonacci limits
4. Preview before/after state
5. Apply rebalance

\u26a0\ufe0f VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- NEVER apply moves that violate Fibonacci limits without explicit override
- ALWAYS show before/after comparison before applying
- "rest" means all items not explicitly mentioned in the expression
- Multiple expressions separated by spaces are applied left-to-right

---

## Execution Protocol

### \u26d4 CHECKPOINT 1: Parse & Simulate
**REQUIRED OUTPUT:**
- Expression(s): _____
- Moves planned:
| Item ID | Description | From | To |
|---------|-------------|------|----|
| _____ | _____ | P___ | P___ |

- Fibonacci check:
| Priority | Before | After | Limit | OK? |
|----------|--------|-------|-------|-----|

**USER GATE:** Use AskUserQuestion
- Question: "Rebalance moves [N] items. [Show summary]. Fibonacci OK: [yes/no]. Apply?"
- Options: ["Apply", "Edit expression", "Show full preview"]

STOP and wait for user response.

---

### \u26d4 CHECKPOINT 2: Apply & Confirm
**REQUIRED OUTPUT:**
- Moves applied: _____
- Updated priority dashboard (same format as w-action-list)
- Any cascade effects: _____

**AUTO-PROCEED:** Workflow complete.

---

## Completion Checklist

- [ ] TodoWrite used at start
- [ ] Expression(s) parsed correctly
- [ ] Fibonacci limits validated
- [ ] Before/after preview shown to user
- [ ] Moves applied
- [ ] Updated dashboard rendered

\u26a0\ufe0f Workflow INCOMPLETE until all boxes checked

## Example
\`\`\`
/w-action-rebalance 1,2->p2 rest->p5
\`\`\`
`
    },

    'w-hitlist': {
      name: 'w-hitlist',
      description: 'Top 3 action items quick view',
      content: `# /w-hitlist

Instant view of top 3 highest-priority action items. Zero friction, zero ceremony.

## Usage
\`\`\`
/w-hitlist
\`\`\`

---

## \u26a0\ufe0f MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Load action items sorted by priority then due date
2. Select top 3
3. Render compact hit list

\u26a0\ufe0f VIOLATION: Any action before TodoWrite = restart workflow

---

## Execution Protocol

### \u26d4 CHECKPOINT 1: Render Hit List
**REQUIRED OUTPUT:**

\`\`\`
\ud83c\udfaf HIT LIST
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
1. [P_] _____ (due: _____)
2. [P_] _____ (due: _____)
3. [P_] _____ (due: _____)
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
Total active: _____ | Overdue: _____
\`\`\`

**AUTO-PROCEED:** Workflow complete.

---

## Completion Checklist

- [ ] TodoWrite used at start
- [ ] Items loaded and sorted
- [ ] Top 3 rendered
- [ ] Counts shown

\u26a0\ufe0f Workflow INCOMPLETE until all boxes checked

## Example
\`\`\`
/w-hitlist
\`\`\`
`
    },

    // =========================================================================
    // FOLLOW-UPS
    // =========================================================================

    'w-followup': {
      name: 'w-followup',
      description: 'Create follow-up with natural language date/person extraction',
      content: `# /w-followup

Create a follow-up item with automatic date and person extraction from natural language.

## Usage
\`\`\`
/w-followup Check with Sarah about API contract by Thursday
/w-followup Ping design team re: new icons next Monday
\`\`\`

---

## \u26a0\ufe0f MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Parse natural language for person, topic, and date
2. Confirm extracted fields
3. Save follow-up with reminder date
4. Confirm creation

\u26a0\ufe0f VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- ALWAYS extract person/team, topic, and date from input
- If date is ambiguous, ask for clarification
- If no person detected, mark as self-follow-up
- Store with ISO date for sorting

---

## Execution Protocol

### \u26d4 CHECKPOINT 1: Parse & Extract
**REQUIRED OUTPUT:**
- Person/Team: _____ (extracted or "self")
- Topic: _____
- Due date: _____ (extracted, ISO format)
- Raw input: _____
- Confidence: high/medium/low

**USER GATE:** Use AskUserQuestion
- Question: "Follow-up: [person] re: [topic] by [date]. Correct?"
- Options: ["Save", "Edit person", "Edit date", "Edit topic"]

STOP and wait for user response.

---

### \u26d4 CHECKPOINT 2: Save & Confirm
**REQUIRED OUTPUT:**
- Follow-up saved: ID ___
- Person: _____
- Topic: _____
- Due: _____
- Reminder: _____ (1 day before due)

**AUTO-PROCEED:** Workflow complete.

---

## Completion Checklist

- [ ] TodoWrite used at start
- [ ] Natural language parsed
- [ ] Person, topic, date extracted
- [ ] User confirmed details
- [ ] Follow-up saved with reminder

\u26a0\ufe0f Workflow INCOMPLETE until all boxes checked

## Example
\`\`\`
/w-followup Ask Mike about the billing migration timeline by next Wednesday
\`\`\`
`
    },

    'w-followup-done': {
      name: 'w-followup-done',
      description: 'Complete follow-up with optional outcome recording',
      content: `# /w-followup-done

Complete a follow-up and optionally record the outcome for future reference.

## Usage
\`\`\`
/w-followup-done
/w-followup-done 5
/w-followup-done 5 --outcome "Mike confirmed Q2 timeline"
\`\`\`

---

## \u26a0\ufe0f MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Load open follow-ups
2. Select follow-up to complete
3. Record optional outcome
4. Mark complete with timestamp

\u26a0\ufe0f VIOLATION: Any action before TodoWrite = restart workflow

---

## Execution Protocol

### \u26d4 CHECKPOINT 1: Select Follow-Up
**REQUIRED OUTPUT:**
- Open follow-ups:
| ID | Person | Topic | Due | Status |
|----|--------|-------|-----|--------|
| _____ | _____ | _____ | _____ | _____ |

- Selected: ID ___

**USER GATE:** Use AskUserQuestion
- Question: "Complete follow-up #[ID]: [person] re: [topic]. Record outcome?"
- Options: ["Complete (no outcome)", "Record outcome", "Choose different"]

STOP and wait for user response.

---

### \u26d4 CHECKPOINT 2: Complete & Record
**REQUIRED OUTPUT:**
- Follow-up completed: ID ___
- Outcome recorded: _____ (or "none")
- Completed at: _____
- Remaining open follow-ups: _____

**AUTO-PROCEED:** Workflow complete.

---

## Completion Checklist

- [ ] TodoWrite used at start
- [ ] Open follow-ups listed
- [ ] Follow-up selected
- [ ] Outcome recorded (if provided)
- [ ] Follow-up marked complete

\u26a0\ufe0f Workflow INCOMPLETE until all boxes checked

## Example
\`\`\`
/w-followup-done 5 --outcome "Confirmed: API contract frozen until March"
\`\`\`
`
    },

    // =========================================================================
    // KNOWLEDGE CAPTURE
    // =========================================================================

    'w-fact': {
      name: 'w-fact',
      description: 'Capture facts with enrichment tracking (economy, progression, design-rule, etc.)',
      content: `# /w-fact

Capture a fact with category tagging and enrichment tracking. Facts are atomic units of verified knowledge.

Categories: economy, progression, design-rule, metric, constraint, decision, dependency, persona, competitor, market, technical, process.

## Usage
\`\`\`
/w-fact DAU dropped 12% after removing the tutorial
/w-fact "Stripe requires PCI-DSS for card storage" --category constraint --confidence high
\`\`\`

---

## \u26a0\ufe0f MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Parse fact and extract category signals
2. Check for duplicate or related facts
3. Assign category, confidence, source
4. Save fact with enrichment status
5. Suggest enrichment opportunities

\u26a0\ufe0f VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- NEVER store unverified claims as high-confidence facts
- ALWAYS assign a category (auto-detect or ask)
- ALWAYS track enrichment status: raw -> enriched -> verified
- Tag with source if mentioned

---

## Execution Protocol

### \u26d4 CHECKPOINT 1: Parse & Categorize
**REQUIRED OUTPUT:**
- Fact: _____
- Auto-detected category: _____
- Confidence: high/medium/low
- Source: _____ (if detected, else "direct observation")
- Related facts found: _____ (0+ existing)

**USER GATE:** Use AskUserQuestion
- Question: "Fact: '[fact]' as [category] ([confidence]). Correct?"
- Options: ["Save", "Change category", "Change confidence", "Edit fact"]

STOP and wait for user response.

---

### \u26d4 CHECKPOINT 2: Save & Suggest Enrichment
**REQUIRED OUTPUT:**
- Fact saved: ID ___
- Category: _____
- Confidence: _____
- Enrichment status: raw
- Enrichment suggestions:
  - [ ] Cross-reference with _____ (related fact)
  - [ ] Verify source: _____
  - [ ] Quantify impact: _____

**AUTO-PROCEED:** Workflow complete.

---

## Completion Checklist

- [ ] TodoWrite used at start
- [ ] Fact parsed and categorized
- [ ] Duplicates checked
- [ ] Confidence assigned
- [ ] Fact saved
- [ ] Enrichment suggestions provided

\u26a0\ufe0f Workflow INCOMPLETE until all boxes checked

## Example
\`\`\`
/w-fact "Users who complete onboarding within 3 min have 2x retention" --category progression --confidence high
\`\`\`
`
    },

    'w-fact-enrich': {
      name: 'w-fact-enrich',
      description: 'Progressively enhance facts with additional context',
      content: `# /w-fact-enrich

Progressively enhance an existing fact with additional context, sources, cross-references, or quantification.

## Usage
\`\`\`
/w-fact-enrich 12
/w-fact-enrich 12 --add-source "Q4 analytics report"
/w-fact-enrich 12 --cross-ref 7,15
\`\`\`

---

## \u26a0\ufe0f MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Load the target fact
2. Show current enrichment status
3. Apply enrichment (source, cross-ref, quantification, context)
4. Update enrichment status
5. Show enriched fact

\u26a0\ufe0f VIOLATION: Any action before TodoWrite = restart workflow

---

## Execution Protocol

### \u26d4 CHECKPOINT 1: Load & Show Current State
**REQUIRED OUTPUT:**
- Fact ID: ___
- Content: _____
- Category: _____
- Current enrichment status: raw/enriched/verified
- Current enrichments:
  - Sources: _____
  - Cross-refs: _____
  - Quantification: _____

**AUTO-PROCEED:** Continue to enrichment.

---

### \u26d4 CHECKPOINT 2: Apply Enrichment
**REQUIRED OUTPUT:**
- Enrichment type: source/cross-ref/quantification/context
- New data added: _____
- Updated status: _____

**USER GATE:** Use AskUserQuestion
- Question: "Enriched fact #[ID] with [type]. Status now: [status]. Anything else to add?"
- Options: ["Done", "Add more", "Edit"]

STOP and wait for user response.

---

### \u26d4 CHECKPOINT 3: Save Enriched Fact
**REQUIRED OUTPUT:**
- Fact updated: ID ___
- Enrichment status: _____
- Total enrichments: _____

**AUTO-PROCEED:** Workflow complete.

---

## Completion Checklist

- [ ] TodoWrite used at start
- [ ] Fact loaded
- [ ] Enrichment applied
- [ ] Status updated
- [ ] Enriched fact saved

\u26a0\ufe0f Workflow INCOMPLETE until all boxes checked

## Example
\`\`\`
/w-fact-enrich 12 --add-source "Q4 retention report, slide 14"
\`\`\`
`
    },

    'w-fact-search': {
      name: 'w-fact-search',
      description: 'Search facts by keyword, category, tag, confidence, source',
      content: `# /w-fact-search

Search across all captured facts by keyword, category, tag, confidence level, or source.

## Usage
\`\`\`
/w-fact-search retention
/w-fact-search --category economy --confidence high
/w-fact-search --tag pricing --source "analytics"
\`\`\`

---

## \u26a0\ufe0f MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Parse search query and filters
2. Search across all facts
3. Rank and display results
4. Offer refinement options

\u26a0\ufe0f VIOLATION: Any action before TodoWrite = restart workflow

---

## Execution Protocol

### \u26d4 CHECKPOINT 1: Search & Rank
**REQUIRED OUTPUT:**
- Query: _____
- Filters: _____
- Results found: _____

| # | ID | Fact | Category | Confidence | Enrichment |
|---|----|------|----------|------------|------------|
| 1 | _____ | _____ | _____ | _____ | _____ |
| 2 | _____ | _____ | _____ | _____ | _____ |

**USER GATE:** Use AskUserQuestion
- Question: "Found [N] facts matching '[query]'. Refine or done?"
- Options: ["Done", "Refine search", "Enrich a fact", "Show related"]

STOP and wait for user response.

---

## Completion Checklist

- [ ] TodoWrite used at start
- [ ] Query parsed
- [ ] Facts searched
- [ ] Results ranked and displayed

\u26a0\ufe0f Workflow INCOMPLETE until all boxes checked

## Example
\`\`\`
/w-fact-search --category design-rule --confidence high
\`\`\`
`
    },

    'w-insight': {
      name: 'w-insight',
      description: 'Capture insight with impact categorization (Revenue/Engagement/Retention/Acquisition)',
      content: `# /w-insight

Capture a product insight with impact categorization across RERA dimensions: Revenue, Engagement, Retention, Acquisition.

## Usage
\`\`\`
/w-insight "Users who invite 3+ friends in week 1 have 4x LTV"
/w-insight "Dark mode users have 23% longer sessions" --impact engagement,retention
\`\`\`

---

## \u26a0\ufe0f MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Parse insight and detect impact dimensions
2. Check for related insights and facts
3. Assign impact scores (Revenue/Engagement/Retention/Acquisition)
4. Save insight with action implications
5. Link to supporting facts

\u26a0\ufe0f VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- ALWAYS categorize across all 4 RERA dimensions (even if score is 0)
- ALWAYS link to supporting facts when available
- Insights differ from facts: insights imply an action or opportunity
- Score each dimension: 0 (none), 1 (low), 2 (medium), 3 (high)

---

## Execution Protocol

### \u26d4 CHECKPOINT 1: Parse & Score
**REQUIRED OUTPUT:**
- Insight: _____
- RERA Impact:
| Dimension | Score (0-3) | Rationale |
|-----------|-------------|-----------|
| Revenue | ___ | _____ |
| Engagement | ___ | _____ |
| Retention | ___ | _____ |
| Acquisition | ___ | _____ |

- Total impact score: ___/12
- Supporting facts: _____ (IDs if found)
- Implied action: _____

**USER GATE:** Use AskUserQuestion
- Question: "Insight scored [N/12] impact. Primary: [dimension]. Save?"
- Options: ["Save", "Adjust scores", "Edit insight", "Link more facts"]

STOP and wait for user response.

---

### \u26d4 CHECKPOINT 2: Save & Connect
**REQUIRED OUTPUT:**
- Insight saved: ID ___
- Impact score: ___/12
- Linked facts: _____
- Suggested actions:
  - [ ] _____
  - [ ] _____

**AUTO-PROCEED:** Workflow complete.

---

## Completion Checklist

- [ ] TodoWrite used at start
- [ ] Insight parsed
- [ ] RERA dimensions scored
- [ ] Related facts linked
- [ ] Insight saved
- [ ] Action implications noted

\u26a0\ufe0f Workflow INCOMPLETE until all boxes checked

## Example
\`\`\`
/w-insight "Push notification opt-in users generate 3x more revenue" --impact revenue,engagement
\`\`\`
`
    },

    'w-idea': {
      name: 'w-idea',
      description: 'Minimal-friction idea capture (status: draft -> refined -> shared)',
      content: `# /w-idea

Ultra-low friction idea capture. Just dump the idea - everything else is optional.

Status lifecycle: draft -> refined -> shared

## Usage
\`\`\`
/w-idea What if we gamified the onboarding with streaks?
/w-idea "Tiered pricing with usage-based billing for enterprise"
\`\`\`

---

## \u26a0\ufe0f MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Capture raw idea text
2. Auto-tag with detected themes
3. Save as draft
4. Show capture confirmation

\u26a0\ufe0f VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- ZERO friction - do not ask questions, just save
- Auto-detect themes/tags but do not require confirmation
- Status starts as "draft" always
- No priority assignment at capture time

---

## Execution Protocol

### \u26d4 CHECKPOINT 1: Capture & Tag
**REQUIRED OUTPUT:**
- Idea: _____
- Auto-tags: _____
- Status: draft
- Saved: ID ___

\`\`\`
\ud83d\udca1 Idea captured (#___)
   "[first 60 chars]..."
   Tags: [auto-tags]
   Status: draft
   Refine: /w-idea-refine ___
\`\`\`

**AUTO-PROCEED:** Workflow complete.

---

## Completion Checklist

- [ ] TodoWrite used at start
- [ ] Idea captured verbatim
- [ ] Auto-tags applied
- [ ] Saved as draft
- [ ] Confirmation shown with refine command

\u26a0\ufe0f Workflow INCOMPLETE until all boxes checked

## Example
\`\`\`
/w-idea What if the dashboard had a "focus mode" that hides everything except the current sprint?
\`\`\`
`
    },

    'w-idea-refine': {
      name: 'w-idea-refine',
      description: 'Structured refinement (category, effort XS-XL, impact Low-High)',
      content: `# /w-idea-refine

Structured refinement of a draft idea. Adds category, effort estimate, impact assessment, and narrative.

## Usage
\`\`\`
/w-idea-refine 7
/w-idea-refine 7 --category growth --effort M --impact high
\`\`\`

---

## \u26a0\ufe0f MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Load draft idea
2. Interview for refinement details
3. Assign category, effort (XS/S/M/L/XL), impact (Low/Medium/High)
4. Write narrative summary
5. Update status to "refined"

\u26a0\ufe0f VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- ALWAYS load the original draft idea first
- Effort uses t-shirt sizes: XS, S, M, L, XL
- Impact uses: Low, Medium, High
- Category options: growth, retention, monetization, platform, experience, infrastructure

---

## Execution Protocol

### \u26d4 CHECKPOINT 1: Load & Interview
**REQUIRED OUTPUT:**
- Idea ID: ___
- Original draft: _____
- Current tags: _____

**USER GATE:** Use AskUserQuestion
- Question: "Refining idea #[ID]: '[idea]'. What problem does this solve? Who benefits most?"
- Options: [Free text response expected]

STOP and wait for user response.

---

### \u26d4 CHECKPOINT 2: Assign Dimensions
**REQUIRED OUTPUT:**
- Category: _____
- Effort: XS/S/M/L/XL
- Impact: Low/Medium/High
- Effort/Impact ratio: _____
- Narrative: _____ (2-3 sentences)

**USER GATE:** Use AskUserQuestion
- Question: "Refined: [category], effort [size], impact [level]. Ratio: [X]. Confirm?"
- Options: ["Save", "Adjust", "Add more context"]

STOP and wait for user response.

---

### \u26d4 CHECKPOINT 3: Save Refined
**REQUIRED OUTPUT:**
- Idea updated: ID ___
- Status: refined
- Category: _____
- Effort: _____
- Impact: _____
- Share ready: /w-idea-share ___

**AUTO-PROCEED:** Workflow complete.

---

## Completion Checklist

- [ ] TodoWrite used at start
- [ ] Draft idea loaded
- [ ] Interview completed
- [ ] Category, effort, impact assigned
- [ ] Narrative written
- [ ] Status updated to refined

\u26a0\ufe0f Workflow INCOMPLETE until all boxes checked

## Example
\`\`\`
/w-idea-refine 7 --category growth --effort M --impact high
\`\`\`
`
    },

    'w-idea-share': {
      name: 'w-idea-share',
      description: 'Transform refined idea to shareable markdown',
      content: `# /w-idea-share

Transform a refined idea into polished, shareable markdown suitable for team communication.

## Usage
\`\`\`
/w-idea-share 7
/w-idea-share 7 --format brief
/w-idea-share 7 --format detailed
\`\`\`

---

## \u26a0\ufe0f MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Load refined idea
2. Generate shareable markdown
3. Preview output
4. Update status to "shared"

\u26a0\ufe0f VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- ONLY share ideas with status "refined" (prompt to refine if draft)
- Brief format: 1 paragraph + key stats
- Detailed format: full writeup with problem/solution/impact/effort

---

## Execution Protocol

### \u26d4 CHECKPOINT 1: Load & Validate
**REQUIRED OUTPUT:**
- Idea ID: ___
- Status: _____ (must be "refined")
- Content loaded: yes/no

**AUTO-PROCEED:** Continue to generate if refined. Prompt to refine if draft.

---

### \u26d4 CHECKPOINT 2: Generate Shareable
**REQUIRED OUTPUT:**

Generated markdown:
\`\`\`markdown
## [Idea Title]

**Category:** [X] | **Effort:** [XS-XL] | **Impact:** [Low-High]

### Problem
[What problem this solves]

### Proposal
[The idea, fleshed out]

### Expected Impact
[Impact narrative with RERA dimensions if linked to insights]

### Effort Estimate
[T-shirt size with rough breakdown]
\`\`\`

**USER GATE:** Use AskUserQuestion
- Question: "Shareable markdown generated. Preview looks good?"
- Options: ["Copy & mark shared", "Edit", "Change format"]

STOP and wait for user response.

---

### \u26d4 CHECKPOINT 3: Mark Shared
**REQUIRED OUTPUT:**
- Idea updated: ID ___
- Status: shared
- Shared at: _____

**AUTO-PROCEED:** Workflow complete.

---

## Completion Checklist

- [ ] TodoWrite used at start
- [ ] Refined idea loaded
- [ ] Shareable markdown generated
- [ ] User approved output
- [ ] Status updated to shared

\u26a0\ufe0f Workflow INCOMPLETE until all boxes checked

## Example
\`\`\`
/w-idea-share 7 --format detailed
\`\`\`
`
    },

    'w-ramble': {
      name: 'w-ramble',
      description: 'Ultra-low friction raw thoughts capture',
      content: `# /w-ramble

Ultra-low friction raw thought capture. Just talk - no structure required. Everything gets timestamped and saved.

## Usage
\`\`\`
/w-ramble I keep thinking about how our onboarding is too long. Like maybe we should just skip the profile setup entirely and let people discover features naturally. Also the notifications are annoying everyone.
\`\`\`

---

## \u26a0\ufe0f MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Capture raw text verbatim
2. Auto-detect themes and entities
3. Save with timestamp
4. Show minimal confirmation

\u26a0\ufe0f VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- ABSOLUTE ZERO friction - no questions, no confirmations, just save
- Preserve the EXACT raw text - do not clean up or restructure
- Auto-detect themes silently (for search later)
- Always show the refine command in confirmation

---

## Execution Protocol

### \u26d4 CHECKPOINT 1: Capture
**REQUIRED OUTPUT:**

\`\`\`
\ud83c\udf00 Ramble saved (#___)
   [first 80 chars]...
   Themes: [auto-detected]
   Refine: /w-ramble-refine ___
\`\`\`

**AUTO-PROCEED:** Workflow complete. No user interaction needed.

---

## Completion Checklist

- [ ] TodoWrite used at start
- [ ] Raw text captured verbatim
- [ ] Themes auto-detected
- [ ] Saved with timestamp
- [ ] Confirmation shown

\u26a0\ufe0f Workflow INCOMPLETE until all boxes checked

## Example
\`\`\`
/w-ramble The competitor just launched a feature we talked about 6 months ago. We should have moved faster. Maybe we need a faster experimentation pipeline. What if we had a "lab" section where features go live to 5% of users?
\`\`\`
`
    },

    'w-ramble-refine': {
      name: 'w-ramble-refine',
      description: 'Multi-mode refinement (Restructure/Summarize/Extract actions/Transform/Manual)',
      content: `# /w-ramble-refine

Refine a saved ramble using one of 5 modes. Each mode produces a versioned refinement while preserving the original.

Modes:
- **Restructure** - Organize into logical sections
- **Summarize** - Condense to key points
- **Extract actions** - Pull out action items
- **Transform** - Convert to another format (spec, brief, email)
- **Manual** - Free-form edit

## Usage
\`\`\`
/w-ramble-refine 4
/w-ramble-refine 4 --mode summarize
/w-ramble-refine 4 --mode extract-actions
/w-ramble-refine 4 --mode transform --to spec
\`\`\`

---

## \u26a0\ufe0f MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Load ramble and any existing refinements
2. Select refinement mode
3. Apply refinement
4. Save as new version (preserving original)
5. Show result with diff

\u26a0\ufe0f VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- NEVER modify the original ramble - always create a new version
- Version history: v0 (original) -> v1 (first refinement) -> v2 ...
- Each version records: mode used, timestamp, content
- Extract actions mode should create actual action items via w-action

---

## Execution Protocol

### \u26d4 CHECKPOINT 1: Load & Select Mode
**REQUIRED OUTPUT:**
- Ramble ID: ___
- Original text: _____
- Existing versions: _____
- Current themes: _____

**USER GATE:** Use AskUserQuestion
- Question: "Ramble #[ID] loaded ([N] versions). Which refinement mode?"
- Options: ["Restructure", "Summarize", "Extract actions", "Transform", "Manual"]

STOP and wait for user response.

---

### \u26d4 CHECKPOINT 2: Apply Refinement
**REQUIRED OUTPUT:**
- Mode: _____
- Refinement result: _____
- Changes from previous version: _____

**USER GATE:** Use AskUserQuestion
- Question: "Refinement complete (v[N]). Accept?"
- Options: ["Accept", "Try different mode", "Edit manually"]

STOP and wait for user response.

---

### \u26d4 CHECKPOINT 3: Save Version
**REQUIRED OUTPUT:**
- Saved as: v___
- Mode used: _____
- Actions created: _____ (if extract-actions mode)

**AUTO-PROCEED:** Workflow complete.

---

## Completion Checklist

- [ ] TodoWrite used at start
- [ ] Ramble loaded
- [ ] Mode selected
- [ ] Refinement applied
- [ ] New version saved (original preserved)
- [ ] Actions created (if applicable)

\u26a0\ufe0f Workflow INCOMPLETE until all boxes checked

## Example
\`\`\`
/w-ramble-refine 4 --mode extract-actions
\`\`\`
`
    },

    'w-ramble-search': {
      name: 'w-ramble-search',
      description: 'Keyword search across ramblings and versions',
      content: `# /w-ramble-search

Search across all ramblings and their refined versions by keyword or theme.

## Usage
\`\`\`
/w-ramble-search onboarding
/w-ramble-search --theme pricing
/w-ramble-search "experimentation pipeline"
\`\`\`

---

## \u26a0\ufe0f MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Parse search query
2. Search across all ramblings and versions
3. Rank and display results
4. Offer refinement or action options

\u26a0\ufe0f VIOLATION: Any action before TodoWrite = restart workflow

---

## Execution Protocol

### \u26d4 CHECKPOINT 1: Search & Display
**REQUIRED OUTPUT:**
- Query: _____
- Results found: _____

| # | ID | Preview | Themes | Versions | Date |
|---|----|---------|--------|----------|------|
| 1 | _____ | _____ | _____ | v___ | _____ |
| 2 | _____ | _____ | _____ | v___ | _____ |

**USER GATE:** Use AskUserQuestion
- Question: "Found [N] ramblings matching '[query]'. What next?"
- Options: ["Done", "Refine one", "Search again", "Extract actions from all"]

STOP and wait for user response.

---

## Completion Checklist

- [ ] TodoWrite used at start
- [ ] Query parsed
- [ ] Ramblings and versions searched
- [ ] Results ranked and displayed

\u26a0\ufe0f Workflow INCOMPLETE until all boxes checked

## Example
\`\`\`
/w-ramble-search "notification" --theme engagement
\`\`\`
`
    },

    'w-knowledge': {
      name: 'w-knowledge',
      description: 'Store links and references with auto URL detection',
      content: `# /w-knowledge

Store links, references, and bookmarks with automatic URL detection and metadata extraction.

## Usage
\`\`\`
/w-knowledge https://stripe.com/docs/billing - Stripe billing docs for metered usage
/w-knowledge "Kano model" --tag framework --tag prioritization
\`\`\`

---

## \u26a0\ufe0f MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Parse input for URLs and descriptions
2. Auto-extract metadata from URLs (title, domain, type)
3. Assign tags and category
4. Check for duplicates
5. Save knowledge item

\u26a0\ufe0f VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- Auto-detect URLs in input text
- If URL found, extract page title and domain automatically
- If no URL, treat as a concept/reference bookmark
- Always check for duplicate URLs before saving
- Tag suggestions based on content

---

## Execution Protocol

### \u26d4 CHECKPOINT 1: Parse & Extract
**REQUIRED OUTPUT:**
- Type: link/reference/concept
- URL: _____ (if applicable)
- Title: _____ (auto-extracted or provided)
- Description: _____
- Tags: _____
- Duplicate check: clear/duplicate of #___

**USER GATE:** Use AskUserQuestion
- Question: "Store: '[title]' ([type]) with tags [tags]. Confirm?"
- Options: ["Save", "Edit tags", "Edit description", "Cancel (duplicate)"]

STOP and wait for user response.

---

### \u26d4 CHECKPOINT 2: Save
**REQUIRED OUTPUT:**
- Knowledge item saved: ID ___
- Type: _____
- Tags: _____
- Search: /w-knowledge-search [primary-tag]

**AUTO-PROCEED:** Workflow complete.

---

## Completion Checklist

- [ ] TodoWrite used at start
- [ ] Input parsed (URL detection)
- [ ] Metadata extracted
- [ ] Duplicates checked
- [ ] Tags assigned
- [ ] Knowledge item saved

\u26a0\ufe0f Workflow INCOMPLETE until all boxes checked

## Example
\`\`\`
/w-knowledge https://www.intercom.com/blog/rice-scoring - RICE prioritization framework overview
\`\`\`
`
    },

    'w-knowledge-search': {
      name: 'w-knowledge-search',
      description: 'Cross-entity search by keyword or tag',
      content: `# /w-knowledge-search

Search across ALL knowledge entities (facts, insights, ideas, ramblings, knowledge items) by keyword or tag.

## Usage
\`\`\`
/w-knowledge-search pricing
/w-knowledge-search --tag framework
/w-knowledge-search --type fact,insight "retention"
\`\`\`

---

## \u26a0\ufe0f MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Parse search query and filters
2. Search across all entity types
3. Group and rank results
4. Display cross-entity results

\u26a0\ufe0f VIOLATION: Any action before TodoWrite = restart workflow

---

## Execution Protocol

### \u26d4 CHECKPOINT 1: Cross-Entity Search
**REQUIRED OUTPUT:**
- Query: _____
- Filters: _____
- Results by type:

**Facts ([N]):**
| ID | Fact | Category | Confidence |
|----|------|----------|------------|

**Insights ([N]):**
| ID | Insight | Impact Score | Dimensions |
|----|---------|-------------|------------|

**Ideas ([N]):**
| ID | Idea | Status | Category |
|----|------|--------|----------|

**Ramblings ([N]):**
| ID | Preview | Themes | Versions |
|----|---------|--------|----------|

**Knowledge ([N]):**
| ID | Title | Type | Tags |
|----|-------|------|------|

- Total results: _____

**USER GATE:** Use AskUserQuestion
- Question: "Found [N] items across [M] types for '[query]'. What next?"
- Options: ["Done", "Filter by type", "Refine search", "Open item"]

STOP and wait for user response.

---

## Completion Checklist

- [ ] TodoWrite used at start
- [ ] Query parsed
- [ ] All entity types searched
- [ ] Results grouped by type
- [ ] Cross-entity results displayed

\u26a0\ufe0f Workflow INCOMPLETE until all boxes checked

## Example
\`\`\`
/w-knowledge-search --tag retention --type fact,insight
\`\`\`
`
    },

    // =========================================================================
    // STRATEGIC HIERARCHY
    // =========================================================================

    'w-goal': {
      name: 'w-goal',
      description: 'Create strategic goals',
      content: `# /w-goal

Create a strategic goal. Goals sit at the top of the hierarchy: Goal -> Initiative -> Project.

## Usage
\`\`\`
/w-goal "Increase monthly active users by 40% in Q3"
/w-goal "Reduce churn to under 5%"
\`\`\`

---

## \u26a0\ufe0f MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Parse goal statement
2. Validate goal quality (SMART criteria check)
3. Interview for key results and timeframe
4. Link to existing initiatives (if any)
5. Save goal

\u26a0\ufe0f VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- Goals should be measurable and time-bound
- Apply SMART check: Specific, Measurable, Achievable, Relevant, Time-bound
- Each goal should have 1-3 key results
- Goals link downward to initiatives

---

## Execution Protocol

### \u26d4 CHECKPOINT 1: Parse & SMART Check
**REQUIRED OUTPUT:**
- Goal statement: _____
- SMART assessment:
| Criteria | Score | Notes |
|----------|-------|-------|
| Specific | \u2705/\u26a0\ufe0f/\u274c | _____ |
| Measurable | \u2705/\u26a0\ufe0f/\u274c | _____ |
| Achievable | \u2705/\u26a0\ufe0f/\u274c | _____ |
| Relevant | \u2705/\u26a0\ufe0f/\u274c | _____ |
| Time-bound | \u2705/\u26a0\ufe0f/\u274c | _____ |

**USER GATE:** Use AskUserQuestion
- Question: "Goal SMART score: [N/5]. [Suggestions if < 5]. Proceed or refine?"
- Options: ["Save as-is", "Refine goal", "Add key results"]

STOP and wait for user response.

---

### \u26d4 CHECKPOINT 2: Key Results
**REQUIRED OUTPUT:**
- Key results:
| # | Key Result | Metric | Target | Deadline |
|---|-----------|--------|--------|----------|
| 1 | _____ | _____ | _____ | _____ |
| 2 | _____ | _____ | _____ | _____ |

**USER GATE:** Use AskUserQuestion
- Question: "Goal with [N] key results. Save?"
- Options: ["Save", "Add more KRs", "Edit KRs"]

STOP and wait for user response.

---

### \u26d4 CHECKPOINT 3: Save Goal
**REQUIRED OUTPUT:**
- Goal saved: ID ___
- Key results: _____
- Linked initiatives: _____ (if any)
- Next: /w-initiative ___ to create linked initiative

**AUTO-PROCEED:** Workflow complete.

---

## Completion Checklist

- [ ] TodoWrite used at start
- [ ] Goal parsed
- [ ] SMART criteria checked
- [ ] Key results defined
- [ ] Goal saved
- [ ] Hierarchy link shown

\u26a0\ufe0f Workflow INCOMPLETE until all boxes checked

## Example
\`\`\`
/w-goal "Achieve product-market fit by end of Q2 - measured by 40% weekly retention at 12 weeks"
\`\`\`
`
    },

    'w-initiative': {
      name: 'w-initiative',
      description: 'Create goal-linked initiatives with interview',
      content: `# /w-initiative

Create an initiative linked to a strategic goal. Initiatives bridge goals and projects: Goal -> Initiative -> Project.

## Usage
\`\`\`
/w-initiative "Redesign onboarding flow" --goal 3
/w-initiative "Launch referral program"
\`\`\`

---

## \u26a0\ufe0f MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Load available goals
2. Interview for initiative details
3. Link to parent goal
4. Define success criteria
5. Save initiative

\u26a0\ufe0f VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- Every initiative SHOULD link to a goal (warn if orphaned)
- Interview to extract: scope, success criteria, timeline, dependencies
- Initiatives contain 1+ projects

---

## Execution Protocol

### \u26d4 CHECKPOINT 1: Goal Link
**REQUIRED OUTPUT:**
- Available goals:
| ID | Goal | Key Results | Initiatives |
|----|------|------------|-------------|
| _____ | _____ | _____ | _____ |

- Initiative name: _____
- Linked goal: ID ___ (or "orphaned")

**USER GATE:** Use AskUserQuestion
- Question: "Link initiative '[name]' to goal #[ID]: '[goal]'?"
- Options: ["Confirm", "Choose different goal", "Create without goal"]

STOP and wait for user response.

---

### \u26d4 CHECKPOINT 2: Interview
**REQUIRED OUTPUT:**
- Scope: _____
- Success criteria:
  - [ ] _____
  - [ ] _____
- Timeline: _____
- Dependencies: _____
- Risks: _____

**USER GATE:** Use AskUserQuestion
- Question: "Initiative scoped. [N] success criteria, timeline: [X]. Save?"
- Options: ["Save", "Edit scope", "Add criteria"]

STOP and wait for user response.

---

### \u26d4 CHECKPOINT 3: Save Initiative
**REQUIRED OUTPUT:**
- Initiative saved: ID ___
- Parent goal: #___
- Success criteria: _____
- Next: /w-project ___ to create linked project

**AUTO-PROCEED:** Workflow complete.

---

## Completion Checklist

- [ ] TodoWrite used at start
- [ ] Goals loaded
- [ ] Goal link established
- [ ] Interview completed
- [ ] Success criteria defined
- [ ] Initiative saved

\u26a0\ufe0f Workflow INCOMPLETE until all boxes checked

## Example
\`\`\`
/w-initiative "Self-serve onboarding with interactive tutorial" --goal 1
\`\`\`
`
    },

    'w-project': {
      name: 'w-project',
      description: 'Create initiative-linked projects',
      content: `# /w-project

Create a project linked to an initiative. Projects are the execution layer: Goal -> Initiative -> Project.

## Usage
\`\`\`
/w-project "Build onboarding wizard component" --initiative 5
/w-project "A/B test tutorial variants"
\`\`\`

---

## \u26a0\ufe0f MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Load available initiatives
2. Define project scope and deliverables
3. Link to parent initiative
4. Break into milestones
5. Save project

\u26a0\ufe0f VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- Every project SHOULD link to an initiative (warn if orphaned)
- Projects have concrete deliverables and milestones
- Milestones map to action items via w-action

---

## Execution Protocol

### \u26d4 CHECKPOINT 1: Initiative Link
**REQUIRED OUTPUT:**
- Available initiatives:
| ID | Initiative | Goal | Projects |
|----|-----------|------|----------|
| _____ | _____ | _____ | _____ |

- Project name: _____
- Linked initiative: ID ___ (or "orphaned")

**USER GATE:** Use AskUserQuestion
- Question: "Link project '[name]' to initiative #[ID]: '[initiative]'?"
- Options: ["Confirm", "Choose different initiative", "Create without initiative"]

STOP and wait for user response.

---

### \u26d4 CHECKPOINT 2: Scope & Milestones
**REQUIRED OUTPUT:**
- Project scope: _____
- Deliverables:
  - [ ] _____
  - [ ] _____
- Milestones:
| # | Milestone | Target Date | Deliverables |
|---|----------|-------------|-------------|
| 1 | _____ | _____ | _____ |
| 2 | _____ | _____ | _____ |

**USER GATE:** Use AskUserQuestion
- Question: "Project with [N] milestones. Create action items for milestone 1?"
- Options: ["Save & create actions", "Save only", "Edit milestones"]

STOP and wait for user response.

---

### \u26d4 CHECKPOINT 3: Save Project
**REQUIRED OUTPUT:**
- Project saved: ID ___
- Parent initiative: #___
- Milestones: _____
- Action items created: _____ (if requested)
- Hierarchy view:
\`\`\`
Goal #___: [goal]
  \u2514\u2500 Initiative #___: [initiative]
      \u2514\u2500 Project #___: [project] <-- NEW
          \u251c\u2500 Milestone 1: _____
          \u2514\u2500 Milestone 2: _____
\`\`\`

**AUTO-PROCEED:** Workflow complete.

---

## Completion Checklist

- [ ] TodoWrite used at start
- [ ] Initiatives loaded
- [ ] Initiative link established
- [ ] Scope and deliverables defined
- [ ] Milestones created
- [ ] Project saved
- [ ] Hierarchy displayed

\u26a0\ufe0f Workflow INCOMPLETE until all boxes checked

## Example
\`\`\`
/w-project "Interactive tutorial flow with 3 paths" --initiative 5
\`\`\`
`
    },

    // =========================================================================
    // DAILY STANDUP
    // =========================================================================

    'w-cos': {
      name: 'w-cos',
      description: 'Full daily brief (14+ checkpoints: context, hierarchy, insights, follow-ups, actions, focus)',
      content: `# /w-cos

Full Chief of Staff daily briefing. Comprehensive 14+ checkpoint review of your entire PM workspace.

## Usage
\`\`\`
/w-cos
/w-cos --quick (abbreviated version)
\`\`\`

---

## \u26a0\ufe0f MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL checkpoints:
1. Context load
2. Strategic hierarchy display
3. Insight review
4. Idea review
5. Fact review
6. Rambling review
7. Follow-up surfacing
8. Deferred items check
9. Knowledge review
10. Hit list display
11. Full action item review
12. Overdue alert
13. Focus selection
14. Daily plan output

\u26a0\ufe0f VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- NEVER skip checkpoints even if a section is empty (report "none" instead)
- ALWAYS surface overdue items prominently
- ALWAYS end with focus selection
- Quick mode: checkpoints 1, 2, 10, 11, 13, 14 only

---

## Execution Protocol

### \u26d4 CHECKPOINT 1: Context Load
**REQUIRED OUTPUT:**
- Date: _____
- Last briefing: _____
- Items added since last briefing: _____
- Workspace health: healthy/attention-needed/critical

**AUTO-PROCEED:** Continue to hierarchy.

---

### \u26d4 CHECKPOINT 2: Strategic Hierarchy
**REQUIRED OUTPUT:**
- Goals: _____ (active)
- Initiatives: _____ (active)
- Projects: _____ (active)

Hierarchy tree:
\`\`\`
Goal #___: [goal] [progress]
  \u251c\u2500 Initiative #___: [initiative] [progress]
  \u2502   \u251c\u2500 Project #___: [project] [status]
  \u2502   \u2514\u2500 Project #___: [project] [status]
  \u2514\u2500 Initiative #___: [initiative] [progress]
\`\`\`

**AUTO-PROCEED:** Continue to insight review.

---

### \u26d4 CHECKPOINT 3: Insight Review
**REQUIRED OUTPUT:**
- New insights since last briefing: _____
- Top insight by impact: _____
- Insights needing action: _____

**AUTO-PROCEED:** Continue to idea review.

---

### \u26d4 CHECKPOINT 4: Idea Review
**REQUIRED OUTPUT:**
- Draft ideas: _____ (count)
- Refined ideas: _____ (count)
- Ideas aging > 7 days in draft: _____ (nudge to refine)

**AUTO-PROCEED:** Continue to fact review.

---

### \u26d4 CHECKPOINT 5: Fact Review
**REQUIRED OUTPUT:**
- New facts since last briefing: _____
- Facts needing enrichment: _____
- Low-confidence facts needing verification: _____

**AUTO-PROCEED:** Continue to rambling review.

---

### \u26d4 CHECKPOINT 6: Rambling Review
**REQUIRED OUTPUT:**
- Unrefined ramblings: _____ (count)
- Ramblings aging > 3 days: _____ (nudge to refine)
- Themes across recent ramblings: _____

**AUTO-PROCEED:** Continue to follow-ups.

---

### \u26d4 CHECKPOINT 7: Follow-Up Surfacing
**REQUIRED OUTPUT:**
- Due today: _____
- Overdue: _____
- Due this week: _____

| ID | Person | Topic | Due | Status |
|----|--------|-------|-----|--------|

**AUTO-PROCEED:** Continue to deferred items.

---

### \u26d4 CHECKPOINT 8: Deferred Items
**REQUIRED OUTPUT:**
- Items deferred from previous days: _____
- Items deferred > 3 times: _____ (escalation candidates)

**AUTO-PROCEED:** Continue to knowledge review.

---

### \u26d4 CHECKPOINT 9: Knowledge Review
**REQUIRED OUTPUT:**
- New knowledge items since last briefing: _____
- Untagged items: _____

**AUTO-PROCEED:** Continue to hit list.

---

### \u26d4 CHECKPOINT 10: Hit List
**REQUIRED OUTPUT:**
\`\`\`
\ud83c\udfaf HIT LIST
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
1. [P_] _____ (due: _____)
2. [P_] _____ (due: _____)
3. [P_] _____ (due: _____)
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\`\`\`

**AUTO-PROCEED:** Continue to full action review.

---

### \u26d4 CHECKPOINT 11: Full Action Item Review
**REQUIRED OUTPUT:**
- Priority dashboard (same format as w-action-list)
- Fibonacci health: all buckets within limits / overflow detected

**AUTO-PROCEED:** Continue to overdue alert.

---

### \u26d4 CHECKPOINT 12: Overdue Alert
**REQUIRED OUTPUT:**
- Overdue action items: _____
- Overdue follow-ups: _____

\u26a0\ufe0f OVERDUE ITEMS (if any):
| Type | ID | Description | Due | Days Overdue |
|------|----|-------------|-----|-------------|

**AUTO-PROCEED:** Continue to focus selection.

---

### \u26d4 CHECKPOINT 13: Focus Selection
**USER GATE:** Use AskUserQuestion
- Question: "Daily brief complete. What's your focus today?"
- Options: ["Top hit list item", "Specific action item", "Follow-ups", "Idea refinement", "Strategic planning", "Custom"]

STOP and wait for user response.

---

### \u26d4 CHECKPOINT 14: Daily Plan
**REQUIRED OUTPUT:**
- Focus: _____
- Today's plan:
  1. _____ (estimated time)
  2. _____ (estimated time)
  3. _____ (estimated time)
- Reminders set: _____

**AUTO-PROCEED:** Workflow complete.

---

## Completion Checklist

- [ ] TodoWrite used at start with all 14 checkpoints
- [ ] Checkpoints 1-12 completed (auto-proceed)
- [ ] Checkpoint 13 completed (user gate)
- [ ] Checkpoint 14 completed
- [ ] All sections reported (even if empty)
- [ ] Overdue items surfaced
- [ ] Focus selected
- [ ] Daily plan created

\u26a0\ufe0f Workflow INCOMPLETE until all boxes checked

## Example
\`\`\`
/w-cos
\`\`\`
`
    },

    // =========================================================================
    // NOTES & TOOLS
    // =========================================================================

    'w-notes': {
      name: 'w-notes',
      description: 'Quick-capture notes with smart parsing (people, topics, project refs, actions)',
      content: `# /w-notes

Quick-capture meeting notes or thoughts with smart parsing. Automatically extracts people, topics, project references, and action items.

## Usage
\`\`\`
/w-notes Talked to Sarah about the API migration. She wants it done by March. John will handle the database schema. Need to check with DevOps about staging environment.
\`\`\`

---

## \u26a0\ufe0f MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Capture raw notes
2. Smart-parse for entities (people, topics, projects, dates)
3. Extract action items
4. Save note with parsed metadata
5. Offer to create action items

\u26a0\ufe0f VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- Save raw notes first, then parse
- Auto-detect: names (capitalized words in context), dates, project references (#project), action verbs
- Extracted actions should be offered as w-action candidates, not auto-created
- Link to existing projects/initiatives if references found

---

## Execution Protocol

### \u26d4 CHECKPOINT 1: Capture & Parse
**REQUIRED OUTPUT:**
- Raw notes saved: ID ___
- Parsed entities:
  - People: _____
  - Topics: _____
  - Dates: _____
  - Project refs: _____
- Extracted action candidates:
| # | Action | Person | Due |
|---|--------|--------|-----|
| 1 | _____ | _____ | _____ |

**USER GATE:** Use AskUserQuestion
- Question: "Notes saved. Found [N] people, [M] action candidates. Create action items?"
- Options: ["Create all actions", "Select actions", "Notes only", "Edit notes"]

STOP and wait for user response.

---

### \u26d4 CHECKPOINT 2: Process Actions
**REQUIRED OUTPUT:**
- Notes saved: ID ___
- Actions created: _____ (IDs)
- Follow-ups created: _____ (IDs, if person + date detected)
- Linked to projects: _____

**AUTO-PROCEED:** Workflow complete.

---

## Completion Checklist

- [ ] TodoWrite used at start
- [ ] Raw notes captured
- [ ] Smart parsing complete
- [ ] Action candidates presented
- [ ] User-approved actions created
- [ ] Notes saved with metadata

\u26a0\ufe0f Workflow INCOMPLETE until all boxes checked

## Example
\`\`\`
/w-notes Sprint retro: Team wants shorter standups. Lisa to propose new format by Friday. Deployment pipeline is too slow - Mike investigating. Consider moving to trunk-based development.
\`\`\`
`
    },

    'w-research': {
      name: 'w-research',
      description: 'Structured research teardowns with source tracking',
      content: `# /w-research

Structured research teardown with source tracking, argument mapping, and synthesis.

## Usage
\`\`\`
/w-research "Usage-based pricing models in B2B SaaS"
/w-research "Competitor onboarding flows" --sources 5
\`\`\`

---

## \u26a0\ufe0f MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Define research question and scope
2. Gather sources and evidence
3. Analyze and map arguments
4. Synthesize findings
5. Generate recommendations
6. Save research artifact

\u26a0\ufe0f VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- ALWAYS track sources with URLs or references
- ALWAYS distinguish fact from opinion
- ALWAYS provide confidence levels on findings
- Structure as: Question -> Evidence -> Analysis -> Synthesis -> Recommendations

---

## Execution Protocol

### \u26d4 CHECKPOINT 1: Define Scope
**REQUIRED OUTPUT:**
- Research question: _____
- Scope boundaries: _____
- Expected sources: _____
- Time budget: _____

**USER GATE:** Use AskUserQuestion
- Question: "Research: '[question]'. Scope: [boundaries]. Proceed to gather?"
- Options: ["Proceed", "Narrow scope", "Broaden scope"]

STOP and wait for user response.

---

### \u26d4 CHECKPOINT 2: Gather Sources
**REQUIRED OUTPUT:**
- Sources found:
| # | Source | Type | Credibility | Key Finding |
|---|--------|------|-------------|-------------|
| 1 | _____ | _____ | high/med/low | _____ |
| 2 | _____ | _____ | high/med/low | _____ |

**AUTO-PROCEED:** Continue to analysis.

---

### \u26d4 CHECKPOINT 3: Analysis
**REQUIRED OUTPUT:**
- Argument map:
  - For: _____
  - Against: _____
  - Nuanced: _____
- Evidence strength: strong/moderate/weak
- Confidence in findings: _____

**AUTO-PROCEED:** Continue to synthesis.

---

### \u26d4 CHECKPOINT 4: Synthesis & Recommendations
**REQUIRED OUTPUT:**
- Key findings (3-5):
  1. _____ [confidence: ___]
  2. _____ [confidence: ___]
  3. _____ [confidence: ___]
- Recommendations:
  1. _____
  2. _____
- Open questions: _____

**USER GATE:** Use AskUserQuestion
- Question: "Research complete. [N] findings, [M] recommendations. Save?"
- Options: ["Save", "Dig deeper", "Edit findings"]

STOP and wait for user response.

---

### \u26d4 CHECKPOINT 5: Save Research
**REQUIRED OUTPUT:**
- Research saved: ID ___
- Facts created: _____ (auto-extracted)
- Knowledge items created: _____ (sources)
- Insights created: _____ (if applicable)

**AUTO-PROCEED:** Workflow complete.

---

## Completion Checklist

- [ ] TodoWrite used at start
- [ ] Research question defined
- [ ] Sources gathered with tracking
- [ ] Arguments mapped
- [ ] Synthesis complete
- [ ] Recommendations provided
- [ ] Research artifact saved
- [ ] Related entities created (facts, knowledge)

\u26a0\ufe0f Workflow INCOMPLETE until all boxes checked

## Example
\`\`\`
/w-research "Should we adopt usage-based pricing for our API product?"
\`\`\`
`
    },

    'w-context-switch': {
      name: 'w-context-switch',
      description: 'Save/load context state for switching between workstreams',
      content: `# /w-context-switch

Save current context state or load a previously saved context. Enables clean switching between workstreams without losing track.

## Usage
\`\`\`
/w-context-switch save "pricing research"
/w-context-switch load "onboarding redesign"
/w-context-switch list
\`\`\`

---

## \u26a0\ufe0f MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Determine mode (save/load/list)
2. For save: capture current working state
3. For load: restore saved state
4. Confirm transition

\u26a0\ufe0f VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- When saving: capture current focus, active items, open threads, recent entities
- When loading: restore focus context and remind of state
- Saved contexts persist until explicitly deleted
- Always show what changed on load

---

## Execution Protocol

### \u26d4 CHECKPOINT 1: Mode Selection
**REQUIRED OUTPUT:**
- Mode: save/load/list
- Current context name: _____ (if any)

**For SAVE mode:**

**AUTO-PROCEED:** Continue to capture.

**For LOAD mode:**

Available contexts:
| # | Name | Saved | Items | Focus |
|---|------|-------|-------|-------|
| _____ | _____ | _____ | _____ | _____ |

**USER GATE:** Use AskUserQuestion (load mode only)
- Question: "Load context '[name]'? Current context will be saved as '[current]'."
- Options: ["Load", "Save current first", "Cancel"]

STOP and wait for user response.

---

### \u26d4 CHECKPOINT 2: Execute Switch
**REQUIRED OUTPUT:**

**For SAVE:**
- Context saved: _____
- Captured: [N] active items, focus: [X], open threads: [Y]

**For LOAD:**
- Context loaded: _____
- Previous context saved: _____
- Restored: focus, active items, recent entities
- Summary of where you left off: _____

**AUTO-PROCEED:** Workflow complete.

---

## Completion Checklist

- [ ] TodoWrite used at start
- [ ] Mode determined
- [ ] Context saved/loaded/listed
- [ ] State transition confirmed

\u26a0\ufe0f Workflow INCOMPLETE until all boxes checked

## Example
\`\`\`
/w-context-switch save "Q3 planning"
/w-context-switch load "sprint 14 bugs"
\`\`\`
`
    },

    'w-meeting-prep': {
      name: 'w-meeting-prep',
      description: 'Generate talking points and brief for upcoming meetings',
      content: `# /w-meeting-prep

Generate a meeting preparation brief with talking points, context, and agenda items pulled from your workspace.

## Usage
\`\`\`
/w-meeting-prep "1:1 with Sarah" --topics api-migration,timeline
/w-meeting-prep "Sprint planning" --project 3
/w-meeting-prep "Board update"
\`\`\`

---

## \u26a0\ufe0f MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Parse meeting details (attendees, topic, context)
2. Search workspace for relevant items (facts, insights, notes, follow-ups)
3. Generate talking points
4. Create agenda
5. Output brief

\u26a0\ufe0f VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- Pull relevant context from ALL entity types (facts, insights, ideas, notes, follow-ups, action items)
- Surface open follow-ups with attendees
- Include recent relevant facts and insights
- Keep talking points concise and actionable

---

## Execution Protocol

### \u26d4 CHECKPOINT 1: Parse & Gather Context
**REQUIRED OUTPUT:**
- Meeting: _____
- Attendees: _____
- Topics: _____
- Related items found:
  - Follow-ups with attendees: _____
  - Related facts: _____
  - Related insights: _____
  - Related action items: _____
  - Related notes: _____

**AUTO-PROCEED:** Continue to brief generation.

---

### \u26d4 CHECKPOINT 2: Generate Brief
**REQUIRED OUTPUT:**

\`\`\`markdown
# Meeting Brief: [Meeting Name]
**Date:** [date] | **Attendees:** [names]

## Context
[2-3 sentence context summary]

## Agenda
1. _____ (__ min)
2. _____ (__ min)
3. _____ (__ min)

## Talking Points
- _____
- _____
- _____

## Open Items with Attendees
| Person | Item | Status |
|--------|------|--------|

## Key Facts & Insights
- _____
- _____

## Questions to Ask
- _____
- _____
\`\`\`

**USER GATE:** Use AskUserQuestion
- Question: "Meeting brief ready. Review?"
- Options: ["Looks good", "Add talking point", "Edit agenda", "Add context"]

STOP and wait for user response.

---

### \u26d4 CHECKPOINT 3: Finalize
**REQUIRED OUTPUT:**
- Brief saved: ID ___
- Follow-up reminders set: _____
- Post-meeting template ready: /w-notes after meeting

**AUTO-PROCEED:** Workflow complete.

---

## Completion Checklist

- [ ] TodoWrite used at start
- [ ] Meeting details parsed
- [ ] Workspace searched for relevant items
- [ ] Talking points generated
- [ ] Agenda created
- [ ] Brief output and reviewed
- [ ] Post-meeting reminder set

\u26a0\ufe0f Workflow INCOMPLETE until all boxes checked

## Example
\`\`\`
/w-meeting-prep "Product sync with engineering" --topics sprint-velocity,api-deadline
\`\`\`
`
    },

    'w-doc-review': {
      name: 'w-doc-review',
      description: 'Adversarial 2-agent review (Clarity vs Brevity)',
      content: `# /w-doc-review

Adversarial 2-agent document review. Agent Clarity argues for comprehensiveness. Agent Brevity argues for conciseness. You get the best of both.

## Usage
\`\`\`
/w-doc-review [paste document or file path]
/w-doc-review --file docs/prd.md
\`\`\`

---

## \u26a0\ufe0f MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Load document
2. Agent Clarity pass (comprehensiveness review)
3. Agent Brevity pass (conciseness review)
4. Synthesize recommendations
5. Present actionable edits

\u26a0\ufe0f VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- Both agents review independently
- Conflicts between agents are explicitly surfaced for user decision
- Output is a prioritized list of edits, not a rewrite
- Preserve author's voice

---

## Execution Protocol

### \u26d4 CHECKPOINT 1: Load Document
**REQUIRED OUTPUT:**
- Document: _____
- Word count: _____
- Sections: _____

**AUTO-PROCEED:** Continue to Clarity pass.

---

### \u26d4 CHECKPOINT 2: Agent Clarity Pass
**REQUIRED OUTPUT:**
- \ud83d\udd0d **Agent Clarity** findings:
| # | Location | Issue | Suggestion | Severity |
|---|----------|-------|------------|----------|
| 1 | _____ | Missing context | _____ | high/med/low |
| 2 | _____ | Ambiguous | _____ | high/med/low |
| 3 | _____ | Needs example | _____ | high/med/low |

- Summary: [N] clarity issues found

**AUTO-PROCEED:** Continue to Brevity pass.

---

### \u26d4 CHECKPOINT 3: Agent Brevity Pass
**REQUIRED OUTPUT:**
- \u2702\ufe0f **Agent Brevity** findings:
| # | Location | Issue | Suggestion | Words Saved |
|---|----------|-------|------------|-------------|
| 1 | _____ | Redundant | _____ | _____ |
| 2 | _____ | Verbose | _____ | _____ |
| 3 | _____ | Unnecessary | _____ | _____ |

- Summary: [N] brevity issues, [M] words saveable

**AUTO-PROCEED:** Continue to synthesis.

---

### \u26d4 CHECKPOINT 4: Synthesis
**REQUIRED OUTPUT:**
- Conflicts (Clarity wants more, Brevity wants less):
| # | Location | Clarity Says | Brevity Says | Recommendation |
|---|----------|-------------|-------------|----------------|

- Non-conflicting edits: _____
- Estimated final word count: _____

**USER GATE:** Use AskUserQuestion
- Question: "Review complete. [N] edits suggested, [M] conflicts to resolve. Apply?"
- Options: ["Apply all non-conflicting", "Resolve conflicts", "Show full report", "Discard"]

STOP and wait for user response.

---

### \u26d4 CHECKPOINT 5: Apply Edits
**REQUIRED OUTPUT:**
- Edits applied: _____
- Conflicts resolved: _____
- Word count change: _____ -> _____
- Document updated: yes/no

**AUTO-PROCEED:** Workflow complete.

---

## Completion Checklist

- [ ] TodoWrite used at start
- [ ] Document loaded
- [ ] Clarity pass completed
- [ ] Brevity pass completed
- [ ] Conflicts identified
- [ ] Edits synthesized
- [ ] User-approved changes applied

\u26a0\ufe0f Workflow INCOMPLETE until all boxes checked

## Example
\`\`\`
/w-doc-review --file docs/product-brief.md
\`\`\`
`
    },

    'w-ui-references': {
      name: 'w-ui-references',
      description: 'Search and collect UI reference images',
      content: `# /w-ui-references

Search and collect UI reference images for design inspiration and competitive analysis.

## Usage
\`\`\`
/w-ui-references "onboarding flows for SaaS"
/w-ui-references "pricing page layouts" --sources dribbble,competitors
/w-ui-references "dark mode dashboard" --count 10
\`\`\`

---

## \u26a0\ufe0f MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Define search criteria and sources
2. Search and collect reference images
3. Organize by theme/pattern
4. Tag and annotate
5. Save collection

\u26a0\ufe0f VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- ALWAYS track source URL for each reference
- Organize by visual pattern, not just source
- Tag with design attributes (layout, color scheme, interaction pattern)
- Save collections for team sharing

---

## Execution Protocol

### \u26d4 CHECKPOINT 1: Define Search
**REQUIRED OUTPUT:**
- Search query: _____
- Sources to check: _____
- Count target: _____
- Design attributes to focus on: _____

**AUTO-PROCEED:** Continue to collection.

---

### \u26d4 CHECKPOINT 2: Collect References
**REQUIRED OUTPUT:**
- References found:
| # | Source | URL | Theme | Notes |
|---|--------|-----|-------|-------|
| 1 | _____ | _____ | _____ | _____ |
| 2 | _____ | _____ | _____ | _____ |

- Themes identified: _____
- Patterns observed: _____

**USER GATE:** Use AskUserQuestion
- Question: "Collected [N] references across [M] themes. Save collection?"
- Options: ["Save all", "Filter by theme", "Search more", "Review individually"]

STOP and wait for user response.

---

### \u26d4 CHECKPOINT 3: Save Collection
**REQUIRED OUTPUT:**
- Collection saved: ID ___
- References: _____ (count)
- Themes: _____
- Review: /w-ui-references-review ___

**AUTO-PROCEED:** Workflow complete.

---

## Completion Checklist

- [ ] TodoWrite used at start
- [ ] Search criteria defined
- [ ] References collected with source tracking
- [ ] Organized by theme
- [ ] Collection saved

\u26a0\ufe0f Workflow INCOMPLETE until all boxes checked

## Example
\`\`\`
/w-ui-references "mobile checkout flows" --count 15
\`\`\`
`
    },

    'w-ui-references-review': {
      name: 'w-ui-references-review',
      description: 'Score and curate reference image collections',
      content: `# /w-ui-references-review

Score and curate a UI reference collection. Rate individual references, identify top picks, and export curated set.

## Usage
\`\`\`
/w-ui-references-review 3
/w-ui-references-review 3 --quick-score
\`\`\`

---

## \u26a0\ufe0f MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Load reference collection
2. Score each reference (relevance, quality, inspiration)
3. Rank and identify top picks
4. Curate final set
5. Export curated collection

\u26a0\ufe0f VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- Score on 3 dimensions: Relevance (1-5), Quality (1-5), Inspiration (1-5)
- Quick-score mode: single 1-5 rating per item
- Always identify top 3 picks
- Export as shareable collection

---

## Execution Protocol

### \u26d4 CHECKPOINT 1: Load Collection
**REQUIRED OUTPUT:**
- Collection ID: ___
- References: _____ (count)
- Themes: _____

**AUTO-PROCEED:** Continue to scoring.

---

### \u26d4 CHECKPOINT 2: Score References
**REQUIRED OUTPUT:**
| # | Reference | Relevance | Quality | Inspiration | Total |
|---|-----------|-----------|---------|-------------|-------|
| 1 | _____ | _/5 | _/5 | _/5 | _/15 |
| 2 | _____ | _/5 | _/5 | _/5 | _/15 |

- Top 3 picks: _____
- Average score: _____

**USER GATE:** Use AskUserQuestion
- Question: "Scored [N] references. Top 3: [picks]. Curate final set?"
- Options: ["Use top 3", "Use top 5", "Custom selection", "Re-score"]

STOP and wait for user response.

---

### \u26d4 CHECKPOINT 3: Export Curated
**REQUIRED OUTPUT:**
- Curated set: _____ references
- Exported as: _____
- Share: /w-share [collection-id]

**AUTO-PROCEED:** Workflow complete.

---

## Completion Checklist

- [ ] TodoWrite used at start
- [ ] Collection loaded
- [ ] References scored
- [ ] Top picks identified
- [ ] Final set curated
- [ ] Collection exported

\u26a0\ufe0f Workflow INCOMPLETE until all boxes checked

## Example
\`\`\`
/w-ui-references-review 3
\`\`\`
`
    },

    'w-systems-design': {
      name: 'w-systems-design',
      description: 'Generate N design options for systems',
      content: `# /w-systems-design

Generate N alternative design options for a system, feature, or architecture decision. Compare trade-offs systematically.

## Usage
\`\`\`
/w-systems-design "notification system" --options 3
/w-systems-design "auth architecture" --options 4 --constraints "must support SSO"
\`\`\`

---

## \u26a0\ufe0f MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Define system scope and constraints
2. Generate N design options
3. Evaluate trade-offs per option
4. Compare options side-by-side
5. Recommend with rationale
6. Save design artifact

\u26a0\ufe0f VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- ALWAYS generate at least 2 options (default 3)
- Each option must be genuinely different, not trivial variations
- Evaluate on: complexity, scalability, cost, time-to-build, maintainability
- Explicitly state trade-offs, not just pros

---

## Execution Protocol

### \u26d4 CHECKPOINT 1: Define Scope
**REQUIRED OUTPUT:**
- System: _____
- Constraints: _____
- Options to generate: _____
- Evaluation criteria: _____

**USER GATE:** Use AskUserQuestion
- Question: "Designing [system] with [N] options. Constraints: [X]. Proceed?"
- Options: ["Proceed", "Add constraint", "Change option count"]

STOP and wait for user response.

---

### \u26d4 CHECKPOINT 2: Generate Options
**REQUIRED OUTPUT:**

**Option 1: [Name]**
- Approach: _____
- Architecture: _____
- Key trade-off: _____

**Option 2: [Name]**
- Approach: _____
- Architecture: _____
- Key trade-off: _____

**Option 3: [Name]**
- Approach: _____
- Architecture: _____
- Key trade-off: _____

**AUTO-PROCEED:** Continue to evaluation.

---

### \u26d4 CHECKPOINT 3: Trade-off Matrix
**REQUIRED OUTPUT:**

| Criteria | Option 1 | Option 2 | Option 3 |
|----------|----------|----------|----------|
| Complexity | ___ | ___ | ___ |
| Scalability | ___ | ___ | ___ |
| Cost | ___ | ___ | ___ |
| Time-to-build | ___ | ___ | ___ |
| Maintainability | ___ | ___ | ___ |
| **Total Score** | ___ | ___ | ___ |

- Recommendation: Option ___ because _____
- Runner-up: Option ___ for _____

**USER GATE:** Use AskUserQuestion
- Question: "Recommendation: [Option N]. Trade-off matrix ready. Accept?"
- Options: ["Accept recommendation", "Choose different option", "Explore hybrid", "Generate more options"]

STOP and wait for user response.

---

### \u26d4 CHECKPOINT 4: Save Design
**REQUIRED OUTPUT:**
- Design saved: ID ___
- Selected option: _____
- Related facts created: _____
- Decision recorded: _____

**AUTO-PROCEED:** Workflow complete.

---

## Completion Checklist

- [ ] TodoWrite used at start
- [ ] Scope and constraints defined
- [ ] N options generated (genuinely different)
- [ ] Trade-off matrix completed
- [ ] Recommendation provided
- [ ] User selected option
- [ ] Design artifact saved

\u26a0\ufe0f Workflow INCOMPLETE until all boxes checked

## Example
\`\`\`
/w-systems-design "real-time collaboration backend" --options 3 --constraints "must work offline"
\`\`\`
`
    },

    'w-share': {
      name: 'w-share',
      description: 'Create secure share links for workspace items',
      content: `# /w-share

Create a secure, expiring share link for any workspace item (idea, research, brief, collection).

## Usage
\`\`\`
/w-share idea 7
/w-share research 3 --expires 7d
/w-share collection 5 --access team
\`\`\`

---

## \u26a0\ufe0f MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Identify item to share
2. Generate shareable content
3. Set access controls and expiry
4. Create share link
5. Confirm creation

\u26a0\ufe0f VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- Default expiry: 7 days
- Access levels: public, team, specific-people
- Share links include rendered markdown content
- Track who created and when

---

## Execution Protocol

### \u26d4 CHECKPOINT 1: Prepare Share
**REQUIRED OUTPUT:**
- Item type: _____
- Item ID: ___
- Content preview: _____ (first 100 chars)
- Expiry: _____
- Access: _____

**USER GATE:** Use AskUserQuestion
- Question: "Share [type] #[ID] with [access] access, expires [date]. Confirm?"
- Options: ["Create link", "Change expiry", "Change access", "Preview content"]

STOP and wait for user response.

---

### \u26d4 CHECKPOINT 2: Create Link
**REQUIRED OUTPUT:**
- Share link created: _____
- Expires: _____
- Access: _____
- Manage: /w-share-list

**AUTO-PROCEED:** Workflow complete.

---

## Completion Checklist

- [ ] TodoWrite used at start
- [ ] Item identified
- [ ] Content prepared
- [ ] Access and expiry set
- [ ] Share link created

\u26a0\ufe0f Workflow INCOMPLETE until all boxes checked

## Example
\`\`\`
/w-share idea 7 --expires 14d --access team
\`\`\`
`
    },

    'w-share-list': {
      name: 'w-share-list',
      description: 'List active share links',
      content: `# /w-share-list

List all active (non-expired, non-revoked) share links.

## Usage
\`\`\`
/w-share-list
/w-share-list --include-expired
\`\`\`

---

## \u26a0\ufe0f MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Load all share links
2. Filter active/expired
3. Display with status

\u26a0\ufe0f VIOLATION: Any action before TodoWrite = restart workflow

---

## Execution Protocol

### \u26d4 CHECKPOINT 1: List Shares
**REQUIRED OUTPUT:**

**Active Shares:**
| # | Item | Type | Created | Expires | Access | Link |
|---|------|------|---------|---------|--------|------|
| 1 | _____ | _____ | _____ | _____ | _____ | _____ |

**Expired/Revoked:** (if --include-expired)
| # | Item | Type | Status | Reason |
|---|------|------|--------|--------|

- Total active: _____
- Expiring soon (< 2 days): _____

**USER GATE:** Use AskUserQuestion
- Question: "Found [N] active shares. [M] expiring soon. Actions?"
- Options: ["Done", "Revoke a share", "Extend expiry", "Create new share"]

STOP and wait for user response.

---

## Completion Checklist

- [ ] TodoWrite used at start
- [ ] Shares loaded
- [ ] Active shares displayed
- [ ] Expiring-soon items highlighted

\u26a0\ufe0f Workflow INCOMPLETE until all boxes checked

## Example
\`\`\`
/w-share-list
\`\`\`
`
    },

    'w-share-revoke': {
      name: 'w-share-revoke',
      description: 'Revoke an active share link',
      content: `# /w-share-revoke

Revoke an active share link immediately. The link will stop working.

## Usage
\`\`\`
/w-share-revoke 3
/w-share-revoke --all
\`\`\`

---

## \u26a0\ufe0f MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Load active share links
2. Select link(s) to revoke
3. Confirm revocation
4. Revoke and verify

\u26a0\ufe0f VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- Revocation is immediate and permanent
- --all requires explicit confirmation
- Always show what was revoked

---

## Execution Protocol

### \u26d4 CHECKPOINT 1: Select & Confirm
**REQUIRED OUTPUT:**
- Active shares:
| # | Item | Type | Created | Expires | Access |
|---|------|------|---------|---------|--------|
| _____ | _____ | _____ | _____ | _____ | _____ |

- Selected for revocation: _____

**USER GATE:** Use AskUserQuestion
- Question: "Revoke share [ID] for [item]? This is immediate and permanent."
- Options: ["Revoke", "Cancel", "Choose different"]

STOP and wait for user response.

---

### \u26d4 CHECKPOINT 2: Revoke
**REQUIRED OUTPUT:**
- Revoked: share #___
- Item: _____
- Remaining active shares: _____

**AUTO-PROCEED:** Workflow complete.

---

## Completion Checklist

- [ ] TodoWrite used at start
- [ ] Active shares listed
- [ ] User confirmed revocation
- [ ] Share revoked
- [ ] Remaining shares shown

\u26a0\ufe0f Workflow INCOMPLETE until all boxes checked

## Example
\`\`\`
/w-share-revoke 3
\`\`\`
`
    }
  };
}

/**
 * Get plugin namespace
 */
export function getNamespace() {
  return 'pm-shortcuts';
}

// PM-enhanced w-start (replaces coding version when PM mode is active)
const PM_W_START = `# /w-start

Session Manager with strategic context loading and session history.

## Usage
\`\`\`
/w-start [plan-file]
\`\`\`

Default: MASTER_PLAN.md

---

## ⚠️ MANDATORY EXECUTION

This command MUST complete all context loading steps. NEVER skip memory search or strategic context.

---

## Execution Protocol

### ⛔ CHECKPOINT 0: Context Loaded
**REQUIRED OUTPUT:**
- Plan file loaded: _____
- Memories found: _____ patterns
- Compound docs: _____ files
- Git status: branch _____, _____ uncommitted changes
- Recent commits: _____

**AUTO-PROCEED:** Continue to Strategic Context.

---

### ⛔ CHECKPOINT 0.5: Strategic Context
**Load strategic hierarchy from database:**
- Active goals with linked initiatives
- Active initiatives with linked projects
- Item counts per project (action items, follow-ups, facts, insights)

Display as: Goals → Initiatives → Projects tree

**AUTO-PROCEED:** Continue to Session Load.

---

### ⛔ CHECKPOINT 1: Session Load
**Load from database:**
- Last session summary + next steps
- Pending deferred items from previous /w-end
- Due/overdue follow-ups

**USER GATE:** Use AskUserQuestion
- Question: "Session initialized with strategic context. What would you like to work on?"
- Options: ["Run /w-cos standup", "Continue last session", "Start new task", "Review context"]

STOP and wait for user response.

---

## Memory Sources
- **Claude-Flow**: project/features/*, project/bugs/*, project/implementations/*, etc.
- **Compound Engineering**: docs/solutions/ markdown files
- **Git**: Recent commits and current branch state
- **Database**: sessions, goals, initiatives, projects, deferred_items

## Completion Checklist

- [ ] Plan file read (or default used)
- [ ] Memory search completed
- [ ] Compound docs scanned
- [ ] Git status checked
- [ ] Strategic hierarchy loaded (goal → initiative → project)
- [ ] Last session loaded
- [ ] Context summary presented

⚠️ Session NOT ready until all steps complete

## Example
\`\`\`
/w-start
/w-start ROADMAP.md
/w-start docs/SPRINT_PLAN.md
\`\`\`
`;

// PM-enhanced w-end (replaces coding version when PM mode is active)
const PM_W_END = `# /w-end

Zero-gate auto-proceed session close with strategic framing and deferred items.

## Usage
\`\`\`
/w-end
/w-end [category]
\`\`\`

Categories: feature, bug, security, performance, architecture, debug

---

## ⚠️ MANDATORY EXECUTION

This command MUST complete ALL checkpoints. Zero user gates — fully automatic.

---

## Execution Protocol

### ⛔ CHECKPOINT 0: Auto-Generate Strategic Summary
**Query goals/initiatives/projects hierarchy from database.**
Frame session progress against strategic context.

**REQUIRED OUTPUT:**
- Work accomplished: _____
- Files modified: _____
- Tests added/changed: _____
- Key decisions: _____
- Strategic context: goal → initiative → project mapping

**AUTO-PROCEED:** Continue to Deferred Items.

---

### ⛔ CHECKPOINT 1: Detect Next Steps → Store as Deferred Items
Auto-detect next steps from session context. Store each as a deferred item:
\`\`\`
createDeferredItem({
  type: 'next_step',
  content: '...',
  context: { session_summary, files_touched, goal, initiative, project },
  source_workflow: 'w-end'
})
\`\`\`

These will be surfaced at the next /w-cos standup for human decision.

**AUTO-PROCEED:** Continue to Session Record.

---

### ⛔ CHECKPOINT 2: Save Session Record
Save to sessions table:
- context_id, summary, files_touched (JSON), next_steps (JSON), ended_at

**AUTO-PROCEED:** Continue to Compound.

---

### ⛔ CHECKPOINT 3: Compound (auto-detect category)
Auto-detect category from git diff using weighted pattern matching.
Run full compound: memory key + solution doc + diagnostics + fixes.

**AUTO-PROCEED:** Continue to Commit.

---

### ⛔ CHECKPOINT 4: Git Commit
**REQUIRED OUTPUT:**
- Commit message: _____
- Files staged: _____
- Commit hash: _____

**AUTO-PROCEED:** Session complete.

---

## What Gets Captured
- Problems solved and approaches used
- Key decisions made
- Patterns discovered
- Strategic context (goal/initiative/project)
- Next steps as deferred items for /w-cos surfacing

## Completion Checklist

- [ ] Strategic summary generated
- [ ] Deferred items created for next steps
- [ ] Session record saved to database
- [ ] Compound phase completed
- [ ] Memory key stored: _____
- [ ] Solution doc created: _____
- [ ] Changes committed
- [ ] Ralph candidate check completed

⚠️ Session NOT properly ended until all steps complete. NEVER skip session record or compound.

## Example
\`\`\`
/w-end
/w-end feature
/w-end bug
\`\`\`

## Next Session
Run \\\`/w-start\\\` to load this session's context and continue where you left off.
Deferred items will appear at next \\\`/w-cos\\\` standup.
`;

/**
 * Install PM shortcuts plugin
 */
export async function install(claudeDir, options = {}) {
  const commandsDir = path.join(claudeDir, 'commands', '.shortcuts');

  // Ensure directory exists (shared with coding shortcuts)
  await fs.mkdir(commandsDir, { recursive: true });

  // Write command files
  const commands = getCommands();
  for (const [name, command] of Object.entries(commands)) {
    const filePath = path.join(commandsDir, `${name}.md`);

    if (!options.dryRun) {
      await fs.writeFile(filePath, command.content, 'utf-8');
    }
  }

  // Overwrite w-start and w-end with PM-enhanced versions
  if (!options.dryRun) {
    await fs.writeFile(path.join(commandsDir, 'w-start.md'), PM_W_START, 'utf-8');
    await fs.writeFile(path.join(commandsDir, 'w-end.md'), PM_W_END, 'utf-8');
  }

  return {
    plugin: 'pm-shortcuts',
    namespace: getNamespace(),
    commands: [...Object.keys(commands), 'w-start', 'w-end']
  };
}

/**
 * Uninstall PM shortcuts plugin
 */
export async function uninstall(claudeDir) {
  const commandsDir = path.join(claudeDir, 'commands', '.shortcuts');
  const commands = getCommands();

  // Remove only PM command files (don't nuke the shared directory)
  for (const name of Object.keys(commands)) {
    try {
      await fs.unlink(path.join(commandsDir, `${name}.md`));
    } catch {
      // File doesn't exist
    }
  }
}

/**
 * Check if PM shortcuts are installed
 */
export async function isInstalled(claudeDir) {
  const commandsDir = path.join(claudeDir, 'commands', '.shortcuts');

  try {
    // Check for a representative PM command
    await fs.access(path.join(commandsDir, 'w-action.md'));
    return true;
  } catch {
    return false;
  }
}

export default {
  getCommands,
  getNamespace,
  install,
  uninstall,
  isInstalled
};

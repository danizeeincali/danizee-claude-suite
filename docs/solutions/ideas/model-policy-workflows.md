# Model Policy & Dynamic Workflows — Suite User Guide

## What is the Model Policy?

The `/w-plan-tdd-swarm` and `/w-background-compound` commands include a **per-step model policy**
that routes each subagent spawn to the cheapest model that can do the job reliably, while keeping
the main planning/judgment loop on the session model (which you control).

## The Routing Table

| Work | Recommended Model | Rationale |
|------|-------------------|-----------|
| Read-only search/sweep fan-outs (Explore) | `haiku` | Mechanical discovery — Explore's native default tier |
| Medium-judgment searches, doc and compound writing | `sonnet` | Near-frontier quality at ~30% of the premium tier cost |
| Well-scoped builds (file:line targets + failing-test spec exist) | `sonnet` | SWE-bench Verified: Sonnet 4.6 scores 79.6% vs Opus 4.6 80.8% on scoped agentic coding — near-parity; TDD harness makes failures detectable cheaply |
| Hard builds (root-cause unknown, cross-cutting, migrations, security-sensitive) | `opus` | Subtle multi-file reasoning is where the tier gap shows |
| Adversarial review / verification subagents | `opus` | The quality backstop that lets builders run cheap |
| Frontier-difficulty retry of a failed opus attempt | your session model | Last rung only — only after opus fails |

**Approximate pricing tiers (relative, not exact):** haiku : sonnet : opus : premium ≈ 1 : 3 : 5 : 10

## The Escalation Ladder

On a **detectable failure** (tests still red, regressions introduced, agent stuck or died):

```
sonnet → opus → your session model
```

- Escalate ONE tier per retry
- Never retry the same tier twice
- Never start a well-scoped build above sonnet "just in case"
- TDD is the prerequisite: cheap-first only works when failure is detectable

## Why the Main Loop Stays on the Session Model

Interview, plan, root-cause judgment, final verification verdict, and synthesis are
**judgment-bearing steps** — weak planning compounds into bad implementations. These stay on
whatever model you started the session with. The skill cannot and should not change it. Token
optimization only happens at explicit subagent spawns.

## Property-Based Testing (fast-check)

When you have a pure-ish function with an invariant that holds for ALL inputs, add a property test
instead of (or alongside) hand-picked examples:

```js
import fc from 'fast-check';
fc.assert(fc.property(fc.string(), s => decode(encode(s)) === s));
```

**When to reach for it:**
- Round-trip (decode∘encode = id)
- Idempotence (f(f(x)) = f(x))
- "Never happens" security claims (gate is default-deny, answer never leaks)
- Permutation/conservation invariants
- Commutativity

Fast-check generates hundreds of inputs automatically and **shrinks** any failure to the minimal
counterexample. A flaky property = a real bug or a bad invariant — fix the code, don't loosen the
property. Use `fast-check` for JS/TS; `hypothesis` for Python.

## Dynamic Workflows

Dynamic Workflows are a power-tool for three failure modes:

| Failure Mode | Pattern |
|---|---|
| Agentic laziness (stops at partial progress) | Fan-out (one agent per item) |
| Self-preferential bias (Claude reviews its own work) | Adversarial verification (separate verifier) |
| Goal drift (constraints vanish over many turns) | Fan-out + isolated state |

**Default: OFF.** Always pass `opts.model` on every `agent()` call — omitting it silently inherits
the premium session model and 3× the workflow cost. See `/w-plan-tdd-swarm` for the full HIL gate
and six composable patterns.

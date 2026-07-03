# Model Policy & Dynamic Workflows — Suite User Guide

## What is the Model Policy?

Every `w-` workflow includes a **per-step model policy** (v4.3.0, suite-wide): **fable**
(claude-fable-5) wherever thinking is required, **sonnet** (Sonnet 5) for all execution, and an
inline **opus fallback** (claude-opus-4-8) for every fable routing — covering the case where
fable access is removed or usage runs out. The main planning/judgment loop stays on the session
model (which you control).

## The Routing Table

| Work | Recommended Model | Rationale |
|------|-------------------|-----------|
| Read-only search/sweep fan-outs (Explore) | `sonnet` (Sonnet 5) | Execution tier — all non-thinking work runs Sonnet 5 |
| Medium-judgment searches, doc and compound writing | `sonnet` (Sonnet 5) | Near-frontier quality at a fraction of the premium tier cost |
| Well-scoped builds (file:line targets + failing-test spec exist) | `sonnet` (Sonnet 5) | Scoped agentic coding is execution; the TDD harness makes failures detectable cheaply |
| Hard builds (root-cause unknown, cross-cutting, migrations, security-sensitive) | `fable` (claude-fable-5) | Thinking-required work runs the frontier tier |
| Adversarial review / verification subagents | `fable` (claude-fable-5) | The quality backstop that lets builders run cheap |
| Planning/architecture subagents, final judgment | `fable` (claude-fable-5) | Thinking-required work runs the frontier tier |

**Opus fallback (every fable routing):** if fable is unavailable — access removed, usage
exhausted, or the model errors as not found — fall back to `opus` (claude-opus-4-8) for that
step. Never silently skip the step because fable is missing.

## The Escalation Ladder

On a **detectable failure** (tests still red, regressions introduced, agent stuck or died):

```
sonnet → fable   (substitute opus when fable is unavailable)
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

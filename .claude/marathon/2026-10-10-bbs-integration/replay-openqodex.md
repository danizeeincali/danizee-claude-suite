# Replay: OpenQodex powers on main 8ad06e1

Owner's workflows (/pt, /bc, /bcp, /w-marathon, /bbs, resolved to installed commands). The old callers measure passed every power; the wired measure:
```json
{
 "workflows": [
  "w-plan-tdd-swarm",
  "w-background-compound",
  "w-marathon",
  "w-bbs"
 ],
 "powers": {
  "pre-push-review-gate": {
   "verb": "push-gate",
   "wired": [],
   "not": 4
  },
  "secret-redaction-by-value-and-fingerprint": {
   "verb": "redact",
   "wired": [],
   "not": 4
  },
  "lens-catalog-file-triggered-checks": {
   "verb": "lenses",
   "wired": [],
   "not": 4
  },
  "hardened-git-read-on-untrusted-repo": {
   "verb": "safe-git",
   "wired": [],
   "not": 4
  },
  "identity-checked-file-writes": {
   "verb": "guarded-write",
   "wired": [],
   "not": 4
  },
  "change-blast-radius-walk": {
   "verb": "impact",
   "wired": [],
   "not": 4
  },
  "caller-floor-disclosure": {
   "verb": "callers",
   "wired": [],
   "not": 4
  },
  "fact-cached-graph-build-with-budget": {
   "verb": "graph",
   "wired": [],
   "not": 4
  },
  "tracked-file-scrub-gate": {
   "verb": "scrub",
   "wired": [],
   "not": 4
  },
  "planted-bug-review-scoring": {
   "verb": "review-score",
   "wired": [
    "w-marathon"
   ],
   "not": 3
  },
  "isolated-tool-free-wording-judge": {
   "verb": "wording-judge",
   "wired": [],
   "not": 4
  }
 }
}
```

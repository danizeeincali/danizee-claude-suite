# /w-search

Search Solutions - Searches memory and solution docs for relevant past work.

## Usage
```
/w-search [query]
```

## What Happens
1. Searches memory namespaces for matching patterns
2. Scans docs/solutions/ for relevant documentation
3. Returns ranked matches with dates

## Memory Namespaces Searched
- `project/features/*`
- `project/bugs/*`
- `project/security/*`
- `project/performance/*`
- `project/architecture/*`
- `project/reviews/*`
- `project/incidents/*`

## Example
```
/w-search authentication issues
# Returns:
#   - project/bugs/auth-logout-reset (Dec 2024)
#   - project/features/oauth2-google (Nov 2024)
#   - project/security/auth-module (Oct 2024)
```

# Plan Workflow

Transform a feature idea into a detailed implementation plan.

## Usage
```
/compound-engineering:workflows:plan [feature description]
```

## What It Does
1. **Search** - Checks memory for similar past implementations
2. **Analyze** - Reviews codebase for relevant patterns
3. **Design** - Creates implementation approach
4. **Checkpoint** - Pauses for your review

## Output
- Implementation steps
- Files to modify/create
- Dependencies identified
- Potential risks

## Example
```
/compound-engineering:workflows:plan OAuth2 authentication with Google
```

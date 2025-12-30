# Work Workflow

Execute implementation plans in isolated git worktrees.

## Usage
```
/compound-engineering:workflows:work [plan reference]
```

## What It Does
1. Creates isolated worktree branch
2. Implements changes based on plan
3. Runs tests continuously
4. Checkpoints at key milestones

## Features
- Isolated from main branch
- Automatic test running
- Progress tracking via todos
- Easy rollback if needed

## Example
```
git worktree add ../feature-oauth feature/oauth2-google
/compound-engineering:workflows:work
```

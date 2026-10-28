# Layout Workflow

Generate page layouts and grid systems.

## Usage
```
/frontend-design:layout [layout type]
```

## Layout Types
- **dashboard** - Admin dashboard with sidebar
- **marketing** - Landing page layout
- **form** - Form-centric layout
- **grid** - Custom grid system
- **responsive** - Mobile-first responsive layout
- **landing** - Landing page in the fixed numbered section order: run `node .claude/helpers/kit/cli.js landing-sections plan` and lay out its sections in that order (if `.claude/helpers/kit/cli.js` is missing, say so in one line and use the marketing layout; advisory, exit 1 is wrong input)

## What It Creates
- Layout structure
- Grid definitions
- Responsive breakpoints
- Container styles

## Example
```
/frontend-design:layout dashboard with sidebar and top navigation
```

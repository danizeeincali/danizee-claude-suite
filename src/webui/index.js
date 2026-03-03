/**
 * danizee-claude-suite / WebUI — λVI Throbber components
 *
 * Reusable React components that show a cycling λ/A → V/v → I/! animation
 * to indicate that Avi is working.
 *
 * Core component:
 *   LambdaViThrobber  — the raw animated character display
 *
 * Integration wrappers:
 *   MessageThrobber   — inline indicator for message-sending UI
 *   FeedThrobber      — compact indicator for feed posts/comments
 *   DmHeaderThrobber  — header bar indicator for the main DM view
 *
 * Hook:
 *   useAviWorking     — state management for working/idle transitions
 */

export { default as LambdaViThrobber } from './components/LambdaViThrobber.jsx';
export { default as MessageThrobber }  from './components/MessageThrobber.jsx';
export { default as FeedThrobber }     from './components/FeedThrobber.jsx';
export { default as DmHeaderThrobber } from './components/DmHeaderThrobber.jsx';
export { default as useAviWorking }    from './components/useAviWorking.js';

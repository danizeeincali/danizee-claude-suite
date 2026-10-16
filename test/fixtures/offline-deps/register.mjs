// Offline stand-ins for commander, chalk and ora, used by the reach tests ONLY when the real package is not installed
// (a checkout without `npm ci`). When the real package resolves, it is used and these files are never loaded.
import { register } from 'node:module';
register('./hooks.mjs', import.meta.url);

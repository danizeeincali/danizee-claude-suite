/**
 * Claude Flow Plugin — Backward Compatibility Shim
 * Re-exports everything from ruflo.js (claude-flow was renamed to ruflo)
 */

export {
  getMcpConfig,
  getCommands,
  install,
  uninstall,
  isInstalled
} from './ruflo.js';

import ruflo from './ruflo.js';
export default ruflo;

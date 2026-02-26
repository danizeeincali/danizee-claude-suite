/**
 * Safe Git Operations
 * Uses execFileSync with argument arrays (never string interpolation).
 */

import { execFileSync } from 'child_process';

/**
 * Validate branch name — rejects anything not [a-zA-Z0-9._/-] and no '..'
 */
export function validateBranchName(name) {
  if (!name || name.length === 0) return false;
  if (name.includes('..')) return false;
  return /^[a-zA-Z0-9._\/-]+$/.test(name);
}

function gitExec(args, options = {}) {
  try {
    const output = execFileSync('git', args, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      ...options
    });
    return { success: true, output: output.trim() };
  } catch (err) {
    return { success: false, error: err.stderr?.trim() || err.message };
  }
}

export function getCurrentBranch() {
  const result = gitExec(['rev-parse', '--abbrev-ref', 'HEAD']);
  return result.success ? result.output : '';
}

export function branchExists(branchName) {
  const result = gitExec(['rev-parse', '--verify', branchName]);
  return result.success;
}

export function createAndCheckoutBranch(branchName, options = {}) {
  if (!validateBranchName(branchName)) return { success: false, error: 'Invalid branch name' };
  const args = ['checkout', '-b', branchName];
  if (options.startPoint) args.push(options.startPoint);
  return gitExec(args);
}

export function checkoutBranch(branchName) {
  if (!validateBranchName(branchName)) return { success: false, error: 'Invalid branch name' };
  return gitExec(['checkout', branchName]);
}

export function deleteBranch(branchName, force = false) {
  if (!validateBranchName(branchName)) return { success: false, error: 'Invalid branch name' };
  return gitExec(['branch', force ? '-D' : '-d', branchName]);
}

export function mergeBranch(branchName) {
  if (!validateBranchName(branchName)) return { success: false, error: 'Invalid branch name' };
  return gitExec(['merge', branchName]);
}

export function listBranches(pattern) {
  const result = gitExec(['branch', '--list', pattern]);
  if (!result.success) return [];
  return result.output.split('\n').map(b => b.replace(/^\*?\s+/, '').trim()).filter(Boolean);
}

export function createWorktree(worktreePath, branchName) {
  if (!validateBranchName(branchName)) return { success: false, error: 'Invalid branch name' };
  return gitExec(['worktree', 'add', worktreePath, '-b', branchName]);
}

export function removeWorktree(worktreePath, deleteBranchAfter, options = {}) {
  const args = ['worktree', 'remove'];
  if (options.force) args.push('--force');
  args.push(worktreePath);
  const result = gitExec(args);

  if (result.success && deleteBranchAfter) {
    deleteBranch(deleteBranchAfter, options.force);
  }
  return result;
}

export function getWorktreeUncommittedStatus(worktreePath) {
  const result = gitExec(['status', '--porcelain'], { cwd: worktreePath });
  return {
    hasChanges: result.success && result.output.length > 0,
    output: result.output || ''
  };
}

export function getWorktreeForBranch(branchName) {
  const result = gitExec(['worktree', 'list', '--porcelain']);
  if (!result.success) return null;
  const lines = result.output.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('branch refs/heads/' + branchName)) {
      // Find the worktree path in preceding lines
      for (let j = i - 1; j >= 0; j--) {
        if (lines[j].startsWith('worktree ')) return lines[j].slice(9);
      }
    }
  }
  return null;
}

export function validateMergeContentLoss(parentRef1, parentRef2, mergeRef, options = {}) {
  const threshold = options.threshold || 0.2;
  const warnings = [];

  const mergeFiles = gitExec(['diff', '--name-only', parentRef1, mergeRef]);
  if (!mergeFiles.success) return { warnings: [], hasContentLoss: false };

  for (const file of mergeFiles.output.split('\n').filter(Boolean)) {
    const p1Lines = gitExec(['show', `${parentRef1}:${file}`]);
    const p2Lines = gitExec(['show', `${parentRef2}:${file}`]);
    const mergeLines = gitExec(['show', `${mergeRef}:${file}`]);

    if (p1Lines.success && mergeLines.success) {
      const parentMax = Math.max(
        p1Lines.output.split('\n').length,
        p2Lines.success ? p2Lines.output.split('\n').length : 0
      );
      const mergeCount = mergeLines.output.split('\n').length;
      const loss = parentMax > 0 ? (parentMax - mergeCount) / parentMax : 0;

      if (loss > threshold) {
        warnings.push({
          filePath: file,
          parentMaxLines: parentMax,
          mergeResultLines: mergeCount,
          lossPercent: Math.round(loss * 100)
        });
      }
    }
  }

  return { warnings, hasContentLoss: warnings.length > 0 };
}

export function mergeBranchWithValidation(branchName) {
  const beforeMerge = gitExec(['rev-parse', 'HEAD']);
  const result = mergeBranch(branchName);

  if (!result.success) return { ...result, validation: null };

  const afterMerge = gitExec(['rev-parse', 'HEAD']);
  const validation = validateMergeContentLoss(
    beforeMerge.output, branchName, afterMerge.output
  );

  return { ...result, validation };
}

export function syncFromMain() {
  const main = getMainBranchName();
  return gitExec(['merge', main]);
}

export function getCommitsBehind(targetBranch) {
  const result = gitExec(['rev-list', '--count', `HEAD..${targetBranch}`]);
  return result.success ? parseInt(result.output, 10) : 0;
}

export function getMainBranchName() {
  if (branchExists('main')) return 'main';
  if (branchExists('master')) return 'master';
  return 'main';
}

export default {
  validateBranchName, getCurrentBranch, branchExists,
  createAndCheckoutBranch, checkoutBranch, deleteBranch,
  mergeBranch, listBranches, createWorktree, removeWorktree,
  getWorktreeUncommittedStatus, getWorktreeForBranch,
  validateMergeContentLoss, mergeBranchWithValidation,
  syncFromMain, getCommitsBehind, getMainBranchName
};

/**
 * Terminal Agents MCP Server for Danizee Claude Suite
 *
 * Self-contained MCP server (raw JSON-RPC 2.0 over stdio) that provides
 * terminal agent orchestration via tmux + git worktrees. Zero external deps.
 *
 * Tools:
 *   spawn_terminal_agent    — Start Claude Code in tmux with git worktree
 *   check_terminal_agents   — List running agents with status/PR info
 *   redirect_terminal_agent — Send instructions to running agent (+ instant ack heartbeat)
 *   stop_terminal_agent     — Kill agent's tmux session
 *   get_agent_report        — Read agent completion report
 *   send_agent_heartbeat    — Report progress at Fibonacci-filtered intervals
 *   get_agent_heartbeats    — Retrieve heartbeat history for an agent
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// --- Tool Definitions (shared between MCP server and tests) ---

export function getToolDefinitions() {
  return [
    {
      name: 'spawn_terminal_agent',
      description: `Spawn a Claude Code agent in a tmux session with an isolated git worktree.

WORKFLOW OPTIONS — pass a /w- command for structured execution:
• /w-tdd-swarm — Full TDD + parallel build
• /w-agent-tdd-swarm — Gateless TDD (designed for terminal agents)
• /w-fix — Quick bug fix
• /w-debug — Deep debug
• /w-hotfix — Critical production fix
• /w-review — Multi-agent code review
• /w-security — OWASP security audit
• /w-perf — Performance audit
• (none) — Direct task prompt

The agent commits changes and creates a PR when done.`,
      inputSchema: {
        type: 'object',
        properties: {
          repo_path: { type: 'string', description: 'Absolute path to the git repository' },
          task: { type: 'string', description: 'What the agent should build or fix' },
          workflow: { type: 'string', description: 'Optional /w- workflow command' },
          branch_name: { type: 'string', description: 'Optional custom branch name' },
          parent_agent_id: { type: 'string', description: 'Agent ID of the parent that spawned this agent (for completion notifications)' },
        },
        required: ['repo_path', 'task'],
      },
    },
    {
      name: 'check_terminal_agents',
      description: 'List all terminal agents with their current status, branch, and PR info.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'redirect_terminal_agent',
      description: 'Send a message to a running Claude Code agent to redirect its work via tmux send-keys.',
      inputSchema: {
        type: 'object',
        properties: {
          agent_id: { type: 'string', description: 'The agent ID to redirect' },
          message: { type: 'string', description: 'The message to send to the agent' },
        },
        required: ['agent_id', 'message'],
      },
    },
    {
      name: 'stop_terminal_agent',
      description: 'Stop a running Claude Code agent by killing its tmux session.',
      inputSchema: {
        type: 'object',
        properties: {
          agent_id: { type: 'string', description: 'The agent ID to stop' },
        },
        required: ['agent_id'],
      },
    },
    {
      name: 'get_agent_report',
      description: 'Read the completion report written by a terminal agent after it finishes. Returns the full markdown report.',
      inputSchema: {
        type: 'object',
        properties: {
          agent_id: { type: 'string', description: 'The agent ID to get the report for' },
        },
        required: ['agent_id'],
      },
    },
    {
      name: 'send_agent_heartbeat',
      description: `Report a progress heartbeat from a running agent. Heartbeats should be sent at Fibonacci-filtered intervals (1s, 2s, 4s, 7s, 12s, 20s, 33s, 54s, 88s from task start). Types:
• ack — Instant acknowledgment when task received ("..." indicator)
• progress — Periodic update at Fibonacci beats
• complete — Final result notification
• error — Error notification`,
      inputSchema: {
        type: 'object',
        properties: {
          agent_id: { type: 'string', description: 'The agent sending the heartbeat' },
          type: { type: 'string', enum: ['ack', 'progress', 'complete', 'error'], description: 'Heartbeat type' },
          message: { type: 'string', description: 'Human-readable status message' },
          beat_index: { type: 'number', description: 'Fibonacci beat index (0-8). -1 for ack.' },
          metadata: { type: 'object', description: 'Optional structured data (progress %, phase, etc.)' },
        },
        required: ['agent_id', 'type', 'message'],
      },
    },
    {
      name: 'get_agent_heartbeats',
      description: 'Retrieve heartbeat history for an agent. Returns all heartbeats (ack, progress, complete, error) in chronological order. Use since_timestamp to get only new heartbeats.',
      inputSchema: {
        type: 'object',
        properties: {
          agent_id: { type: 'string', description: 'The agent ID to get heartbeats for' },
          since_timestamp: { type: 'string', description: 'Optional ISO timestamp — only return heartbeats after this time' },
        },
        required: ['agent_id'],
      },
    },
  ];
}

// --- Agent Registry ---

function getRegistryPath() {
  return path.join(process.cwd(), '.claude', 'terminal-agents.json');
}

function loadRegistry(registryPath) {
  try {
    if (fs.existsSync(registryPath)) {
      return JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
    }
  } catch { /* corrupted, start fresh */ }
  return { agents: [] };
}

function saveRegistry(registryPath, registry) {
  const dir = path.dirname(registryPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${registryPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(registry, null, 2));
  fs.renameSync(tmp, registryPath);
}

// --- Path Validation & Mapping ---

const CONTAINER_PATH_PREFIXES = ['/workspace/', '/container/', '/app/'];

export function validateRepoPath(repoPath) {
  for (const prefix of CONTAINER_PATH_PREFIXES) {
    if (repoPath.startsWith(prefix)) {
      return {
        valid: false,
        reason: `Container path detected: "${repoPath}". Terminal agents run on the host — use the host filesystem path. Configure .claude/path-mappings.json to auto-translate container paths.`
      };
    }
  }
  return { valid: true };
}

export function loadPathMappings(claudeDir) {
  try {
    const mappingPath = path.join(claudeDir, 'path-mappings.json');
    if (fs.existsSync(mappingPath)) {
      return JSON.parse(fs.readFileSync(mappingPath, 'utf-8'));
    }
  } catch { /* missing or invalid */ }
  return {};
}

export function translatePaths(text, mappings) {
  let result = text;
  for (const [containerPath, hostPath] of Object.entries(mappings)) {
    result = result.replaceAll(containerPath, hostPath);
  }
  return result;
}

function resolveRepoPath(repoPath) {
  const claudeDir = path.join(process.cwd(), '.claude');
  const mappings = loadPathMappings(claudeDir);

  // Try path mapping first
  if (Object.keys(mappings).length > 0) {
    const translated = translatePaths(repoPath, mappings);
    if (translated !== repoPath) {
      return { resolved: translated, mappings };
    }
  }

  // No mapping matched — validate
  const validation = validateRepoPath(repoPath);
  if (!validation.valid) {
    return { error: validation.reason, mappings };
  }

  return { resolved: repoPath, mappings };
}

// --- Heartbeat Storage ---

const FIBONACCI_BEATS = [1, 2, 4, 7, 12, 20, 33, 54, 88];

function getHeartbeatsPath() {
  return path.join(process.cwd(), '.claude', 'agent-heartbeats.json');
}

function loadHeartbeats(heartbeatsPath) {
  try {
    if (fs.existsSync(heartbeatsPath)) {
      return JSON.parse(fs.readFileSync(heartbeatsPath, 'utf-8'));
    }
  } catch { /* corrupted, start fresh */ }
  return {};
}

function saveHeartbeats(heartbeatsPath, heartbeats) {
  const dir = path.dirname(heartbeatsPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${heartbeatsPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(heartbeats, null, 2));
  fs.renameSync(tmp, heartbeatsPath);
}

function recordHeartbeat(agentId, heartbeat) {
  const hbPath = getHeartbeatsPath();
  const store = loadHeartbeats(hbPath);
  if (!store[agentId]) store[agentId] = [];
  store[agentId].push(heartbeat);
  saveHeartbeats(hbPath, store);
}

function getAgentHeartbeats(agentId, sinceTimestamp) {
  const hbPath = getHeartbeatsPath();
  const store = loadHeartbeats(hbPath);
  let beats = store[agentId] || [];
  if (sinceTimestamp) {
    const since = new Date(sinceTimestamp).getTime();
    beats = beats.filter(b => new Date(b.timestamp).getTime() > since);
  }
  return beats;
}

// --- Agent Operations ---

function generateAgentId(task) {
  const slug = task.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30).replace(/-$/, '');
  const rand = Math.random().toString(36).slice(2, 6);
  return `agent-${slug}-${rand}`;
}

function generateBranchName(task) {
  const slug = task.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40).replace(/-$/, '');
  return `feat/${slug}`;
}

function getRepoSlug(repoPath) {
  try {
    const url = execSync('git remote get-url origin', { cwd: repoPath, encoding: 'utf-8', stdio: 'pipe' }).trim();
    const match = url.match(/github\.com[:/]([^/]+\/[^/.]+)/);
    return match ? match[1] : '';
  } catch { return ''; }
}

const MAX_CONCURRENT = 4;

function spawnAgent(args) {
  const registryPath = getRegistryPath();
  const registry = loadRegistry(registryPath);

  const running = registry.agents.filter(a => a.status === 'running');
  if (running.length >= MAX_CONCURRENT) {
    return { error: `Max ${MAX_CONCURRENT} concurrent agents. ${running.length} running.` };
  }

  let repoPath = args.repo_path.replace(/^~/, process.env.HOME || '~');

  // Path validation and translation
  const pathResult = resolveRepoPath(repoPath);
  if (pathResult.error) {
    return { error: pathResult.error };
  }
  repoPath = pathResult.resolved;
  const mappings = pathResult.mappings || {};

  const agentId = generateAgentId(args.task);
  const branch = args.branch_name || generateBranchName(args.task);

  const repoName = path.basename(repoPath);
  const worktreeBase = path.join(path.dirname(repoPath), `${repoName}-worktrees`);
  const worktreePath = path.join(worktreeBase, branch.replace(/\//g, '-'));

  try {
    fs.mkdirSync(worktreeBase, { recursive: true });
    execSync(`git worktree add "${worktreePath}" -b "${branch}" HEAD`, { cwd: repoPath, stdio: 'pipe' });

    // Translate container paths in task description
    let prompt = Object.keys(mappings).length > 0 ? translatePaths(args.task, mappings) : args.task;
    if (args.workflow) {
      prompt = `Run ${args.workflow} for the following task: ${args.task}. When complete, commit all changes and create a PR with \`gh pr create --fill\`.`;
    } else {
      prompt = `${args.task}. When complete, commit all changes and create a PR with \`gh pr create --fill\`.`;
    }

    // Add completion report + parent notification instructions
    prompt += `\n\nIMPORTANT — After creating the PR, write a completion report to .claude/agent-reports/${agentId}.md with: task summary, files changed, test results, PR URL, and any issues encountered.`;
    prompt += `\n\nHEARTBEAT PROTOCOL — Use the send_agent_heartbeat MCP tool to report progress at Fibonacci intervals. Send type=ack immediately when starting, then type=progress at beats 0-8 (1s,2s,4s,7s,12s,20s,33s,54s,88s), and type=complete when done with results.`;
    if (args.parent_agent_id) {
      prompt += `\nThen use the redirect_terminal_agent MCP tool to notify the parent agent (agent_id: "${args.parent_agent_id}") with a brief completion summary including the PR URL.`;
    }

    const claudeCmd = `claude --dangerously-skip-permissions -p ${JSON.stringify(prompt)}`;
    execSync(
      `tmux new-session -d -s "${agentId}" -c "${worktreePath}" '${claudeCmd.replace(/'/g, "'\\''")}'`,
      { stdio: 'pipe' }
    );

    const parentId = args.parent_agent_id || null;
    const agent = {
      id: agentId, repoPath, worktreePath, branch,
      tmuxSession: agentId, status: 'running', prompt: args.task,
      workflow: args.workflow, parentAgentId: parentId, startedAt: new Date().toISOString(),
    };
    registry.agents.push(agent);
    saveRegistry(registryPath, registry);

    // Record spawn ack heartbeat (instant acknowledgment)
    recordHeartbeat(agentId, {
      type: 'ack',
      beatIndex: -1,
      beatTime: 0,
      message: '...',
      metadata: { event: 'spawn' },
      timestamp: new Date().toISOString(),
    });

    return { agent };
  } catch (err) {
    return { error: err.message || String(err) };
  }
}

function checkAgents() {
  const registryPath = getRegistryPath();
  const registry = loadRegistry(registryPath);
  const hbPath = getHeartbeatsPath();
  const hbStore = loadHeartbeats(hbPath);

  for (const agent of registry.agents) {
    // Attach latest heartbeat info for all agents
    const beats = hbStore[agent.id] || [];
    if (beats.length > 0) {
      agent.lastHeartbeat = beats[beats.length - 1];
      agent.heartbeatCount = beats.length;
    }

    if (agent.status !== 'running') continue;

    let alive = false;
    try { execSync(`tmux has-session -t "${agent.tmuxSession}"`, { stdio: 'pipe' }); alive = true; } catch { /* dead */ }

    if (!alive) {
      try {
        const prOut = execSync(`gh pr list --head "${agent.branch}" --json number,title,state --limit 1`, { cwd: agent.repoPath, encoding: 'utf-8', stdio: 'pipe' });
        const prs = JSON.parse(prOut);
        if (prs.length > 0) {
          agent.status = 'completed';
          agent.pr = prs[0].number;
          agent.prUrl = `https://github.com/${getRepoSlug(agent.repoPath)}/pull/${prs[0].number}`;
        } else {
          agent.status = 'completed';
        }
      } catch { agent.status = 'completed'; }
      agent.completedAt = new Date().toISOString();

      // Check for completion report
      const reportPath = path.join(agent.repoPath, '.claude', 'agent-reports', `${agent.id}.md`);
      try {
        if (fs.existsSync(reportPath)) {
          agent.hasReport = true;
          agent.reportPath = reportPath;
        }
      } catch { /* no report */ }
    }
  }

  saveRegistry(registryPath, registry);
  return registry.agents;
}

function redirectAgent(args) {
  const registryPath = getRegistryPath();
  const registry = loadRegistry(registryPath);
  const agent = registry.agents.find(a => a.id === args.agent_id);

  if (!agent) return { error: `Agent "${args.agent_id}" not found` };
  if (agent.status !== 'running') return { error: `Agent "${args.agent_id}" is not running (status: ${agent.status})` };

  // Instant ack heartbeat — record that the message was received
  recordHeartbeat(args.agent_id, {
    type: 'ack',
    beatIndex: -1,
    beatTime: 0,
    message: '...',
    metadata: { redirectMessage: args.message.slice(0, 100) },
    timestamp: new Date().toISOString(),
  });

  try {
    const escaped = args.message.replace(/"/g, '\\"');
    execSync(`tmux send-keys -t "${agent.tmuxSession}" "${escaped}" Enter`, { stdio: 'pipe' });
    return { success: true, heartbeat: 'ack' };
  } catch (err) {
    return { error: err.message || String(err) };
  }
}

function sendHeartbeat(args) {
  const registryPath = getRegistryPath();
  const registry = loadRegistry(registryPath);
  const agent = registry.agents.find(a => a.id === args.agent_id);

  if (!agent) return { error: `Agent "${args.agent_id}" not found` };

  const beatIndex = args.beat_index ?? -1;
  const heartbeat = {
    type: args.type,
    beatIndex,
    beatTime: beatIndex >= 0 && beatIndex < FIBONACCI_BEATS.length ? FIBONACCI_BEATS[beatIndex] : 0,
    message: args.message,
    metadata: args.metadata || {},
    timestamp: new Date().toISOString(),
  };

  recordHeartbeat(args.agent_id, heartbeat);

  // Update agent's last heartbeat in registry for quick status checks
  agent.lastHeartbeat = heartbeat;
  saveRegistry(registryPath, registry);

  return { success: true, heartbeat };
}

function fetchAgentHeartbeats(args) {
  const registryPath = getRegistryPath();
  const registry = loadRegistry(registryPath);
  const agent = registry.agents.find(a => a.id === args.agent_id);

  if (!agent) return { error: `Agent "${args.agent_id}" not found` };

  const beats = getAgentHeartbeats(args.agent_id, args.since_timestamp);
  return {
    agentId: args.agent_id,
    status: agent.status,
    heartbeats: beats,
    total: beats.length,
    fibonacciSchedule: FIBONACCI_BEATS,
  };
}

function stopAgent(args) {
  const registryPath = getRegistryPath();
  const registry = loadRegistry(registryPath);
  const agent = registry.agents.find(a => a.id === args.agent_id);

  if (!agent) return { error: `Agent "${args.agent_id}" not found` };

  try { execSync(`tmux kill-session -t "${agent.tmuxSession}"`, { stdio: 'pipe' }); } catch { /* already dead */ }

  agent.status = 'stopped';
  agent.completedAt = new Date().toISOString();
  saveRegistry(registryPath, registry);
  return { success: true };
}

function getAgentReport(args) {
  const registryPath = getRegistryPath();
  const registry = loadRegistry(registryPath);
  const agent = registry.agents.find(a => a.id === args.agent_id);

  if (!agent) return { error: `Agent "${args.agent_id}" not found` };

  const reportPath = path.join(agent.repoPath, '.claude', 'agent-reports', `${agent.id}.md`);
  try {
    const content = fs.readFileSync(reportPath, 'utf-8');
    return { report: content, agent: { id: agent.id, branch: agent.branch, status: agent.status, pr: agent.pr || null, prUrl: agent.prUrl || null } };
  } catch {
    return { error: `No completion report found for agent "${args.agent_id}". Report expected at: ${reportPath}` };
  }
}

// --- MCP Server Source (written to .claude/helpers/ on install) ---

export function getMcpServerSource() {
  // Return self-contained MCP server script as a string
  // This script is installed to .claude/helpers/terminal-agents-mcp.js
  return `#!/usr/bin/env node
/**
 * Terminal Agents MCP Server — Danizee Claude Suite
 * Raw JSON-RPC 2.0 over stdio. Zero external dependencies.
 * Includes Fibonacci-filtered heartbeat support for streaming progress updates.
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { createInterface } from 'readline';

const REGISTRY_PATH = path.join(process.cwd(), '.claude', 'terminal-agents.json');
const HEARTBEATS_PATH = path.join(process.cwd(), '.claude', 'agent-heartbeats.json');
const MAX_CONCURRENT = 4;
const FIBONACCI_BEATS = [1, 2, 4, 7, 12, 20, 33, 54, 88];

function loadRegistry() {
  try { if (fs.existsSync(REGISTRY_PATH)) return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8')); } catch {}
  return { agents: [] };
}

function saveRegistry(reg) {
  fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
  const tmp = REGISTRY_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(reg, null, 2));
  fs.renameSync(tmp, REGISTRY_PATH);
}

function loadHeartbeats() {
  try { if (fs.existsSync(HEARTBEATS_PATH)) return JSON.parse(fs.readFileSync(HEARTBEATS_PATH, 'utf-8')); } catch {}
  return {};
}

function saveHeartbeats(hb) {
  fs.mkdirSync(path.dirname(HEARTBEATS_PATH), { recursive: true });
  const tmp = HEARTBEATS_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(hb, null, 2));
  fs.renameSync(tmp, HEARTBEATS_PATH);
}

function recordHB(agentId, beat) {
  const store = loadHeartbeats();
  if (!store[agentId]) store[agentId] = [];
  store[agentId].push(beat);
  saveHeartbeats(store);
}

function genId(task) {
  return 'agent-' + task.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30).replace(/-$/, '') + '-' + Math.random().toString(36).slice(2, 6);
}

function genBranch(task) {
  return 'feat/' + task.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40).replace(/-$/, '');
}

function repoSlug(rp) {
  try { const u = execSync('git remote get-url origin', { cwd: rp, encoding: 'utf-8', stdio: 'pipe' }).trim(); const m = u.match(/github\\.com[:/]([^/]+\\/[^/.]+)/); return m ? m[1] : ''; } catch { return ''; }
}

const CONTAINER_PREFIXES = ['/workspace/', '/container/', '/app/'];

function loadPathMappings() {
  try { const p = path.join(process.cwd(), '.claude', 'path-mappings.json'); if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch {}
  return {};
}

function translatePaths(text, mappings) {
  let r = text; for (const [c, h] of Object.entries(mappings)) r = r.replaceAll(c, h); return r;
}

function resolveRepo(rp) {
  const mappings = loadPathMappings();
  if (Object.keys(mappings).length > 0) { const t = translatePaths(rp, mappings); if (t !== rp) return { resolved: t, mappings }; }
  for (const pfx of CONTAINER_PREFIXES) { if (rp.startsWith(pfx)) return { error: 'Container path detected: "' + rp + '". Use a host path or configure .claude/path-mappings.json.' }; }
  return { resolved: rp, mappings };
}

function handleTool(name, args) {
  if (name === 'spawn_terminal_agent') {
    const reg = loadRegistry();
    const running = reg.agents.filter(a => a.status === 'running');
    if (running.length >= MAX_CONCURRENT) return { content: [{ type: 'text', text: 'Max ' + MAX_CONCURRENT + ' concurrent agents. ' + running.length + ' running.' }], isError: true };
    let rp = (args.repo_path || '').replace(/^~/, process.env.HOME || '~');
    const pr = resolveRepo(rp);
    if (pr.error) return { content: [{ type: 'text', text: pr.error }], isError: true };
    rp = pr.resolved; const mappings = pr.mappings || {};
    const id = genId(args.task);
    const br = args.branch_name || genBranch(args.task);
    const wt = path.join(path.dirname(rp), path.basename(rp) + '-worktrees', br.replace(/\\//g, '-'));
    try {
      fs.mkdirSync(path.dirname(wt), { recursive: true });
      execSync('git worktree add "' + wt + '" -b "' + br + '" HEAD', { cwd: rp, stdio: 'pipe' });
      let task = Object.keys(mappings).length > 0 ? translatePaths(args.task, mappings) : args.task;
      let prompt = task;
      if (args.workflow) prompt = 'Run ' + args.workflow + ' for: ' + task + '. When done, commit and create PR with \`gh pr create --fill\`.';
      else prompt += '. When done, commit and create PR with \`gh pr create --fill\`.';
      prompt += '\\n\\nIMPORTANT — After creating the PR, write a completion report to .claude/agent-reports/' + id + '.md with: task summary, files changed, test results, PR URL, and any issues encountered.';
      prompt += '\\n\\nHEARTBEAT PROTOCOL — Use the send_agent_heartbeat MCP tool to report progress at Fibonacci intervals. Send type=ack immediately, then type=progress at beats 0-8 (1s,2s,4s,7s,12s,20s,33s,54s,88s), and type=complete when done.';
      if (args.parent_agent_id) prompt += '\\nThen use the redirect_terminal_agent MCP tool to notify the parent agent (agent_id: "' + args.parent_agent_id + '") with a brief completion summary including the PR URL.';
      const cmd = 'claude --dangerously-skip-permissions -p ' + JSON.stringify(prompt);
      execSync('tmux new-session -d -s "' + id + '" -c "' + wt + '" \\'' + cmd.replace(/'/g, "'\\\\\\\\'") + "\\'", { stdio: 'pipe' });
      const parentId = args.parent_agent_id || null;
      reg.agents.push({ id, repoPath: rp, worktreePath: wt, branch: br, tmuxSession: id, status: 'running', prompt: args.task, workflow: args.workflow, parentAgentId: parentId, startedAt: new Date().toISOString() });
      saveRegistry(reg);
      // Record spawn ack heartbeat
      recordHB(id, { type: 'ack', beatIndex: -1, beatTime: 0, message: '...', metadata: { event: 'spawn' }, timestamp: new Date().toISOString() });
      return { content: [{ type: 'text', text: 'Spawned agent ' + id + ' on branch ' + br + (args.workflow ? ' (workflow: ' + args.workflow + ')' : '') }] };
    } catch (e) { return { content: [{ type: 'text', text: 'Spawn failed: ' + (e.message || e) }], isError: true }; }
  }

  if (name === 'check_terminal_agents') {
    const reg = loadRegistry();
    for (const a of reg.agents) {
      if (a.status !== 'running') continue;
      let alive = false;
      try { execSync('tmux has-session -t "' + a.tmuxSession + '"', { stdio: 'pipe' }); alive = true; } catch {}
      if (!alive) {
        try { const o = execSync('gh pr list --head "' + a.branch + '" --json number,title,state --limit 1', { cwd: a.repoPath, encoding: 'utf-8', stdio: 'pipe' }); const p = JSON.parse(o); if (p.length > 0) { a.pr = p[0].number; a.prUrl = 'https://github.com/' + repoSlug(a.repoPath) + '/pull/' + p[0].number; } } catch {}
        a.status = 'completed'; a.completedAt = new Date().toISOString();
        try { const rp2 = path.join(a.repoPath, '.claude', 'agent-reports', a.id + '.md'); if (fs.existsSync(rp2)) { a.hasReport = true; } } catch {}
      }
    }
    saveRegistry(reg);
    if (reg.agents.length === 0) return { content: [{ type: 'text', text: 'No terminal agents found.' }] };
    const hbStore = loadHeartbeats();
    const fmt = reg.agents.map(a => {
      const beats = hbStore[a.id] || [];
      const lastBeat = beats.length > 0 ? beats[beats.length - 1] : null;
      const hbStatus = lastBeat ? ' | Last heartbeat: ' + lastBeat.type + ' — ' + lastBeat.message.slice(0, 40) : '';
      return '• [' + a.id + '] ' + a.prompt.slice(0, 60) + '\\n  Status: ' + a.status + ' | Branch: ' + a.branch + (a.pr ? ' | PR: #' + a.pr : '') + (a.hasReport ? ' | Report: available' : '') + (a.workflow ? ' | Workflow: ' + a.workflow : '') + hbStatus;
    }).join('\\n\\n');
    return { content: [{ type: 'text', text: 'Terminal agents:\\n\\n' + fmt }] };
  }

  if (name === 'redirect_terminal_agent') {
    const reg = loadRegistry();
    const a = reg.agents.find(x => x.id === args.agent_id);
    if (!a) return { content: [{ type: 'text', text: 'Agent not found: ' + args.agent_id }], isError: true };
    if (a.status !== 'running') return { content: [{ type: 'text', text: 'Agent not running (status: ' + a.status + ')' }], isError: true };
    // Instant ack heartbeat
    recordHB(args.agent_id, { type: 'ack', beatIndex: -1, beatTime: 0, message: '...', metadata: { redirectMessage: (args.message || '').slice(0, 100) }, timestamp: new Date().toISOString() });
    try { execSync('tmux send-keys -t "' + a.tmuxSession + '" "' + args.message.replace(/"/g, '\\\\"') + '" Enter', { stdio: 'pipe' }); return { content: [{ type: 'text', text: 'Redirect sent to ' + args.agent_id + ' (ack heartbeat recorded)' }] }; }
    catch (e) { return { content: [{ type: 'text', text: 'Redirect failed: ' + (e.message || e) }], isError: true }; }
  }

  if (name === 'stop_terminal_agent') {
    const reg = loadRegistry();
    const a = reg.agents.find(x => x.id === args.agent_id);
    if (!a) return { content: [{ type: 'text', text: 'Agent not found: ' + args.agent_id }], isError: true };
    try { execSync('tmux kill-session -t "' + a.tmuxSession + '"', { stdio: 'pipe' }); } catch {}
    a.status = 'stopped'; a.completedAt = new Date().toISOString();
    saveRegistry(reg);
    return { content: [{ type: 'text', text: 'Stopped agent ' + args.agent_id }] };
  }

  if (name === 'get_agent_report') {
    const reg = loadRegistry();
    const a = reg.agents.find(x => x.id === args.agent_id);
    if (!a) return { content: [{ type: 'text', text: 'Agent not found: ' + args.agent_id }], isError: true };
    const rp = path.join(a.repoPath, '.claude', 'agent-reports', a.id + '.md');
    try { const c = fs.readFileSync(rp, 'utf-8'); return { content: [{ type: 'text', text: c }] }; }
    catch { return { content: [{ type: 'text', text: 'No report found for ' + args.agent_id + '. Expected at: ' + rp }], isError: true }; }
  }

  if (name === 'send_agent_heartbeat') {
    const reg = loadRegistry();
    const a = reg.agents.find(x => x.id === args.agent_id);
    if (!a) return { content: [{ type: 'text', text: 'Agent not found: ' + args.agent_id }], isError: true };
    const beatIndex = args.beat_index ?? -1;
    const beat = { type: args.type, beatIndex, beatTime: beatIndex >= 0 && beatIndex < FIBONACCI_BEATS.length ? FIBONACCI_BEATS[beatIndex] : 0, message: args.message, metadata: args.metadata || {}, timestamp: new Date().toISOString() };
    recordHB(args.agent_id, beat);
    a.lastHeartbeat = beat; saveRegistry(reg);
    return { content: [{ type: 'text', text: 'Heartbeat recorded for ' + args.agent_id + ': [' + args.type + '] ' + args.message }] };
  }

  if (name === 'get_agent_heartbeats') {
    const reg = loadRegistry();
    const a = reg.agents.find(x => x.id === args.agent_id);
    if (!a) return { content: [{ type: 'text', text: 'Agent not found: ' + args.agent_id }], isError: true };
    const store = loadHeartbeats();
    let beats = store[args.agent_id] || [];
    if (args.since_timestamp) { const since = new Date(args.since_timestamp).getTime(); beats = beats.filter(b => new Date(b.timestamp).getTime() > since); }
    const lines = beats.map(b => '[' + b.type + '] beat=' + b.beatIndex + ' t=' + b.beatTime + 's — ' + b.message).join('\\n');
    return { content: [{ type: 'text', text: beats.length > 0 ? 'Heartbeats for ' + args.agent_id + ' (' + beats.length + '):\\n' + lines : 'No heartbeats found for ' + args.agent_id }] };
  }

  return { content: [{ type: 'text', text: 'Unknown tool: ' + name }], isError: true };
}

const TOOLS = ${JSON.stringify(getToolDefinitions(), null, 2)};

function respond(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n'); }
function notify(method, params) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\\n'); }

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }

  if (msg.method === 'initialize') {
    respond(msg.id, { protocolVersion: '2024-11-05', capabilities: { tools: {}, notifications: { heartbeat: true } }, serverInfo: { name: 'terminal-agents', version: '2.0.0' } });
  } else if (msg.method === 'notifications/initialized') {
    // no response needed
  } else if (msg.method === 'tools/list') {
    respond(msg.id, { tools: TOOLS });
  } else if (msg.method === 'tools/call') {
    const result = handleTool(msg.params.name, msg.params.arguments || {});
    respond(msg.id, result);
    // Emit heartbeat notification for streaming progress updates
    if (msg.params.name === 'send_agent_heartbeat' && !result.isError) {
      notify('notifications/heartbeat', { agent_id: (msg.params.arguments || {}).agent_id, type: (msg.params.arguments || {}).type, message: (msg.params.arguments || {}).message });
    }
  } else if (msg.id) {
    respond(msg.id, { error: { code: -32601, message: 'Method not found' } });
  }
});
`;
}

// --- Direct tool execution (for testing) ---

export function executeTool(name, args) {
  switch (name) {
    case 'spawn_terminal_agent': return spawnAgent(args);
    case 'check_terminal_agents': return checkAgents();
    case 'redirect_terminal_agent': return redirectAgent(args);
    case 'stop_terminal_agent': return stopAgent(args);
    case 'get_agent_report': return getAgentReport(args);
    case 'send_agent_heartbeat': return sendHeartbeat(args);
    case 'get_agent_heartbeats': return fetchAgentHeartbeats(args);
    default: return { error: `Unknown tool: ${name}` };
  }
}

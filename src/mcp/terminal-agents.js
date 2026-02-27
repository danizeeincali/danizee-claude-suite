/**
 * Terminal Agents MCP Server for Danizee Claude Suite
 *
 * Self-contained MCP server (raw JSON-RPC 2.0 over stdio) that provides
 * terminal agent orchestration via tmux + git worktrees. Zero external deps.
 *
 * Tools:
 *   spawn_terminal_agent  — Start Claude Code in tmux with git worktree
 *   check_terminal_agents — List running agents with status/PR info
 *   redirect_terminal_agent — Send instructions to running agent
 *   stop_terminal_agent   — Kill agent's tmux session
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

  const repoPath = args.repo_path.replace(/^~/, process.env.HOME || '~');
  const agentId = generateAgentId(args.task);
  const branch = args.branch_name || generateBranchName(args.task);

  const repoName = path.basename(repoPath);
  const worktreeBase = path.join(path.dirname(repoPath), `${repoName}-worktrees`);
  const worktreePath = path.join(worktreeBase, branch.replace(/\//g, '-'));

  try {
    fs.mkdirSync(worktreeBase, { recursive: true });
    execSync(`git worktree add "${worktreePath}" -b "${branch}" HEAD`, { cwd: repoPath, stdio: 'pipe' });

    let prompt = args.task;
    if (args.workflow) {
      prompt = `Run ${args.workflow} for the following task: ${args.task}. When complete, commit all changes and create a PR with \`gh pr create --fill\`.`;
    } else {
      prompt = `${args.task}. When complete, commit all changes and create a PR with \`gh pr create --fill\`.`;
    }

    const claudeCmd = `claude --dangerously-skip-permissions -p ${JSON.stringify(prompt)}`;
    execSync(
      `tmux new-session -d -s "${agentId}" -c "${worktreePath}" '${claudeCmd.replace(/'/g, "'\\''")}'`,
      { stdio: 'pipe' }
    );

    const agent = {
      id: agentId, repoPath, worktreePath, branch,
      tmuxSession: agentId, status: 'running', prompt: args.task,
      workflow: args.workflow, startedAt: new Date().toISOString(),
    };
    registry.agents.push(agent);
    saveRegistry(registryPath, registry);

    return { agent };
  } catch (err) {
    return { error: err.message || String(err) };
  }
}

function checkAgents() {
  const registryPath = getRegistryPath();
  const registry = loadRegistry(registryPath);

  for (const agent of registry.agents) {
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

  try {
    const escaped = args.message.replace(/"/g, '\\"');
    execSync(`tmux send-keys -t "${agent.tmuxSession}" "${escaped}" Enter`, { stdio: 'pipe' });
    return { success: true };
  } catch (err) {
    return { error: err.message || String(err) };
  }
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

// --- MCP Server Source (written to .claude/helpers/ on install) ---

export function getMcpServerSource() {
  // Return self-contained MCP server script as a string
  // This script is installed to .claude/helpers/terminal-agents-mcp.js
  return `#!/usr/bin/env node
/**
 * Terminal Agents MCP Server — Danizee Claude Suite
 * Raw JSON-RPC 2.0 over stdio. Zero external dependencies.
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { createInterface } from 'readline';

const REGISTRY_PATH = path.join(process.cwd(), '.claude', 'terminal-agents.json');
const MAX_CONCURRENT = 4;

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

function genId(task) {
  return 'agent-' + task.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30).replace(/-$/, '') + '-' + Math.random().toString(36).slice(2, 6);
}

function genBranch(task) {
  return 'feat/' + task.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40).replace(/-$/, '');
}

function repoSlug(rp) {
  try { const u = execSync('git remote get-url origin', { cwd: rp, encoding: 'utf-8', stdio: 'pipe' }).trim(); const m = u.match(/github\\.com[:/]([^/]+\\/[^/.]+)/); return m ? m[1] : ''; } catch { return ''; }
}

function handleTool(name, args) {
  if (name === 'spawn_terminal_agent') {
    const reg = loadRegistry();
    const running = reg.agents.filter(a => a.status === 'running');
    if (running.length >= MAX_CONCURRENT) return { content: [{ type: 'text', text: 'Max ' + MAX_CONCURRENT + ' concurrent agents. ' + running.length + ' running.' }], isError: true };
    const rp = (args.repo_path || '').replace(/^~/, process.env.HOME || '~');
    const id = genId(args.task);
    const br = args.branch_name || genBranch(args.task);
    const wt = path.join(path.dirname(rp), path.basename(rp) + '-worktrees', br.replace(/\\//g, '-'));
    try {
      fs.mkdirSync(path.dirname(wt), { recursive: true });
      execSync('git worktree add "' + wt + '" -b "' + br + '" HEAD', { cwd: rp, stdio: 'pipe' });
      let prompt = args.task;
      if (args.workflow) prompt = 'Run ' + args.workflow + ' for: ' + args.task + '. When done, commit and create PR with \`gh pr create --fill\`.';
      else prompt += '. When done, commit and create PR with \`gh pr create --fill\`.';
      const cmd = 'claude --dangerously-skip-permissions -p ' + JSON.stringify(prompt);
      execSync('tmux new-session -d -s "' + id + '" -c "' + wt + '" \\'' + cmd.replace(/'/g, "'\\\\\\\\'") + "\\'", { stdio: 'pipe' });
      reg.agents.push({ id, repoPath: rp, worktreePath: wt, branch: br, tmuxSession: id, status: 'running', prompt: args.task, workflow: args.workflow, startedAt: new Date().toISOString() });
      saveRegistry(reg);
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
      }
    }
    saveRegistry(reg);
    if (reg.agents.length === 0) return { content: [{ type: 'text', text: 'No terminal agents found.' }] };
    const fmt = reg.agents.map(a => '• [' + a.id + '] ' + a.prompt.slice(0, 60) + '\\n  Status: ' + a.status + ' | Branch: ' + a.branch + (a.pr ? ' | PR: #' + a.pr : '') + (a.workflow ? ' | Workflow: ' + a.workflow : '')).join('\\n\\n');
    return { content: [{ type: 'text', text: 'Terminal agents:\\n\\n' + fmt }] };
  }

  if (name === 'redirect_terminal_agent') {
    const reg = loadRegistry();
    const a = reg.agents.find(x => x.id === args.agent_id);
    if (!a) return { content: [{ type: 'text', text: 'Agent not found: ' + args.agent_id }], isError: true };
    if (a.status !== 'running') return { content: [{ type: 'text', text: 'Agent not running (status: ' + a.status + ')' }], isError: true };
    try { execSync('tmux send-keys -t "' + a.tmuxSession + '" "' + args.message.replace(/"/g, '\\\\"') + '" Enter', { stdio: 'pipe' }); return { content: [{ type: 'text', text: 'Redirect sent to ' + args.agent_id }] }; }
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

  return { content: [{ type: 'text', text: 'Unknown tool: ' + name }], isError: true };
}

const TOOLS = ${JSON.stringify(getToolDefinitions(), null, 2)};

function respond(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n'); }

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }

  if (msg.method === 'initialize') {
    respond(msg.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'terminal-agents', version: '1.0.0' } });
  } else if (msg.method === 'notifications/initialized') {
    // no response needed
  } else if (msg.method === 'tools/list') {
    respond(msg.id, { tools: TOOLS });
  } else if (msg.method === 'tools/call') {
    const result = handleTool(msg.params.name, msg.params.arguments || {});
    respond(msg.id, result);
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
    default: return { error: `Unknown tool: ${name}` };
  }
}

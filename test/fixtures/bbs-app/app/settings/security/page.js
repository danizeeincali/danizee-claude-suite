// Settings › Security: lists the user's active sessions.
export default function SecuritySettingsPage({ sessions = [] } = {}) {
  const rows = sessions.map(s => `<li>${s.device}: ${s.note}</li>`).join('');
  return `<section><h1>Security</h1><ul>${rows}</ul></section>`;
}

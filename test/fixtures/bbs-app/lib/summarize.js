// The model step: summarizes a support ticket with the LLM client the app passes in.
export async function summarizeTicket(text, client) {
  const msg = await client.messages.create({ model: 'claude-sonnet-5-5', max_tokens: 400, messages: [{ role: 'user', content: text }] });
  return msg.content;
}

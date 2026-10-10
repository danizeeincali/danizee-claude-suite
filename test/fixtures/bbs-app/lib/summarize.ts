import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

export async function summarizeTicket(text: string) {
  const msg = await client.messages.create({ model: 'claude-sonnet-5-5', max_tokens: 400, messages: [{ role: 'user', content: text }] });
  return msg.content;
}

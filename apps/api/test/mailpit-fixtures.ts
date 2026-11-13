interface MailpitMessage { ID: string; Text: string; To: { Address: string }[] }
const base = process.env.MAILPIT_BASE_URL ?? 'http://localhost:8025';

export async function findTestEmails(email: string): Promise<{ ID: string }[]> {
  if (!/^[a-z0-9-]+@example\.invalid$/.test(email)) throw new Error('Synthetic recipient required');
  const response = await fetch(`${base}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
  if (!response.ok) throw new Error('Native Mailpit API unavailable');
  return ((await response.json()) as { messages: { ID: string }[] }).messages;
}
export async function readActivationEmail(email: string) {
  for (let i = 0; i < 30; i++) {
    const messages = await findTestEmails(email);
    if (messages.length) {
      const message = await (await fetch(`${base}/api/v1/message/${messages[0].ID}`)).json() as MailpitMessage;
      if (!message.To.some(recipient => recipient.Address === email)) throw new Error('Unexpected recipient');
      const link = message.Text.match(/https?:\/\/[^\s]+\/verify-email#[^\s]+/)?.[0];
      if (!link) throw new Error('Activation link missing');
      return { id: message.ID, link, token: new URLSearchParams(new URL(link).hash.slice(1)).get('token')! };
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Synthetic activation email not received');
}
export async function clearTestEmails(email: string) {
  const messages = await findTestEmails(email);
  if (!messages.length) return;
  const response = await fetch(`${base}/api/v1/messages`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ IDs: messages.map(message => message.ID) }) });
  if (!response.ok) throw new Error('Unable to clean synthetic email fixture');
}

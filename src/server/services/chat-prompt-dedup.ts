export interface ChatPromptHistoryMessage {
  role: string;
  content?: unknown;
}

function normalizeQueryForComparison(value: unknown): string {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .toLowerCase();
}

/**
 * Some clients append the composer value to history before sending the request.
 * Remove only that trailing user entry so the current request remains solely in
 * CURRENT_USER_REQUEST; earlier repeated requests stay available as history.
 */
export function omitTrailingCurrentUserRequest<T extends ChatPromptHistoryMessage>(
  history: readonly T[] | undefined,
  currentRequests: readonly string[],
): T[] {
  const messages = Array.isArray(history) ? [...history] : [];
  const candidates = new Set(
    currentRequests
      .map(normalizeQueryForComparison)
      .filter(Boolean),
  );
  if (messages.length === 0 || candidates.size === 0) return messages;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (String(message?.role || '').toLowerCase() !== 'user') continue;
    if (candidates.has(normalizeQueryForComparison(message.content))) {
      messages.splice(index, 1);
    }
    break;
  }
  return messages;
}

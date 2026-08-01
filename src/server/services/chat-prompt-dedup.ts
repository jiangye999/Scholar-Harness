export interface ChatPromptHistoryMessage {
  role: string;
  content?: unknown;
}

export function normalizeQueryForComparison(value: unknown): string {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .toLowerCase();
}

/**
 * Recent-query memory is useful for continuity, but the current history is
 * already rendered as its own prompt section. Remove only exact normalized
 * copies so no unique earlier query is lost.
 */
export function omitQueriesAlreadyRepresentedInHistory(
  queries: readonly string[] | undefined,
  history: readonly ChatPromptHistoryMessage[] | undefined,
  currentRequests: readonly string[] = [],
): string[] {
  const represented = new Set<string>();
  for (const message of Array.isArray(history) ? history : []) {
    if (String(message?.role || '').toLowerCase() !== 'user') continue;
    const normalized = normalizeQueryForComparison(message.content);
    if (normalized) represented.add(normalized);
  }
  for (const request of currentRequests) {
    const normalized = normalizeQueryForComparison(request);
    if (normalized) represented.add(normalized);
  }

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const query of Array.isArray(queries) ? queries : []) {
    const normalized = normalizeQueryForComparison(query);
    if (!normalized || represented.has(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(String(query).trim());
  }
  return unique;
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

const CONTEXT_OVERFLOW_PATTERNS = [
  /context[_\s-]?length[_\s-]?exceeded/i,
  /context window[^\n]{0,100}(?:exceed|overflow|too (?:large|long)|ran out)/i,
  /(?:exceed|overflow|too (?:large|long))[^\n]{0,100}context window/i,
  /maximum context (?:length|window)/i,
  /input exceeds (?:the )?context/i,
  /prompt (?:is )?too (?:large|long)/i,
  /too many (?:input )?tokens/i,
  /ran out of room in [^\n]{0,80}context/i,
];

/** Match only prompt/context admission failures, never ordinary output limits. */
export function isCodingAgentContextOverflowError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return CONTEXT_OVERFLOW_PATTERNS.some(pattern => pattern.test(message));
}

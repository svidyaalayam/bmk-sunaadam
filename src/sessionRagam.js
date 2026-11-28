export function resolveSessionRagamId(exercise, sessionId, sessionSelections) {
  const sessionRagamId = sessionSelections[String(sessionId)];
  return sessionRagamId !== undefined
    ? sessionRagamId
    : String(exercise?.ragamId || "");
}

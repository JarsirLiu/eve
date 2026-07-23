/**
 * Thrown by a {@link Runtime}'s `deliver` when no in-flight session
 * matches the continuation token. Callers using the resume-or-start
 * pattern (e.g. {@link createSendFn}) treat this as the signal to start
 * a fresh session.
 */
export class RuntimeNoActiveSessionError extends Error {
  readonly code = "NO_ACTIVE_SESSION" as const;
  readonly continuationToken: string;

  constructor(continuationToken: string) {
    super(`No active session for continuationToken "${continuationToken}".`);
    this.name = "RuntimeNoActiveSessionError";
    this.continuationToken = continuationToken;
  }
}

/** Type guard for {@link RuntimeNoActiveSessionError}. */
export function isRuntimeNoActiveSessionError(
  error: unknown,
): error is RuntimeNoActiveSessionError {
  return error instanceof RuntimeNoActiveSessionError;
}

/** Thrown when a manual compaction targets a session that is not parked. */
export class RuntimeCompactionConflictError extends Error {
  readonly code = "ACTIVE_TURN" as const;
  readonly sessionId: string;

  constructor(sessionId: string) {
    super(`Session "${sessionId}" is not parked and cannot be compacted.`);
    this.name = "RuntimeCompactionConflictError";
    this.sessionId = sessionId;
  }
}

/** Thrown when a manual compaction target does not exist. */
export class RuntimeSessionNotFoundError extends Error {
  readonly code = "SESSION_NOT_FOUND" as const;
  readonly sessionId: string;

  constructor(sessionId: string) {
    super(`Session "${sessionId}" was not found.`);
    this.name = "RuntimeSessionNotFoundError";
    this.sessionId = sessionId;
  }
}

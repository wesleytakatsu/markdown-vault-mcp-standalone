import type { ErrorCode } from "../types/errors.js";

export class VaultError extends Error {
  public readonly code: ErrorCode;

  constructor(message: string, code: ErrorCode) {
    super(message);
    this.name = "VaultError";
    this.code = code;
  }
}

export class PathTraversalError extends VaultError {
  constructor(path: string) {
    super(
      `Refusing to access path outside vault. Path traversal denied: ${path}`,
      "PATH_TRAVERSAL_DENIED",
    );
    this.name = "PathTraversalError";
  }
}

export class NoteNotFoundError extends VaultError {
  constructor(path: string) {
    super(`Note not found: ${path}`, "NOTE_NOT_FOUND");
    this.name = "NoteNotFoundError";
  }
}

export class InvalidMarkdownError extends VaultError {
  constructor(message: string) {
    super(message, "INVALID_MARKDOWN");
    this.name = "InvalidMarkdownError";
  }
}

export class OperationFailedError extends VaultError {
  constructor(message: string) {
    super(message, "OPERATION_FAILED");
    this.name = "OperationFailedError";
  }
}

export class ToolNotFoundError extends VaultError {
  constructor(name: string) {
    super(`Tool not found: ${name}`, "TOOL_NOT_FOUND");
    this.name = "ToolNotFoundError";
  }
}

export class ToolExecutionError extends VaultError {
  constructor(name: string, cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(`Tool execution failed [${name}]: ${message}`, "TOOL_EXECUTION_FAILED");
    this.name = "ToolExecutionError";
    if (cause instanceof Error) this.stack = cause.stack;
  }
}

export class Sha256MismatchError extends VaultError {
  constructor(expected: string, got: string) {
    super(`SHA-256 mismatch: expected ${expected}, got ${got}`, "SHA256_MISMATCH");
    this.name = "Sha256MismatchError";
  }
}

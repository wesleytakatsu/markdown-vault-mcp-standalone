import fs from "node:fs";
import path from "node:path";
import { PathTraversalError } from "../../errors/vault-error.js";
import { MARKDOWN_EXTENSIONS } from "../../config/constants.js";

export class PathResolver {
  constructor(
    private vaultRoot: string,
    private vaultRealRoot: string,
  ) {}

  get root(): string {
    return this.vaultRoot;
  }

  get realRoot(): string {
    return this.vaultRealRoot;
  }

  resolveVaultPath(input = ""): string {
    if (!this.vaultRoot) {
      throw new Error("Vault path is not configured");
    }
    const abs = path.resolve(this.vaultRoot, input);
    const rel = path.relative(this.vaultRoot, abs);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new PathTraversalError(input);
    }
    this.assertRealPathInsideSync(abs);
    return abs;
  }

  resolveNotePath(input: string): string {
    const ext = path.extname(input).toLowerCase();
    if (ext && !MARKDOWN_EXTENSIONS.has(ext)) {
      throw new Error("Only .md and .markdown note files are supported");
    }
    return this.resolveVaultPath(input);
  }

  relativePath(abs: string): string {
    return path.relative(this.vaultRoot, abs).split(path.sep).join("/");
  }

  isInside(base: string, candidate: string): boolean {
    const rel = path.relative(base, candidate);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  }

  async assertRealPathInside(abs: string): Promise<void> {
    if (!this.vaultRealRoot) {
      throw new Error("Vault path does not exist");
    }
    let cursor = abs;
    while (true) {
      try {
        const real = await fs.promises.realpath(cursor);
        if (!this.isInside(this.vaultRealRoot, real)) {
          throw new PathTraversalError(cursor);
        }
        return;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "ENOENT" && code !== "ENOTDIR") throw err;
        const parent = path.dirname(cursor);
        if (parent === cursor) {
          throw new PathTraversalError(cursor);
        }
        cursor = parent;
      }
    }
  }

  assertRealPathInsideSync(abs: string): void {
    if (!this.vaultRealRoot) {
      throw new Error("Vault path does not exist");
    }
    let cursor = abs;
    while (true) {
      try {
        const real = fs.realpathSync(cursor);
        if (!this.isInside(this.vaultRealRoot, real)) {
          throw new PathTraversalError(cursor);
        }
        return;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "ENOENT" && code !== "ENOTDIR") throw err;
        const parent = path.dirname(cursor);
        if (parent === cursor) {
          throw new PathTraversalError(cursor);
        }
        cursor = parent;
      }
    }
  }
}

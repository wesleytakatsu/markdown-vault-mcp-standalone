import path from "node:path";
import { MARKDOWN_EXTENSIONS } from "../config/constants.js";
import { isMarkdownPath } from "./validation.utils.js";

export function globMatcher(pattern: string): (value: string) => boolean {
  const normalized = pattern.replace(/\\/g, "/");
  if (!/[*?[\]{}]/.test(normalized)) {
    return (value) => value === normalized;
  }

  let source = "^";
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    const next = normalized[i + 1];
    const nextNext = normalized[i + 2];
    if (char === "*" && next === "*" && nextNext === "/") {
      source += "(?:.*/)?";
      i += 2;
    } else if (char === "*" && next === "*") {
      source += ".*";
      i += 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  source += "$";
  const re = new RegExp(source);
  return (value) => re.test(value);
}

export function isWithinInputPath(rel: string, inputPath: string): boolean {
  const normalized = path.posix
    .normalize(inputPath.replace(/\\/g, "/"))
    .replace(/^\.\//, "")
    .replace(/\/$/, "");
  if (!normalized || normalized === ".") return true;
  if (isMarkdownPath(normalized, MARKDOWN_EXTENSIONS)) return rel === normalized;
  return rel === normalized || rel.startsWith(`${normalized}/`);
}

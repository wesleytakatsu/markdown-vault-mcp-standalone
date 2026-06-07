import type { JsonValue } from "./common.js";

export type Frontmatter = Record<string, JsonValue>;

export type FrontmatterParse = {
  body: string;
  frontmatter: Frontmatter;
  hasFrontmatter: boolean;
  rawFrontmatter: string;
  yamlError?: string;
};

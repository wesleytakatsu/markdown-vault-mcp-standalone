export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type Frontmatter = Record<string, JsonValue>;

export type ToolDefinition = {
  description: string;
  inputSchema: Record<string, unknown>;
  name: string;
};

export type Vault = {
  realRoot: string;
  root: string;
};

export type Heading = {
  level: number;
  line: number;
  text: string;
};

export type FrontmatterParse = {
  body: string;
  frontmatter: Frontmatter;
  hasFrontmatter: boolean;
  rawFrontmatter: string;
  yamlError?: string;
};

export type LinkMatch = {
  alias?: string;
  href?: string;
  line: number;
  raw: string;
  target: string;
  text: string;
  type: "wikilink" | "markdown";
};

export type MarkdownNote = {
  abs: string;
  body: string;
  charCount: number;
  content: string;
  frontmatter: Frontmatter;
  hasFrontmatter: boolean;
  headings: Heading[];
  lineCount: number;
  links: LinkMatch[];
  rawFrontmatter: string;
  rel: string;
  tags: string[];
  title: string | null;
  yamlError?: string;
};

export type NoteIndex = {
  byBasenameNoExt: Map<string, string[]>;
  byRel: Map<string, MarkdownNote>;
  byRelNoExt: Map<string, string>;
  relNoExtByRel: Map<string, string>;
};

export type LinkGraph = {
  backlinks: Map<string, Map<string, LinkMatch[]>>;
  outgoing: Map<string, Set<string>>;
};

export type Issue = {
  file?: string;
  line?: number;
  message: string;
  severity: "error" | "warning" | "info";
  type: string;
};

export type RankedNote = {
  matchedBy: string[];
  note: MarkdownNote;
  score: number;
  snippet: string;
};

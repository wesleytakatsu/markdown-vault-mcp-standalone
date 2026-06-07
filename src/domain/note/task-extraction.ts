import type { MarkdownNote } from "../../types/markdown.js";

export type ExtractedTask = {
  done: boolean;
  file: string;
  line: number;
  text: string;
};

export function taskItemsFromNotes(notes: MarkdownNote[], includeDone: boolean): ExtractedTask[] {
  const tasks: ExtractedTask[] = [];

  for (const note of notes) {
    const lines = note.content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const checkbox = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.+)$/);
      if (checkbox) {
        const done = checkbox[1].toLowerCase() === "x";
        if (!done || includeDone) {
          tasks.push({ done, file: note.rel, line: i + 1, text: checkbox[2].trim() });
        }
        continue;
      }

      const todo =
        line.match(/\b(TODO|FIXME):?\s+(.+)$/i) ?? line.match(/@todo\b:?\s*(.+)$/i);
      if (todo) {
        tasks.push({ done: false, file: note.rel, line: i + 1, text: todo[0].trim() });
      }
    }
  }

  return tasks;
}

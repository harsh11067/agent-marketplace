import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ExecutionContext, Tool } from "../types.ts";

export class FileWriterTool implements Tool<{ filename: string; content: string }, string> {
  name = "fileWriter";

  async run(input: { filename: string; content: string }, context: ExecutionContext): Promise<string> {
    const outputDir = join(context.workspaceRoot, "artifacts");
    await mkdir(outputDir, { recursive: true });
    const outputPath = join(outputDir, input.filename);
    await writeFile(outputPath, input.content, "utf8");
    return outputPath;
  }
}

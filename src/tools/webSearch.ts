import type { ExecutionContext, Tool } from "../types.ts";

export class WebSearchTool implements Tool<{ query: string }, string[]> {
  name = "webSearch";

  async run(input: { query: string }, _context: ExecutionContext): Promise<string[]> {
    const query = input.query.toLowerCase();

    if (query.includes("landing page")) {
      return [
        "Landing pages should present one clear CTA.",
        "Social proof and concise benefit statements improve conversion.",
        "Fast-loading static pages are ideal for demos."
      ];
    }

    return ["Use simple, verifiable output with a short summary and one artifact."];
  }
}

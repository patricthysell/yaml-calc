import { TagHandler } from "../types";

export class HandlerRegistry {
  private handlers = new Map<string, TagHandler>();
  register(handler: TagHandler) {
    if (this.handlers.has(handler.tag)) throw new Error(`Duplicate handler: ${handler.tag}`);
    this.handlers.set(handler.tag, handler);
  }
  all(): TagHandler[] { return [...this.handlers.values()]; }
  byTag(tag: string) { return this.handlers.get(tag); }
}

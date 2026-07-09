import { describe, expect, it } from "vitest";
import {
  mentionMenuKeyAction,
  moveMenuIndex,
  splitLeadingSlashToken,
  shouldNotifyInputOnKeyUp,
} from "../../src/lib/ui/menu-navigation";

describe("moveMenuIndex", () => {
  it("moves within the available menu items without resetting", () => {
    expect(moveMenuIndex(0, "next", 4)).toBe(1);
    expect(moveMenuIndex(1, "next", 4)).toBe(2);
    expect(moveMenuIndex(2, "previous", 4)).toBe(1);
  });

  it("clamps at list boundaries and handles empty lists", () => {
    expect(moveMenuIndex(3, "next", 4)).toBe(3);
    expect(moveMenuIndex(0, "previous", 4)).toBe(0);
    expect(moveMenuIndex(2, "next", 0)).toBe(0);
  });

  it("holds mention navigation keys while results are loading", () => {
    expect(mentionMenuKeyAction("ArrowDown", true)).toBe("hold");
    expect(mentionMenuKeyAction("ArrowUp", true)).toBe("hold");
    expect(mentionMenuKeyAction("Enter", true)).toBe("hold");
    expect(mentionMenuKeyAction("Escape", true)).toBe("close");
  });

  it("does not reparse input on menu-control keyup events", () => {
    expect(shouldNotifyInputOnKeyUp("ArrowDown")).toBe(false);
    expect(shouldNotifyInputOnKeyUp("ArrowUp")).toBe(false);
    expect(shouldNotifyInputOnKeyUp("Enter")).toBe(false);
    expect(shouldNotifyInputOnKeyUp("a")).toBe(true);
    expect(shouldNotifyInputOnKeyUp("ArrowLeft")).toBe(true);
  });

  it("extracts a selected slash command while preserving following text", () => {
    expect(splitLeadingSlashToken("/article-summary 写一篇摘要")).toEqual({
      token: "/article-summary",
      rest: " 写一篇摘要",
    });
    expect(splitLeadingSlashToken("普通文本 /article-summary")).toBeNull();
    expect(splitLeadingSlashToken("/article-summary")).toBeNull();
  });
});

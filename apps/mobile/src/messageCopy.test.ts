import { describe, expect, it } from "vitest";

import { getMessageCopyValue, markdownToPlainText } from "./messageCopy";

describe("markdownToPlainText", () => {
  it("removes markdown formatting while preserving readable structure", () => {
    expect(markdownToPlainText("# Title\n\nHello **world** and [docs](https://example.com).")).toBe(
      "Title\n\nHello world and docs.",
    );
  });

  it("keeps code blocks and list content copyable as plain text", () => {
    expect(markdownToPlainText("```ts\nconst value = 1;\n```\n\n- first\n- second")).toBe(
      "const value = 1;\n\n- first\n- second",
    );
  });

  it("renders tables and ordered lists into readable plain text", () => {
    expect(
      markdownToPlainText("| Name | Value |\n| --- | --- |\n| Foo | Bar |\n\n1. First\n2. Second"),
    ).toBe("Name | Value\nFoo | Bar\n\n1. First\n2. Second");
  });
});

describe("getMessageCopyValue", () => {
  it("returns raw markdown when rich markdown copy is requested", () => {
    expect(getMessageCopyValue({ format: "markdown", text: "**hi**" })).toBe("**hi**");
  });
});

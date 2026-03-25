import { Lexer, type Token, type Tokens } from "marked";

export type MessageCopyFormat = "markdown" | "plainText";

export function getMessageCopyValue(input: {
  readonly format: MessageCopyFormat;
  readonly text: string;
}) {
  return input.format === "markdown" ? input.text : markdownToPlainText(input.text);
}

export function markdownToPlainText(markdown: string) {
  return normalizePlainText(renderBlockTokens(Lexer.lex(markdown)));
}

function renderBlockTokens(tokens: ReadonlyArray<Token>, separator = "\n\n") {
  const blocks = tokens
    .map((token) => renderBlockToken(token))
    .filter((value): value is string => value.trim().length > 0);
  return blocks.join(separator);
}

function renderBlockToken(token: Token): string {
  switch (token.type) {
    case "blockquote":
    case "del":
    case "em":
    case "heading":
    case "link":
    case "paragraph":
    case "strong":
      return renderInlineTokens(token.tokens);
    case "checkbox":
      return token.checked ? "[x]" : "[ ]";
    case "code":
      return token.text.trimEnd();
    case "codespan":
    case "escape":
      return token.text;
    case "html":
      return stripHtml(token.text || token.raw);
    case "image":
      return renderInlineTokens(token.tokens) || token.text;
    case "list":
      return renderList(token as Tokens.List);
    case "space":
    case "def":
    case "hr":
      return "";
    case "table":
      return renderTable(token as Tokens.Table);
    case "text":
      return token.tokens ? renderInlineTokens(token.tokens) : token.text;
    case "br":
      return "\n";
    default:
      return renderGenericToken(token);
  }
}

function renderInlineTokens(tokens: ReadonlyArray<Token> | undefined): string {
  if (!tokens || tokens.length === 0) {
    return "";
  }
  return tokens.map((token) => renderInlineToken(token)).join("");
}

function renderInlineToken(token: Token): string {
  switch (token.type) {
    case "br":
      return "\n";
    case "checkbox":
      return token.checked ? "[x] " : "[ ] ";
    case "codespan":
    case "escape":
      return token.text;
    case "del":
    case "em":
    case "heading":
    case "link":
    case "paragraph":
    case "strong":
      return renderInlineTokens(token.tokens);
    case "html":
      return stripHtml(token.text || token.raw);
    case "image":
      return renderInlineTokens(token.tokens) || token.text;
    case "text":
      return token.tokens ? renderInlineTokens(token.tokens) : token.text;
    default:
      return renderGenericToken(token);
  }
}

function renderList(token: Tokens.List) {
  const firstIndex = typeof token.start === "number" ? token.start : 1;
  return token.items
    .map((item, index) => renderListItem(item, token.ordered, firstIndex + index))
    .join("\n");
}

function renderListItem(item: Tokens.ListItem, ordered: boolean, index: number) {
  const prefix = ordered ? `${index}. ` : "- ";
  const content = renderBlockTokens(item.tokens, "\n");
  if (content.length === 0) {
    return prefix.trimEnd();
  }

  return content
    .split("\n")
    .map((line, lineIndex) =>
      lineIndex === 0 ? `${prefix}${line}` : `${" ".repeat(prefix.length)}${line}`,
    )
    .join("\n");
}

function renderTable(token: Tokens.Table) {
  const headerRow = token.header.map((cell) => renderInlineTokens(cell.tokens)).join(" | ");
  const bodyRows = token.rows.map((row) =>
    row.map((cell) => renderInlineTokens(cell.tokens)).join(" | "),
  );
  return [headerRow, ...bodyRows].filter((row) => row.trim().length > 0).join("\n");
}

function renderGenericToken(token: Token): string {
  if ("tokens" in token && Array.isArray(token.tokens)) {
    return renderInlineTokens(token.tokens);
  }
  if ("text" in token && typeof token.text === "string") {
    return token.text;
  }
  return "";
}

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/gu, "");
}

function normalizePlainText(value: string) {
  return value
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/u, ""))
    .join("\n")
    .trim();
}

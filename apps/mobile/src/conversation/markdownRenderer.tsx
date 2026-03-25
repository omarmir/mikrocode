import Prism from "prismjs";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-clike";
import "prismjs/components/prism-diff";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-json";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-yaml";
import { cloneElement, isValidElement, memo, type ReactNode, useEffect, useMemo } from "react";
import { ScrollView, Text, type TextStyle, View, type ViewStyle } from "react-native";
import { Renderer, type MarkedStyles, useMarkdown } from "react-native-marked";

import { useAppThemeContext } from "../appThemeContext";
import {
  getMarkdownRenderCacheKey,
  readMarkdownRenderCache,
  writeMarkdownRenderCache,
} from "./markdownRenderCache";

type MarkdownRenderElementProps = {
  readonly children?: ReactNode;
  readonly style?: unknown;
};

const PRISM_LANGUAGE_ALIASES: Record<string, string> = {
  bash: "bash",
  console: "bash",
  cts: "typescript",
  diff: "diff",
  javascript: "javascript",
  js: "javascript",
  json: "json",
  jsx: "jsx",
  markdown: "markdown",
  md: "markdown",
  mts: "typescript",
  patch: "diff",
  sh: "bash",
  shell: "bash",
  text: "plain",
  plaintext: "plain",
  ts: "typescript",
  tsx: "tsx",
  txt: "plain",
  typescript: "typescript",
  yaml: "yaml",
  yml: "yaml",
  zsh: "bash",
};

const rendererCache = new Map<
  string,
  {
    readonly markdownStyles: MarkedStyles;
    readonly renderer: ChatMarkdownRenderer;
  }
>();

function normalizeCodeLanguage(language?: string) {
  const normalizedLanguage = language?.trim().toLowerCase() ?? "";
  if (normalizedLanguage.length === 0) {
    return null;
  }
  return PRISM_LANGUAGE_ALIASES[normalizedLanguage] ?? normalizedLanguage;
}

function getPrismGrammar(language?: string) {
  const normalizedLanguage = normalizeCodeLanguage(language);
  if (!normalizedLanguage || normalizedLanguage === "plain") {
    return null;
  }
  const grammar = Prism.languages[normalizedLanguage];
  return grammar ? { grammar, language: normalizedLanguage } : null;
}

function getCodeTokenStyles(token: Prism.Token, markdownStyles: any): TextStyle[] | undefined {
  const tokenNames = [
    token.type,
    ...(Array.isArray(token.alias) ? token.alias : token.alias ? [token.alias] : []),
  ];
  const resolvedStyles = tokenNames.flatMap((tokenName) => {
    switch (tokenName) {
      case "comment":
      case "prolog":
      case "doctype":
      case "cdata":
        return [markdownStyles.codeComment];
      case "keyword":
      case "atrule":
      case "selector":
      case "important":
        return [markdownStyles.codeKeyword];
      case "string":
      case "char":
      case "regex":
        return [markdownStyles.codeString];
      case "number":
      case "boolean":
      case "constant":
        return [markdownStyles.codeNumber];
      case "function":
      case "function-variable":
        return [markdownStyles.codeFunction];
      case "operator":
        return [markdownStyles.codeOperator];
      case "punctuation":
        return [markdownStyles.codePunctuation];
      case "class-name":
      case "builtin":
      case "type":
      case "namespace":
        return [markdownStyles.codeType];
      case "property":
      case "parameter":
        return [markdownStyles.codeProperty];
      case "tag":
        return [markdownStyles.codeTag];
      case "attr-name":
        return [markdownStyles.codeAttrName];
      case "attr-value":
        return [markdownStyles.codeAttrValue];
      case "bold":
        return [markdownStyles.codeImportant];
      default:
        return [];
    }
  });

  return resolvedStyles.length > 0 ? resolvedStyles : undefined;
}

function renderHighlightedCodeTokens(
  tokenStream: Prism.TokenStream,
  markdownStyles: any,
  keyPrefix: string,
): ReactNode[] {
  if (typeof tokenStream === "string") {
    return [tokenStream];
  }

  if (Array.isArray(tokenStream)) {
    return tokenStream.flatMap((token, index) =>
      renderHighlightedCodeTokens(token, markdownStyles, `${keyPrefix}-${index}`),
    );
  }

  return [
    <Text key={keyPrefix} style={getCodeTokenStyles(tokenStream, markdownStyles)}>
      {renderHighlightedCodeTokens(tokenStream.content, markdownStyles, `${keyPrefix}-content`)}
    </Text>,
  ];
}

function flattenReactNodes(children: ReactNode): ReactNode[] {
  if (Array.isArray(children)) {
    return children.flatMap((child) => flattenReactNodes(child));
  }
  if (children === null || children === undefined || typeof children === "boolean") {
    return [];
  }
  return [children];
}

function getTextLeafValue(node: ReactNode): string | null {
  if (typeof node === "string") {
    return node;
  }
  if (!isValidElement<MarkdownRenderElementProps>(node) || node.type !== Text) {
    return null;
  }

  const children = node.props.children;
  if (typeof children === "string") {
    return children;
  }
  if (Array.isArray(children) && children.length === 1 && typeof children[0] === "string") {
    return children[0];
  }
  return null;
}

function getUnderlineMarker(node: ReactNode): "open" | "close" | null {
  const value = getTextLeafValue(node);
  if (value === "<u>") {
    return "open";
  }
  if (value === "</u>") {
    return "close";
  }
  return null;
}

function normalizeUnderlineNodes(
  children: ReactNode,
  underlineStyle: TextStyle,
  keyPrefix: string,
): ReactNode[] {
  const flattenedChildren = flattenReactNodes(children);
  const normalizedChildren: ReactNode[] = [];
  let underlineBuffer: ReactNode[] | null = null;
  let openMarkerNode: ReactNode | null = null;

  flattenedChildren.forEach((child, index) => {
    const underlineMarker = getUnderlineMarker(child);
    const childKeyPrefix = `${keyPrefix}-${index}`;

    if (underlineMarker === "open" && underlineBuffer === null) {
      underlineBuffer = [];
      openMarkerNode = child;
      return;
    }

    if (underlineMarker === "close" && underlineBuffer !== null) {
      normalizedChildren.push(
        ...underlineBuffer.map((bufferedChild, bufferIndex) =>
          applyUnderlineToNode(
            bufferedChild,
            underlineStyle,
            `${childKeyPrefix}-underline-${bufferIndex}`,
          ),
        ),
      );
      underlineBuffer = null;
      openMarkerNode = null;
      return;
    }

    if (underlineBuffer !== null) {
      underlineBuffer.push(child);
      return;
    }

    normalizedChildren.push(normalizeMarkdownNode(child, underlineStyle, childKeyPrefix));
  });

  if (underlineBuffer !== null) {
    const trailingUnderlineBuffer = underlineBuffer as ReactNode[];
    if (openMarkerNode !== null) {
      normalizedChildren.push(
        normalizeMarkdownNode(openMarkerNode, underlineStyle, `${keyPrefix}-open`),
      );
    }

    normalizedChildren.push(
      ...trailingUnderlineBuffer.map((bufferedChild: ReactNode, bufferIndex: number) =>
        normalizeMarkdownNode(
          bufferedChild,
          underlineStyle,
          `${keyPrefix}-trailing-${bufferIndex}`,
        ),
      ),
    );
  }

  return normalizedChildren;
}

function normalizeMarkdownNode(
  node: ReactNode,
  underlineStyle: TextStyle,
  keyPrefix: string,
): ReactNode {
  if (node === null || node === undefined || typeof node === "boolean") {
    return null;
  }
  if (Array.isArray(node)) {
    return normalizeUnderlineNodes(node, underlineStyle, keyPrefix);
  }
  if (!isValidElement<MarkdownRenderElementProps>(node)) {
    return node;
  }

  return cloneElement(
    node,
    {
      key: node.key ?? keyPrefix,
    },
    normalizeUnderlineNodes(node.props.children, underlineStyle, `${keyPrefix}-children`),
  );
}

function applyUnderlineToNode(
  node: ReactNode,
  underlineStyle: TextStyle,
  keyPrefix: string,
): ReactNode {
  if (node === null || node === undefined || typeof node === "boolean") {
    return null;
  }
  if (Array.isArray(node)) {
    return normalizeUnderlineNodes(node, underlineStyle, keyPrefix).map((child, index) =>
      applyUnderlineToNode(child, underlineStyle, `${keyPrefix}-${index}`),
    );
  }
  if (typeof node === "string" || typeof node === "number") {
    return (
      <Text key={keyPrefix} style={underlineStyle}>
        {node}
      </Text>
    );
  }
  if (!isValidElement<MarkdownRenderElementProps>(node)) {
    return node;
  }

  const children = normalizeUnderlineNodes(
    node.props.children,
    underlineStyle,
    `${keyPrefix}-children`,
  );
  if (node.type === Text) {
    return cloneElement(
      node,
      {
        key: node.key ?? keyPrefix,
        style: node.props.style ? [node.props.style, underlineStyle] : underlineStyle,
      },
      children,
    );
  }

  return cloneElement(
    node,
    {
      key: node.key ?? keyPrefix,
    },
    children.map((child, index) =>
      applyUnderlineToNode(child, underlineStyle, `${keyPrefix}-${index}`),
    ),
  );
}

class ChatMarkdownRenderer extends Renderer {
  constructor(private readonly markdownStyles: any) {
    super();
  }

  override code(
    text: string,
    language?: string,
    _containerStyle?: ViewStyle,
    _textStyle?: TextStyle,
  ): ReactNode {
    const normalizedLanguage = language?.trim();
    const trimmedText = text.replace(/[\r\n]+$/u, "");
    const prismGrammar = getPrismGrammar(normalizedLanguage);
    const highlightedContent = prismGrammar
      ? renderHighlightedCodeTokens(
          Prism.tokenize(trimmedText, prismGrammar.grammar),
          this.markdownStyles,
          `${this.getKey()}-code`,
        )
      : trimmedText;

    return (
      <View key={this.getKey()} style={this.markdownStyles.codeBlock}>
        {normalizedLanguage ? (
          <View style={this.markdownStyles.codeHeader}>
            <Text style={this.markdownStyles.codeHeaderLabel}>{normalizedLanguage}</Text>
          </View>
        ) : null}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={this.markdownStyles.codeScroll}
          contentContainerStyle={this.markdownStyles.codeScrollContent}
        >
          <View style={this.markdownStyles.codeContent}>
            <Text style={this.markdownStyles.codeText}>{highlightedContent}</Text>
          </View>
        </ScrollView>
      </View>
    );
  }

  override codespan(text: string, styles?: TextStyle): ReactNode {
    return (
      <Text key={this.getKey()} style={[styles, this.markdownStyles.codespan]}>
        {text}
      </Text>
    );
  }
}

function getRendererConfig(styles: any, themeKey: string) {
  const cached = rendererCache.get(themeKey);
  if (cached) {
    return cached;
  }

  const markdownStyles = {
    text: styles.messageMarkdownText,
    paragraph: styles.messageMarkdownParagraph,
    link: styles.messageMarkdownLink,
    blockquote: styles.messageMarkdownBlockquote,
    h1: styles.messageMarkdownHeading1,
    h2: styles.messageMarkdownHeading2,
    h3: styles.messageMarkdownHeading3,
    h4: styles.messageMarkdownHeading4,
    h5: styles.messageMarkdownHeading5,
    h6: styles.messageMarkdownHeading6,
    codespan: styles.messageMarkdownCodespan,
    code: styles.messageMarkdownCode,
    hr: styles.messageMarkdownRule,
    list: styles.messageMarkdownList,
    li: styles.messageMarkdownListItem,
    table: styles.messageMarkdownTable,
    tableRow: styles.messageMarkdownTableRow,
    tableCell: styles.messageMarkdownTableCell,
    strong: styles.messageMarkdownStrong,
    em: styles.messageMarkdownEmphasis,
    strikethrough: styles.messageMarkdownStrikethrough,
  } satisfies MarkedStyles;

  const renderer = new ChatMarkdownRenderer({
    root: styles.messageMarkdownRoot,
    text: styles.messageMarkdownText,
    paragraph: styles.messageMarkdownParagraph,
    link: styles.messageMarkdownLink,
    blockquote: styles.messageMarkdownBlockquote,
    heading: styles.messageMarkdownHeading3,
    codespan: styles.messageMarkdownCodespan,
    codeBlock: styles.messageMarkdownCode,
    codeHeader: styles.messageMarkdownCodeHeader,
    codeHeaderLabel: styles.messageMarkdownCodeHeaderLabel,
    codeScroll: styles.messageMarkdownCodeScroll,
    codeScrollContent: styles.messageMarkdownCodeScrollContent,
    codeContent: styles.messageMarkdownCodeContent,
    codeText: styles.messageMarkdownCodeText,
    codeComment: styles.messageMarkdownCodeComment,
    codeKeyword: styles.messageMarkdownCodeKeyword,
    codeString: styles.messageMarkdownCodeString,
    codeNumber: styles.messageMarkdownCodeNumber,
    codeFunction: styles.messageMarkdownCodeFunction,
    codeOperator: styles.messageMarkdownCodeOperator,
    codePunctuation: styles.messageMarkdownCodePunctuation,
    codeType: styles.messageMarkdownCodeType,
    codeProperty: styles.messageMarkdownCodeProperty,
    codeTag: styles.messageMarkdownCodeTag,
    codeAttrName: styles.messageMarkdownCodeAttrName,
    codeAttrValue: styles.messageMarkdownCodeAttrValue,
    codeImportant: styles.messageMarkdownCodeImportant,
    rule: styles.messageMarkdownRule,
    list: styles.messageMarkdownList,
    listItem: styles.messageMarkdownListItem,
    table: styles.messageMarkdownTable,
    tableRow: styles.messageMarkdownTableRow,
    tableCell: styles.messageMarkdownTableCell,
    strong: styles.messageMarkdownStrong,
    emphasis: styles.messageMarkdownEmphasis,
    strikethrough: styles.messageMarkdownStrikethrough,
  });

  const nextValue = { markdownStyles, renderer };
  rendererCache.set(themeKey, nextValue);
  return nextValue;
}

const MarkdownMessageBody = memo(function MarkdownMessageBody({
  cacheKey,
  value,
}: {
  readonly cacheKey: string | null;
  readonly value: string;
}) {
  const { styles, theme } = useAppThemeContext();
  const { markdownStyles, renderer } = useMemo(
    () => getRendererConfig(styles, theme.key),
    [styles, theme.key],
  );
  const elements = useMarkdown(value, {
    colorScheme: "dark",
    renderer,
    styles: markdownStyles,
    theme: {
      colors: {
        background: theme.background,
        border: theme.border,
        code: theme.panelAlt,
        link: theme.accent,
        text: theme.text,
      },
    },
  });
  const normalizedElements = useMemo(
    () => normalizeUnderlineNodes(elements, styles.messageMarkdownUnderline, "markdown"),
    [elements, styles.messageMarkdownUnderline],
  );

  useEffect(() => {
    if (cacheKey) {
      writeMarkdownRenderCache(cacheKey, normalizedElements);
    }
  }, [cacheKey, normalizedElements]);

  return <View style={styles.messageMarkdownRoot}>{normalizedElements}</View>;
});

export const CachedMarkdownMessage = memo(function CachedMarkdownMessage({
  cacheKey,
  value,
}: {
  readonly cacheKey: string | null;
  readonly value: string;
}) {
  const { styles } = useAppThemeContext();
  const cachedElements = cacheKey ? readMarkdownRenderCache(cacheKey) : null;

  if (cachedElements) {
    return <View style={styles.messageMarkdownRoot}>{cachedElements}</View>;
  }

  return <MarkdownMessageBody cacheKey={cacheKey} value={value} />;
});

export function getMessageMarkdownCacheKey(input: {
  readonly messageId: string;
  readonly themeKey: string;
  readonly updatedAt: string;
}) {
  return getMarkdownRenderCacheKey(input);
}

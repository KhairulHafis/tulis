// Tulis promises writers that nothing leaves their machine. This helper finds
// code that could use the network, so the network guard test can block it.
import ts from "typescript";

export interface NetworkUse {
  line: number; // 1-based
  column: number; // 1-based
  what: string;
}

const NETWORK_MODULES: readonly string[] = [
  "http",
  "https",
  "http2",
  "net",
  "tls",
  "dgram",
  "dns",
  "undici",
];

const NETWORK_GLOBALS: readonly string[] = ["fetch", "WebSocket"];

const GLOBAL_OBJECTS: readonly string[] = [
  "globalThis",
  "global",
  "self",
  "window",
];

function scriptKindFor(fileName: string): ts.ScriptKind {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (lower.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (
    lower.endsWith(".js") ||
    lower.endsWith(".mjs") ||
    lower.endsWith(".cjs")
  ) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function isNetworkModule(name: string): boolean {
  const bare = name.startsWith("node:") ? name.slice("node:".length) : name;
  return NETWORK_MODULES.some(
    (module) => bare === module || bare.startsWith(`${module}/`),
  );
}

function stringValue(node: ts.Node): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return undefined;
}

type CallKind = "require" | "import" | "getBuiltinModule";

function callKind(call: ts.CallExpression): CallKind | undefined {
  const callee = call.expression;
  if (callee.kind === ts.SyntaxKind.ImportKeyword) return "import";
  if (ts.isIdentifier(callee) && callee.text === "require") return "require";
  if (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === "process" &&
    callee.name.text === "getBuiltinModule"
  ) {
    return "getBuiltinModule";
  }
  return undefined;
}

function isGlobalObject(node: ts.Node): boolean {
  return ts.isIdentifier(node) && GLOBAL_OBJECTS.includes(node.text);
}

// Strict on purpose: any identifier named like a network global is reported,
// even a local function called `fetch`. Only `obj.fetch` on other objects
// (for example `git.fetch()`) is allowed.
function isNetworkGlobalIdentifier(node: ts.Identifier): boolean {
  if (!NETWORK_GLOBALS.includes(node.text)) return false;
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
    return isGlobalObject(parent.expression);
  }
  return true;
}

function isNetworkGlobalElementAccess(
  node: ts.ElementAccessExpression,
): string | undefined {
  if (!isGlobalObject(node.expression)) return undefined;
  const key = stringValue(node.argumentExpression);
  if (key !== undefined && NETWORK_GLOBALS.includes(key)) return key;
  return undefined;
}

function describeModule(node: ts.Node): string | undefined {
  const name = stringValue(node);
  if (name !== undefined && isNetworkModule(name)) {
    return `imports "${name}"`;
  }
  return undefined;
}

function describeCall(call: ts.CallExpression): string | undefined {
  const kind = callKind(call);
  if (kind === undefined) return undefined;
  const argument = call.arguments[0];
  if (argument === undefined) return undefined;
  if (stringValue(argument) === undefined) {
    return `computed module name in ${kind}`;
  }
  return describeModule(argument);
}

function describeNode(node: ts.Node): string | undefined {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    return node.moduleSpecifier
      ? describeModule(node.moduleSpecifier)
      : undefined;
  }
  if (
    ts.isImportEqualsDeclaration(node) &&
    ts.isExternalModuleReference(node.moduleReference)
  ) {
    return describeModule(node.moduleReference.expression);
  }
  if (ts.isCallExpression(node)) return describeCall(node);
  if (ts.isIdentifier(node) && isNetworkGlobalIdentifier(node)) {
    return `uses global "${node.text}"`;
  }
  // `createRequire` makes a require function under any name, which the
  // guard can't follow, so any use of it is reported.
  if (ts.isIdentifier(node) && node.text === "createRequire") {
    return "uses createRequire";
  }
  if (ts.isElementAccessExpression(node)) {
    const key = isNetworkGlobalElementAccess(node);
    if (key !== undefined) return `uses global "${key}"`;
  }
  return undefined;
}

export function findNetworkUse(
  fileName: string,
  sourceText: string,
): NetworkUse[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(fileName),
  );
  const found: NetworkUse[] = [];

  const visit = (node: ts.Node): void => {
    const what = describeNode(node);
    if (what !== undefined) {
      const position = sourceFile.getLineAndCharacterOfPosition(
        node.getStart(sourceFile),
      );
      found.push({
        line: position.line + 1,
        column: position.character + 1,
        what,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

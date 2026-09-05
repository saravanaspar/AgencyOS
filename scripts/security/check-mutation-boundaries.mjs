#!/usr/bin/env node
import { readFile, readdir } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import process from "node:process";

import ts from "typescript";

const MUTATION_ROUTE_EXPORTS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const ZOD_PARSE_METHODS = new Set(["parse", "parseAsync", "safeParse", "safeParseAsync"]);
const REQUEST_BODY_METHODS = new Set(["arrayBuffer", "blob", "formData", "json", "text"]);
const MUTATION_CALL_PREFIX =
  /^(?:acknowledge|adjust|archive|assign|attach|cancel|close|complete|convert|create|decide|delete|dispose|execute|fulfill|generate|import|insert|issue|mark|move|pause|process|publish|qualify|reassign|reconcile|record|remove|reset|retire|return|revoke|rotate|run|save|send|set|submit|sync|toggle|update|upload|upsert|withdraw)/i;

function parseArguments(argv) {
  const options = { root: process.cwd(), policy: null, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") {
      options.json = true;
      continue;
    }
    if (argument === "--root" || argument === "--policy") {
      const value = argv[index + 1];
      if (!value) throw new Error(`${argument} requires a path.`);
      options[argument.slice(2)] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  options.root = resolve(options.root);
  options.policy = resolve(options.root, options.policy ?? "security/mutation-boundaries.json");
  return options;
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (new Set([".ts", ".tsx"]).has(extname(entry.name))) files.push(path);
  }
  return files;
}

function hasExportModifier(node) {
  return Boolean(node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
}

function hasUseServerDirective(sourceFile) {
  return sourceFile.statements.some(
    (statement) =>
      ts.isExpressionStatement(statement) &&
      ts.isStringLiteral(statement.expression) &&
      statement.expression.text === "use server",
  );
}

function declaredFunction(statement) {
  if (ts.isFunctionDeclaration(statement) && statement.name) {
    return {
      name: statement.name.text,
      parameters: statement.parameters,
      body: statement.body ?? null,
      node: statement,
    };
  }
  return null;
}

function declaredVariableFunctions(statement) {
  if (!ts.isVariableStatement(statement)) return [];
  return statement.declarationList.declarations.flatMap((declaration) => {
    if (!ts.isIdentifier(declaration.name)) return [];
    const callable =
      declaration.initializer &&
      (ts.isArrowFunction(declaration.initializer) ||
        ts.isFunctionExpression(declaration.initializer))
        ? declaration.initializer
        : null;
    return [
      {
        name: declaration.name.text,
        parameters: callable?.parameters ?? [],
        body: callable?.body ?? null,
        node: declaration,
      },
    ];
  });
}

function bindingNames(name) {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) =>
    ts.isOmittedExpression(element) ? [] : bindingNames(element.name),
  );
}

function mergeSources(target, incoming) {
  let changed = false;
  for (const source of incoming) {
    if (target.has(source)) continue;
    target.add(source);
    changed = true;
  }
  return changed;
}

function collectSources(node, taints) {
  const sources = new Set();
  function visit(current) {
    if (ts.isIdentifier(current)) mergeSources(sources, taints.get(current.text) ?? []);
    ts.forEachChild(current, visit);
  }
  visit(node);
  return sources;
}

function collectTaints(body, seedTaints) {
  const taints = new Map(
    [...seedTaints.entries()].map(([name, sources]) => [name, new Set(sources)]),
  );
  const declarations = [];
  const assignments = [];
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.initializer) declarations.push(node);
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left)
    ) {
      assignments.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(body);

  let changed = true;
  while (changed) {
    changed = false;
    for (const declaration of declarations) {
      const sources = collectSources(declaration.initializer, taints);
      if (!sources.size) continue;
      for (const name of bindingNames(declaration.name)) {
        const target = taints.get(name) ?? new Set();
        if (mergeSources(target, sources)) changed = true;
        taints.set(name, target);
      }
    }
    for (const assignment of assignments) {
      const sources = collectSources(assignment.right, taints);
      if (!sources.size) continue;
      const target = taints.get(assignment.left.text) ?? new Set();
      if (mergeSources(target, sources)) changed = true;
      taints.set(assignment.left.text, target);
    }
  }
  return taints;
}

function propertyName(expression) {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isIdentifier(expression)) return expression.text;
  return null;
}

function isAwaited(call) {
  let current = call.parent;
  while (
    current &&
    (ts.isParenthesizedExpression(current) ||
      ts.isPropertyAccessExpression(current) ||
      ts.isCallExpression(current))
  ) {
    current = current.parent;
  }
  return Boolean(current && ts.isAwaitExpression(current));
}

function isExplicitlyDiscarded(identifier) {
  let current = identifier;
  while (current.parent && ts.isParenthesizedExpression(current.parent)) current = current.parent;
  return Boolean(current.parent && ts.isVoidExpression(current.parent));
}

function hasMeaningfulReference(body, name) {
  let found = false;
  function visit(node) {
    if (found) return;
    if (ts.isIdentifier(node) && node.text === name && !isExplicitlyDiscarded(node)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(body);
  return found;
}

function inspectFunction(boundary, sourceFile) {
  const seedTaints = new Map();
  const actionSources = [];
  const previousStateSources = [];
  const requestSources = [];
  const contextSources = [];

  for (const [index, parameter] of boundary.parameters.entries()) {
    const names = bindingNames(parameter.name);
    const labelName = ts.isIdentifier(parameter.name)
      ? parameter.name.text
      : `parameter-${index + 1}`;
    const type = parameter.type?.getText(sourceFile) ?? "";
    if (boundary.kind === "action" && /\bFormData\b/.test(type)) {
      const source = `form-data:${labelName}`;
      actionSources.push(source);
      for (const name of names) seedTaints.set(name, new Set([source]));
    } else if (boundary.kind === "action") {
      const source = `action-input:${labelName}`;
      const isPreviousState =
        ts.isIdentifier(parameter.name) &&
        /^_?previous(?:State)?$/i.test(parameter.name.text) &&
        /\b[A-Za-z][A-Za-z0-9]*ActionState\b/.test(type);
      if (isPreviousState) previousStateSources.push({ source, name: parameter.name.text });
      else actionSources.push(source);
      for (const name of names) seedTaints.set(name, new Set([source]));
    } else if (boundary.kind === "route" && /\b(?:NextRequest|Request)\b/.test(type)) {
      const source = `request:${labelName}`;
      requestSources.push(source);
      for (const name of names) seedTaints.set(name, new Set([source]));
    } else if (boundary.kind === "route") {
      const source = `route-params:${labelName}`;
      contextSources.push(source);
      for (const name of names) seedTaints.set(name, new Set([source]));
    }
  }

  const taints = collectTaints(boundary.body, seedTaints);
  const requiredSources = new Set([...actionSources, ...contextSources]);
  for (const previous of previousStateSources) {
    if (hasMeaningfulReference(boundary.body, previous.name)) {
      requiredSources.add(previous.source);
    }
  }
  const validations = [];
  let firstMutationPosition = Number.POSITIVE_INFINITY;

  function visit(node) {
    if (ts.isPropertyAccessExpression(node) && node.name.text === "params") {
      const sources = collectSources(node.expression, taints);
      for (const source of contextSources) {
        if (sources.has(source)) requiredSources.add(source);
      }
    }

    if (ts.isCallExpression(node)) {
      const name = propertyName(node.expression);
      const argumentSources = new Set();
      for (const argument of node.arguments) {
        mergeSources(argumentSources, collectSources(argument, taints));
      }

      if (name && ZOD_PARSE_METHODS.has(name)) {
        validations.push({
          position: node.getStart(sourceFile),
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
          method: name,
          sources: [...argumentSources].sort(),
        });
      }

      if (
        name &&
        REQUEST_BODY_METHODS.has(name) &&
        ts.isPropertyAccessExpression(node.expression)
      ) {
        const receiverSources = collectSources(node.expression.expression, taints);
        for (const source of requestSources) {
          if (receiverSources.has(source)) requiredSources.add(source);
        }
      }
      if (name?.startsWith("readBoundedRequest") && node.arguments[0]) {
        const sources = collectSources(node.arguments[0], taints);
        for (const source of requestSources) {
          if (sources.has(source)) requiredSources.add(source);
        }
      }

      if (
        name &&
        !ZOD_PARSE_METHODS.has(name) &&
        MUTATION_CALL_PREFIX.test(name) &&
        isAwaited(node)
      ) {
        firstMutationPosition = Math.min(firstMutationPosition, node.getStart(sourceFile));
      }
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword &&
      node.right.getText(sourceFile) === "File"
    ) {
      const sources = collectSources(node.left, taints);
      if (sources.size) {
        validations.push({
          position: node.getStart(sourceFile),
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
          method: "instanceof File",
          sources: [...sources].sort(),
        });
      }
    }

    if (ts.isTaggedTemplateExpression(node)) {
      const sql = node.template.getText(sourceFile);
      if (/\b(?:delete\s+from|insert\s+into|update)\b/i.test(sql)) {
        firstMutationPosition = Math.min(firstMutationPosition, node.getStart(sourceFile));
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(boundary.body);

  const coveredSources = new Set();
  for (const validation of validations) {
    if (validation.position >= firstMutationPosition) continue;
    mergeSources(coveredSources, validation.sources);
  }
  const uncoveredSources = [...requiredSources].filter((source) => !coveredSources.has(source));
  return {
    ...boundary,
    inputSources: [...requiredSources].sort(),
    validations,
    mutationLine: Number.isFinite(firstMutationPosition)
      ? sourceFile.getLineAndCharacterOfPosition(firstMutationPosition).line + 1
      : null,
    uncoveredSources,
  };
}

function boundaryKind(name, useServer, isRoute) {
  if (useServer && name.endsWith("Action")) return "action";
  if (isRoute && MUTATION_ROUTE_EXPORTS.has(name)) return "route";
  return null;
}

function uninspectableBoundary({ kind, relativePath, exportName, line }) {
  return {
    id: `${kind}:${relativePath}#${exportName}`,
    kind,
    path: relativePath,
    exportName,
    line,
    inputSources: ["uninspectable-export"],
    validations: [],
    mutationLine: null,
    uncoveredSources: ["uninspectable-export"],
    uninspectable: true,
  };
}

function sourceBoundaries(path, source, root) {
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const relativePath = relative(root, path).replaceAll("\\", "/");
  const useServer = hasUseServerDirective(sourceFile);
  const isRoute = /(?:^|\/)route\.tsx?$/.test(relativePath);
  const boundaries = [];

  for (const statement of sourceFile.statements) {
    if (hasExportModifier(statement)) {
      const declaration = declaredFunction(statement);
      const functions = [
        ...(declaration ? [declaration] : []),
        ...declaredVariableFunctions(statement),
      ];
      for (const fn of functions) {
        const kind = boundaryKind(fn.name, useServer, isRoute);
        if (!kind) continue;
        const line =
          sourceFile.getLineAndCharacterOfPosition(fn.node.getStart(sourceFile)).line + 1;
        if (!fn.body) {
          boundaries.push(uninspectableBoundary({ kind, relativePath, exportName: fn.name, line }));
          continue;
        }
        boundaries.push(
          inspectFunction(
            {
              id: `${kind}:${relativePath}#${fn.name}`,
              kind,
              path: relativePath,
              exportName: fn.name,
              line,
              parameters: fn.parameters,
              body: fn.body,
            },
            sourceFile,
          ),
        );
      }
    }

    if (!ts.isExportDeclaration(statement) || statement.isTypeOnly) continue;
    const line = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile)).line + 1;
    if (!statement.exportClause) {
      if (isRoute) {
        boundaries.push(
          uninspectableBoundary({ kind: "route", relativePath, exportName: "*", line }),
        );
      } else if (useServer) {
        boundaries.push(
          uninspectableBoundary({ kind: "action", relativePath, exportName: "*", line }),
        );
      }
      continue;
    }
    if (!ts.isNamedExports(statement.exportClause)) continue;
    for (const element of statement.exportClause.elements) {
      if (element.isTypeOnly) continue;
      const exportName = element.name.text;
      const kind = boundaryKind(exportName, useServer, isRoute);
      if (!kind) continue;
      boundaries.push(uninspectableBoundary({ kind, relativePath, exportName, line }));
    }
  }

  const unique = new Map();
  for (const boundary of boundaries) {
    const existing = unique.get(boundary.id);
    if (!existing || (existing.uninspectable && !boundary.uninspectable)) {
      unique.set(boundary.id, boundary);
    }
  }
  return [...unique.values()];
}

function publicBoundary(boundary) {
  return {
    id: boundary.id,
    kind: boundary.kind,
    path: boundary.path,
    exportName: boundary.exportName,
    line: boundary.line,
    inputSources: boundary.inputSources,
    validations: boundary.validations.map(({ line, method, sources }) => ({
      line,
      method,
      sources,
    })),
    mutationLine: boundary.mutationLine,
    uncoveredSources: boundary.uncoveredSources,
    status: boundary.status,
    uninspectable: Boolean(boundary.uninspectable),
    exceptionReason: boundary.exceptionReason,
  };
}

function validateAllowlist(rawPolicy) {
  if (!rawPolicy || rawPolicy.version !== 1 || !Array.isArray(rawPolicy.allowlist)) {
    throw new Error("Mutation-boundary policy must have version 1 and an allowlist array.");
  }
  const entries = new Map();
  for (const entry of rawPolicy.allowlist) {
    if (
      !entry ||
      typeof entry.boundary !== "string" ||
      typeof entry.reason !== "string" ||
      entry.reason.trim().length < 40
    ) {
      throw new Error(
        "Every mutation-boundary allowlist entry needs a boundary and precise reason.",
      );
    }
    if (entries.has(entry.boundary)) {
      throw new Error(`Duplicate mutation-boundary allowlist entry: ${entry.boundary}`);
    }
    entries.set(entry.boundary, entry.reason.trim());
  }
  return entries;
}

async function inventory(options) {
  const [policyText, files] = await Promise.all([
    readFile(options.policy, "utf8"),
    walk(resolve(options.root, "src")),
  ]);
  const allowlist = validateAllowlist(JSON.parse(policyText));
  const boundaries = [];
  for (const path of files.sort()) {
    const source = await readFile(path, "utf8");
    boundaries.push(...sourceBoundaries(path, source, options.root));
  }
  boundaries.sort((left, right) => left.id.localeCompare(right.id));

  const matchedAllowlist = new Set();
  for (const boundary of boundaries) {
    const reason = allowlist.get(boundary.id);
    if (reason && (boundary.inputSources.length === 0 || boundary.uncoveredSources.length > 0)) {
      boundary.status = "allowlisted";
      boundary.exceptionReason = reason;
      matchedAllowlist.add(boundary.id);
    } else if (boundary.inputSources.length === 0) boundary.status = "no-untrusted-input";
    else if (boundary.uncoveredSources.length === 0) boundary.status = "validated";
    else boundary.status = "uncovered";
  }

  const staleAllowlist = [...allowlist.keys()].filter((id) => !matchedAllowlist.has(id)).sort();
  const uncovered = boundaries.filter((boundary) => boundary.status === "uncovered");
  const summary = {
    total: boundaries.length,
    actions: boundaries.filter((boundary) => boundary.kind === "action").length,
    routes: boundaries.filter((boundary) => boundary.kind === "route").length,
    validated: boundaries.filter((boundary) => boundary.status === "validated").length,
    noUntrustedInput: boundaries.filter((boundary) => boundary.status === "no-untrusted-input")
      .length,
    allowlisted: boundaries.filter((boundary) => boundary.status === "allowlisted").length,
    uncovered: uncovered.length,
  };
  return {
    policy: relative(options.root, options.policy).replaceAll("\\", "/"),
    summary,
    boundaries: boundaries.map(publicBoundary),
    staleAllowlist,
    ok: uncovered.length === 0 && staleAllowlist.length === 0,
  };
}

function printFailure(result) {
  console.error("Mutation-boundary audit failed.");
  for (const boundary of result.boundaries.filter((item) => item.status === "uncovered")) {
    console.error(
      ` - ${boundary.id} (line ${boundary.line}) lacks pre-mutation validation for ${boundary.uncoveredSources.join(", ")}.`,
    );
  }
  for (const id of result.staleAllowlist) {
    console.error(` - ${id} is a stale or unnecessary allowlist entry; remove it.`);
  }
  console.error(
    "Validate every caller-controlled source with a Zod parse before mutation, or document a narrowly delegated boundary in the policy.",
  );
}

const options = parseArguments(process.argv.slice(2));
const result = await inventory(options);
if (options.json) console.log(JSON.stringify(result, null, 2));
else if (result.ok) {
  console.log(
    `Mutation-boundary audit OK: ${result.summary.total} boundaries (${result.summary.actions} server actions, ${result.summary.routes} mutation routes); ${result.summary.validated} validated, ${result.summary.noUntrustedInput} without caller input, ${result.summary.allowlisted} narrowly allowlisted.`,
  );
} else printFailure(result);
if (!result.ok) process.exitCode = 1;

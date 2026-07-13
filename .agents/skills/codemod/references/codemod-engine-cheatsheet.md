# Codemod Engine Cheatsheet

Quick reference for ts-morph and jscodeshift dry-run and apply commands.

---

## ts-morph (TypeScript — type-aware)

### Install
```bash
npm install --save-dev ts-morph
# or one-off via npx ts-node
```

### Inline script skeleton (dry-run)

```typescript
// scripts/codemod-rename.ts
import { Project } from "ts-morph";

const DRY_RUN = process.argv.includes("--dry-run");
const project = new Project({ tsConfigFilePath: "tsconfig.json" });

for (const sourceFile of project.getSourceFiles("src/**/*.ts")) {
  const identifiers = sourceFile.getDescendantsOfKind(/* SyntaxKind.Identifier */ 79);
  for (const id of identifiers) {
    if (id.getText() === "OLD_NAME") {
      if (DRY_RUN) {
        console.log(`[dry] ${sourceFile.getFilePath()}:${id.getStartLineNumber()} — rename OLD_NAME → NEW_NAME`);
      } else {
        id.replaceWithText("NEW_NAME");
      }
    }
  }
}

if (!DRY_RUN) {
  project.saveSync();
  console.log("Done. Run `git diff` to review.");
}
```

Run:
```bash
# dry-run
npx ts-node scripts/codemod-rename.ts --dry-run

# apply
npx ts-node scripts/codemod-rename.ts
git diff   # inspect before commit
```

### Rename exported declaration (safest — scope-aware)

```typescript
import { Project, SyntaxKind } from "ts-morph";

const project = new Project({ tsConfigFilePath: "tsconfig.json" });
const sourceFile = project.getSourceFileOrThrow("src/utils/fetch.ts");
const fn = sourceFile.getFunctionOrThrow("fetchUser");

// Rename symbol + all references across project
fn.rename("getUser");  // ts-morph resolves references through type graph

if (!process.argv.includes("--dry-run")) {
  project.saveSync();
}
```

### Change import path across project

```typescript
import { Project } from "ts-morph";

const OLD = "@old/utils";
const NEW = "@new/utils";
const DRY = process.argv.includes("--dry-run");
const project = new Project({ tsConfigFilePath: "tsconfig.json" });

for (const sf of project.getSourceFiles()) {
  for (const decl of sf.getImportDeclarations()) {
    if (decl.getModuleSpecifierValue() === OLD) {
      if (DRY) {
        console.log(`[dry] ${sf.getFilePath()} — rewrite import "${OLD}" → "${NEW}"`);
      } else {
        decl.setModuleSpecifier(NEW);
      }
    }
  }
}

if (!DRY) project.saveSync();
```

---

## jscodeshift (JavaScript / JSX / light TS)

### Install
```bash
npm install --save-dev jscodeshift
```

### Flags
| Flag | Effect |
|---|---|
| `-d` / `--dry` | Dry-run: print what would change, write nothing |
| `-p` / `--print` | Print transformed source to stdout (combine with `-d` for preview) |
| `--parser babel` | Default JS parser |
| `--parser tsx` | For `.tsx` files |
| `--parser ts` | For `.ts` files |
| `--extensions ts,tsx` | File extensions to process |

### Dry-run then apply

```bash
# dry-run + print diff
npx jscodeshift --dry --print -t transforms/rename-import.js src/

# apply
npx jscodeshift -t transforms/rename-import.js src/
git diff   # inspect before commit
```

### Transform skeleton — rename import specifier

```javascript
// transforms/rename-import.js
module.exports = function(fileInfo, api) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);

  root
    .find(j.ImportDeclaration, { source: { value: "@old/utils" } })
    .forEach(path => {
      path.node.source.value = "@new/utils";
    });

  return root.toSource();
};
```

### Transform skeleton — rename exported identifier

```javascript
// transforms/rename-identifier.js
const OLD = "fetchUser";
const NEW = "getUser";

module.exports = function(fileInfo, api) {
  const j = api.jscodeshift;
  return j(fileInfo.source)
    .find(j.Identifier, { name: OLD })
    .replaceWith(() => j.identifier(NEW))
    .toSource();
};
```

> **Warning:** jscodeshift identifier rename is NOT scope-aware — it will match any identifier named `OLD` in the file (local vars, params, etc.). Prefer ts-morph for TS codebases when scope matters.

---

## Idempotency guard pattern

Always check if the transform was already applied before writing:

```javascript
// jscodeshift
module.exports = function(fileInfo, api) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);

  const alreadyMigrated = root.find(j.ImportDeclaration, { source: { value: "@new/utils" } }).length > 0;
  if (alreadyMigrated) return fileInfo.source; // no-op

  // ... apply transform
};
```

```typescript
// ts-morph
if (decl.getModuleSpecifierValue() === NEW) continue; // already patched
```

---

## Git diff review after dry-run

```bash
# After applying, review before staging:
git diff --stat          # summary of changed files
git diff                 # full diff
git diff src/utils/      # scope to a subtree

# Revert all if something looks wrong:
git checkout -- .
```

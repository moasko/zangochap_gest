// Génère docs/CODE_INDEX.md : arbre des fichiers suivis + symboles exportés (fichier:ligne).
// Lecture seule du dépôt ; n'écrit que docs/CODE_INDEX.md. Usage : node scripts/gen-code-index.mjs
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const SKIP = /^(public|scratch|memory|docs|\.vscode)\/|package-lock\.json$|\.(css|sql|json|md)$/;
const CODE = /\.(ts|tsx|mjs|cjs|prisma)$/;
// Gros fichiers pour lesquels on liste aussi les fonctions/composants internes.
const OUTLINE_MIN_LINES = 1500;

const files = execSync("git ls-files --cached --others --exclude-standard", { encoding: "utf8" })
  .split("\n")
  .filter((f) => f && !SKIP.test(f) && CODE.test(f));

const EXPORT_RE =
  /^export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|class|type|interface|enum)\s+([A-Za-z0-9_$]+)/;
const REEXPORT_RE = /^export\s+(?:\*|\{[^}]*\})\s+from\s+["']([^"']+)["']/;
const INTERNAL_RE = /^(?:async\s+)?function\s+([A-Za-z0-9_$]+)|^const\s+([A-Z][A-Za-z0-9_$]+)\s*=\s*(?:\(|React\.memo|memo)/;
const HANDLER_RE = /^ {2,4}(?:const\s+([A-Za-z0-9_$]+)\s*=\s*(?:useCallback\(|async\s*\(|\([^)]*\)\s*=>)|(?:async\s+)?function\s+([A-Za-z0-9_$]+))/;
const JSX_SECTION_RE = /^\s*\{\/\*\s*([A-Z][A-Z0-9 :&/'-]{3,60})\s*\*\/\}\s*$/;
const PRISMA_RE = /^(model|enum)\s+(\w+)/;

function describe(file) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const flags = [];
  const head = lines.slice(0, 5).join("\n");
  if (/^["']use server["']/m.test(head)) flags.push("server");
  if (/^["']use client["']/m.test(head)) flags.push("client");
  const syms = [];
  const reexports = [];
  const internals = [];
  lines.forEach((l, i) => {
    let m;
    if (file.endsWith(".prisma")) {
      if ((m = PRISMA_RE.exec(l))) syms.push(`${m[2]}:${i + 1}`);
      return;
    }
    if ((m = EXPORT_RE.exec(l))) syms.push(`${m[1]}:${i + 1}`);
    else if ((m = REEXPORT_RE.exec(l))) reexports.push(m[1]);
    else if (lines.length < OUTLINE_MIN_LINES) return;
    else if ((m = INTERNAL_RE.exec(l))) internals.push(`**${m[1] || m[2]}**:${i + 1}`);
    else if ((m = HANDLER_RE.exec(l))) internals.push(`${m[1] || m[2]}:${i + 1}`);
    else if ((m = JSX_SECTION_RE.exec(l))) internals.push(`«${m[1].trim()}»:${i + 1}`);
  });
  return { n: lines.length, flags, syms, reexports, internals };
}

const byDir = new Map();
for (const f of files) {
  const i = f.lastIndexOf("/");
  const dir = i < 0 ? "." : f.slice(0, i);
  if (!byDir.has(dir)) byDir.set(dir, []);
  byDir.get(dir).push(f);
}

const out = [
  "# Index du code (généré)",
  "",
  "> Généré par `node scripts/gen-code-index.mjs` — ne pas éditer à la main, régénérer après ajout/déplacement de fichiers.",
  "> Format : `fichier` (lignes) [server|client] — symboles exportés `nom:ligne`. Les lignes sont indicatives : confirmer avec Grep avant édition.",
  "> Gros fichiers (≥ " + OUTLINE_MIN_LINES + " lignes) : plan interne (**composant**, handler, «SECTION JSX») ; lire uniquement la plage utile (Read offset/limit).",
  "> CSS, SQL, JSON, Markdown, `public/`, `scratch/` exclus. Contexte métier : `docs/PROJECT_MAP.md`.",
  "",
];

let total = 0;
for (const dir of [...byDir.keys()].sort()) {
  out.push(`## ${dir}/`, "");
  for (const f of byDir.get(dir).sort()) {
    const d = describe(f);
    total += d.n;
    const name = f.slice(dir === "." ? 0 : dir.length + 1);
    let line = `- \`${name}\` (${d.n})${d.flags.length ? " [" + d.flags.join(",") + "]" : ""}`;
    if (d.syms.length) line += " — " + d.syms.join(", ");
    if (d.reexports.length) line += " — réexporte " + d.reexports.join(", ");
    out.push(line);
    if (d.internals.length) out.push(`  - plan interne : ${d.internals.join(", ")}`);
  }
  out.push("");
}
out.splice(6, 0, `${files.length} fichiers de code, ${total} lignes.`, "");

writeFileSync("docs/CODE_INDEX.md", out.join("\n"));
console.log(`docs/CODE_INDEX.md : ${files.length} fichiers, ${total} lignes`);

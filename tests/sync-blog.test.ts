import { execFile as execFileCallback } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, test } from "vitest";
import { referencesRoot } from "../extensions/knowledge.ts";
import {
  buildSnapshot,
  compareCatalogs,
  formatChanges,
  parseArgs,
  readSourceProvenance,
  validateSeriesCatalog,
} from "../scripts/sync-blog.mjs";

const execFile = promisify(execFileCallback);
const temporaryDirectories: string[] = [];
const scriptPath = join(import.meta.dirname, "../scripts/sync-blog.mjs");

async function writeSourceFixture(root: string): Promise<void> {
  await mkdir(join(root, "blog/2024"), { recursive: true });
  await mkdir(join(root, "docs/2023"), { recursive: true });
  await writeFile(
    join(root, "blog/2024/01-02-note.md"),
    "---\ntitle: A note\ntags:\n  - Kubernetes\n---\n\nNote body.\n",
  );
  await writeFile(
    join(root, "docs/2023/article.md"),
    "---\ntitle: An article\nauthor: hwchiu\n---\n\nArticle body.\n",
  );
}

async function temporarySource(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi-hwchiu-sync-"));
  temporaryDirectories.push(root);
  await writeSourceFixture(root);
  return root;
}

async function initializeGit(root: string): Promise<void> {
  await execFile("git", ["init"], { cwd: root });
  await execFile("git", ["add", "blog", "docs"], { cwd: root });
  await execFile(
    "git",
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.com",
      "commit",
      "-m",
      "fixture",
    ],
    { cwd: root },
  );
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

test("sync CLI parsing preserves positional source paths and rejects unknown options", () => {
  expect(parseArgs(["--check", "fixture"])).toMatchObject({ check: true });
  expect(parseArgs(["fixture"]).sourceRoot).toMatch(/fixture$/);
  expect(() => parseArgs(["--unknown"])).toThrow("Unknown option");
  expect(() => parseArgs(["one", "two"])).toThrow("Only one source");
});

test("snapshot generation records deterministic digests and unknown fallback provenance", async () => {
  const root = await temporarySource();
  const snapshot = await buildSnapshot(root);

  expect(snapshot.catalog).toMatchObject({
    schemaVersion: 2,
    sourceRevision: "unknown",
    sourceRevisionDate: "unknown",
    counts: { blog: 1, docs: 1, total: 2 },
  });
  expect(
    snapshot.catalog.articles.every(
      (article) => article.contentDigest.length === 64,
    ),
  ).toBe(true);
  expect(
    snapshot.catalog.articles.every((article) =>
      article.sourceUrl.includes("/blob/main/"),
    ),
  ).toBe(true);
  expect((await buildSnapshot(root)).catalogText).toBe(snapshot.catalogText);
});

test("Git provenance is read only from a clean source repository root", async () => {
  const root = await temporarySource();
  await initializeGit(root);

  const provenance = await readSourceProvenance(root);
  expect(provenance.sourceRevision).toMatch(/^[a-f0-9]{40}$/);
  expect(provenance.sourceRevisionDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);

  await writeFile(join(root, "blog/2024/01-02-note.md"), "dirty content\n");
  await expect(readSourceProvenance(root)).rejects.toThrow(
    "must have clean blog/ and docs/ trees",
  );

  await execFile("git", ["restore", "blog/2024/01-02-note.md"], { cwd: root });
  await writeFile(join(root, "docs/2023/untracked.md"), "untracked content\n");
  await expect(readSourceProvenance(root)).rejects.toThrow(
    "must have clean blog/ and docs/ trees",
  );
});

test("nested source directories are not attributed to an enclosing repository", async () => {
  const repository = await mkdtemp(join(tmpdir(), "pi-hwchiu-parent-git-"));
  temporaryDirectories.push(repository);
  const sourceRoot = join(repository, "source");
  await writeSourceFixture(sourceRoot);
  await execFile("git", ["init"], { cwd: repository });

  await expect(readSourceProvenance(sourceRoot)).resolves.toEqual({
    sourceRevision: "unknown",
    sourceRevisionDate: "unknown",
  });
});

test("catalog comparison reports deterministic added, removed, and modified paths", async () => {
  const changes = await compareCatalogs(
    {
      articles: [
        { path: "removed.md", contentDigest: "old" },
        { path: "modified.md", contentDigest: "old" },
      ],
    },
    {
      articles: [
        { path: "modified.md", contentDigest: "new" },
        { path: "added.md", contentDigest: "new" },
      ],
    },
  );

  expect(changes).toEqual({
    added: ["added.md"],
    removed: ["removed.md"],
    modified: ["modified.md"],
  });
  expect(formatChanges(changes)).toBe(
    "Added: 1\n  - added.md\nRemoved: 1\n  - removed.md\nModified: 1\n  - modified.md",
  );
  expect(
    formatChanges(await compareCatalogs({ articles: [] }, { articles: [] })),
  ).toBe("Added: 0\nRemoved: 0\nModified: 0");
});

test("series validation rejects malformed, unknown, and duplicate assignments", () => {
  const paths = new Set(["a.md", "b.md"]);
  expect(() => validateSeriesCatalog({}, paths)).toThrow("series array");
  expect(() =>
    validateSeriesCatalog(
      { series: [{ id: "one", title: "One", paths: [] }] },
      paths,
    ),
  ).toThrow("non-empty");
  expect(() =>
    validateSeriesCatalog(
      { series: [{ id: "one", title: "One", paths: ["missing.md"] }] },
      paths,
    ),
  ).toThrow("Unknown series article path");
  expect(() =>
    validateSeriesCatalog(
      { series: [{ id: "one", title: "One", paths: ["a.md", "a.md"] }] },
      paths,
    ),
  ).toThrow("Duplicate path in series");
  expect(() =>
    validateSeriesCatalog(
      {
        series: [
          { id: "one", title: "One", paths: ["a.md"] },
          { id: "two", title: "Two", paths: ["a.md"] },
        ],
      },
      paths,
    ),
  ).toThrow("multiple series");
});

test("check mode detects drift without mutating the bundled snapshot", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-hwchiu-check-"));
  temporaryDirectories.push(root);
  await cp(join(referencesRoot, "articles"), root, { recursive: true });
  const trackedPaths = [
    join(referencesRoot, "catalog.json"),
    join(referencesRoot, "INDEX.md"),
    join(referencesRoot, "articles/blog/2023/04-12-oom_event.md"),
  ];
  const before = await Promise.all(
    trackedPaths.map((path) => readFile(path, "utf8")),
  );

  await expect(
    execFile(process.execPath, [scriptPath, "--check", root], {
      timeout: 60_000,
    }),
  ).rejects.toMatchObject({ code: 1 });

  await expect(
    Promise.all(trackedPaths.map((path) => readFile(path, "utf8"))),
  ).resolves.toEqual(before);
});

test("unknown CLI options fail before modifying the bundled snapshot", async () => {
  const before = await readFile(join(referencesRoot, "catalog.json"), "utf8");
  await expect(
    execFile(process.execPath, [scriptPath, "--unknown"], { timeout: 10_000 }),
  ).rejects.toMatchObject({ code: 1 });
  expect(await readFile(join(referencesRoot, "catalog.json"), "utf8")).toBe(
    before,
  );
});

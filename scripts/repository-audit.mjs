import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

const failures = [];
const warnings = [];
const counts = {
  tracked: tracked.length,
  jsChecked: 0,
  jsonChecked: 0,
  shellChecked: 0,
  yamlChecked: 0,
  textConflictChecked: 0,
};

const textExts = new Set([
  ".ts",".tsx",".js",".mjs",".cjs",".json",".yml",".yaml",".sh",".css",".html",
  ".md",".txt",".toml",".ini",".env",".conf",".xml",".svg"
]);

function run(command, args, label) {
  try {
    execFileSync(command, args, { cwd: root, stdio: "pipe", encoding: "utf8" });
    return true;
  } catch (error) {
    const stdout = error?.stdout?.toString?.() || "";
    const stderr = error?.stderr?.toString?.() || "";
    failures.push({ file: label, command: [command, ...args].join(" "), output: (stdout + "\n" + stderr).trim().slice(-4000) });
    return false;
  }
}

for (const rel of tracked) {
  const full = path.join(root, rel);
  let stat;
  try {
    stat = fs.lstatSync(full);
  } catch {
    failures.push({ file: rel, reason: "tracked file is missing from checkout" });
    continue;
  }

  if (stat.isSymbolicLink()) {
    try {
      fs.realpathSync(full);
    } catch {
      failures.push({ file: rel, reason: "broken symbolic link" });
    }
    continue;
  }

  const ext = path.extname(rel).toLowerCase();

  if (textExts.has(ext) || path.basename(rel).startsWith(".")) {
    let content = "";
    try {
      content = fs.readFileSync(full, "utf8");
    } catch {
      failures.push({ file: rel, reason: "text/config file could not be read as UTF-8" });
      continue;
    }

    counts.textConflictChecked++;
    if (/^<<<<<<< |^=======$|^>>>>>>> /m.test(content)) {
      failures.push({ file: rel, reason: "merge-conflict marker found" });
    }

    if ([".ts",".tsx",".js",".mjs",".cjs"].includes(ext) && content.trim().length === 0) {
      failures.push({ file: rel, reason: "empty source file" });
    }
    if ([".json"].includes(ext) && content.trim().length === 0) {
      failures.push({ file: rel, reason: "empty JSON file" });
    }
  }

  if ([".js",".mjs",".cjs"].includes(ext)) {
    counts.jsChecked++;
    run(process.execPath, ["--check", full], rel);
  } else if (ext === ".json") {
    counts.jsonChecked++;
    try {
      JSON.parse(fs.readFileSync(full, "utf8"));
    } catch (error) {
      failures.push({ file: rel, reason: "invalid JSON", output: String(error) });
    }
  } else if (ext === ".sh") {
    counts.shellChecked++;
    run("bash", ["-n", full], rel);
  } else if ([".yml",".yaml"].includes(ext)) {
    counts.yamlChecked++;
    const rubyScript = "require 'yaml'; YAML.load_file(ARGV[0]);";
    run("ruby", ["-e", rubyScript, full], rel);
  }
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const requiredScripts = ["check", "build", "start"];
for (const script of requiredScripts) {
  if (!packageJson.scripts?.[script]) {
    failures.push({ file: "package.json", reason: `required npm script missing: ${script}` });
  }
}

const lockPath = path.join(root, "package-lock.json");
if (!fs.existsSync(lockPath)) {
  failures.push({ file: "package-lock.json", reason: "package-lock.json is missing" });
}

console.log(JSON.stringify({
  ok: failures.length === 0,
  summary: counts,
  warnings,
  failures,
}, null, 2));

if (failures.length) process.exit(1);

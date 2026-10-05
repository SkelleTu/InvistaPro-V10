import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export type ForensicFile = {
  path: string;
  size: number;
  sha256: string;
  category: string;
  inspectable: boolean;
};

function sha256File(filePath: string): string {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function readMemoryFile(filePath: string): number | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (!raw || raw === "max") return null;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function memoryTransparency() {
  const usage = process.memoryUsage();
  const current = readMemoryFile("/sys/fs/cgroup/memory.current")
    ?? readMemoryFile("/sys/fs/cgroup/memory/memory.usage_in_bytes");
  const limit = readMemoryFile("/sys/fs/cgroup/memory.max")
    ?? readMemoryFile("/sys/fs/cgroup/memory/memory.limit_in_bytes");
  const mb = (n: number | null) => n == null ? null : Math.round(n / 1024 / 1024 * 100) / 100;
  const usedPercent = current && limit ? Math.round(current / limit * 10000) / 100 : null;
  return {
    rssMB: mb(usage.rss),
    heapUsedMB: mb(usage.heapUsed),
    heapTotalMB: mb(usage.heapTotal),
    externalMB: mb(usage.external),
    arrayBuffersMB: mb(usage.arrayBuffers),
    currentMB: mb(current),
    limitMB: mb(limit),
    freeMB: current && limit ? mb(Math.max(0, limit - current)) : null,
    usedPercent,
    headroomPercent: usedPercent == null ? null : Math.round((100 - usedPercent) * 100) / 100,
    limitSource: limit ? "linux.cgroup" : "unavailable",
    measuredAt: new Date().toISOString(),
  };
}

function classify(filePath: string): { category: string; inspectable: boolean } {
  const p = filePath.toLowerCase();
  if (p.includes("/node_modules/") || p.includes("/.git/")) return { category: "dependency-or-vcs", inspectable: false };
  if (/\.(ts|tsx|js|jsx|mjs|cjs|py|sh|sql|html|css|scss|json|yaml|yml|toml|xml|env|conf|config)$/i.test(p)) return { category: "source-or-config", inspectable: true };
  if (/\.(md|txt|pdf)$/i.test(p)) return { category: "documentation", inspectable: true };
  if (/\.(png|jpe?g|gif|webp|svg|ico|bmp|wav|mp3|oga|ttf|woff|zip|exe|ex5|hcc|chr|wnd|dat|lic|set|tpl|mq5)$/i.test(p)) return { category: "binary-or-asset", inspectable: false };
  return { category: "other", inspectable: true };
}

function fallbackInventory(root: string): ForensicFile[] {
  const result: ForensicFile[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else {
        const relative = path.relative(root, absolute).replaceAll(path.sep, "/");
        const meta = classify(relative);
        let size = 0;
        let sha256 = "";
        try { const stat = fs.statSync(absolute); size = stat.size; sha256 = sha256File(absolute); } catch {}
        result.push({ path: relative, size, sha256, ...meta });
      }
    }
  };
  walk(root);
  return result;
}

export function getForensicReport(manifest?: ForensicFile[]) {
  const root = process.cwd();
  let embeddedManifest = manifest;
  if (!embeddedManifest?.length) {
    for (const candidate of [
      path.resolve(root, "dist", "forensic-manifest.json"),
      path.resolve(root, "forensic-manifest.json"),
    ]) {
      try {
        const parsed = JSON.parse(fs.readFileSync(candidate, "utf8"));
        if (Array.isArray(parsed?.files) && parsed.files.length) {
          embeddedManifest = parsed.files as ForensicFile[];
          break;
        }
      } catch {}
    }
  }
  const expected = embeddedManifest && embeddedManifest.length ? embeddedManifest : fallbackInventory(root);
  let checked = 0;
  let missing = 0;
  let changed = 0;
  const missingFiles: string[] = [];
  const changedFiles: string[] = [];
  const categories: Record<string, number> = {};
  const inspectableCategories: Record<string, number> = {};

  for (const item of expected) {
    categories[item.category] = (categories[item.category] || 0) + 1;
    if (item.inspectable) inspectableCategories[item.category] = (inspectableCategories[item.category] || 0) + 1;
    const absolute = path.resolve(root, item.path);
    try {
      const stat = fs.statSync(absolute);
      if (!stat.isFile()) { missing++; missingFiles.push(item.path); continue; }
      checked++;
      const actualHash = sha256File(absolute);
      if (item.sha256 && actualHash !== item.sha256) {
        changed++;
        changedFiles.push(item.path);
      }
    } catch {
      missing++;
      missingFiles.push(item.path);
    }
  }

  const total = expected.length;
  const fileCoveragePercent = total ? Math.round((checked / total) * 10000) / 100 : 100;
  const integrityPercent = total ? Math.round(((checked - changed) / total) * 10000) / 100 : 100;
  const memory = memoryTransparency();

  return {
    status: missing || changed ? "attention" : "complete",
    generatedAt: new Date().toISOString(),
    repositoryFileInventory: {
      totalFiles: total,
      checkedFiles: checked,
      missingFiles: missing,
      changedFiles: changed,
      fileCoveragePercent,
      integrityPercent,
      complete: missing === 0,
      integrityComplete: changed === 0,
      categories,
      inspectableCategories,
      note: "Arquivo binário/asset entra no inventário e integridade por SHA-256; análise semântica é aplicada aos arquivos de código/configuração/documentação suportados.",
    },
    differences: { missingFiles: missingFiles.slice(0, 100), changedFiles: changedFiles.slice(0, 100) },
    memoryTransparency: memory,
  };
}

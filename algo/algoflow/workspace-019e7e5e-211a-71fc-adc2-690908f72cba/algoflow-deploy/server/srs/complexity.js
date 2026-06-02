/**
 * Complexity estimation: static loop analysis + empirical timing fit.
 */

const LOOP_PATTERNS = [
  /\bfor\s*\(/g,
  /\bwhile\s*\(/g,
  /\bdo\s*\{/g,
  /\bfor\s+\w+\s+in\s+/g,
];

function stripCommentsAndStrings(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
}

function maxLoopDepth(code) {
  const clean = stripCommentsAndStrings(code);
  let depth = 0;
  let max = 0;
  const tokens = clean.replace(/\b(for|while|do)\b/g, (m) => `\n${m}\n`).split("\n");
  for (const line of tokens) {
    const t = line.trim();
    if (/^(for|while|do)\b/.test(t)) {
      depth++;
      max = Math.max(max, depth);
    }
    if (line.includes("}")) {
      depth = Math.max(0, depth - 1);
    }
  }
  // brace-based fallback
  for (const ch of clean) {
    if (ch === "{") {
      depth++;
      max = Math.max(max, depth);
    } else if (ch === "}") {
      depth = Math.max(0, depth - 1);
    }
  }
  return max;
}

function countLoops(code) {
  const clean = stripCommentsAndStrings(code);
  let n = 0;
  for (const re of LOOP_PATTERNS) {
    const m = clean.match(re);
    if (m) n += m.length;
  }
  return n;
}

function detectRecursion(code) {
  const clean = stripCommentsAndStrings(code);
  const fnMatches = [...clean.matchAll(/\b(\w+)\s*\([^)]*\)\s*\{/g)];
  for (const m of fnMatches) {
    const name = m[1];
    if (["if", "for", "while", "switch", "catch"].includes(name)) continue;
    const bodyStart = m.index;
    const slice = clean.slice(bodyStart, bodyStart + 800);
    if (new RegExp(`\\b${name}\\s*\\(`).test(slice.slice(name.length + 2))) {
      return true;
    }
  }
  return /\bfunction\s+(\w+)[\s\S]*?\1\s*\(/.test(clean);
}

function staticAnalysis(sourceCode) {
  const depth = maxLoopDepth(sourceCode);
  const loops = countLoops(sourceCode);
  const recursive = detectRecursion(sourceCode);

  let time;
  let confidence = "medium";
  const notes = [];

  if (recursive) {
    time = "O(2^n) or O(n!) — recursive (verify)";
    confidence = "low";
    notes.push("Recursion detected; may be exponential or linear with memoization");
  } else if (depth >= 3) {
    time = "O(n³) or worse";
    notes.push(`Loop nesting depth ≈ ${depth}`);
  } else if (depth === 2) {
    time = "O(n²)";
    notes.push("Double nested loops");
  } else if (depth === 1) {
    time = "O(n)";
    notes.push("Single loop over input");
  } else if (loops > 0) {
    time = "O(n)";
    notes.push(`${loops} loop(s) detected`);
  } else {
    time = "O(1)";
    confidence = "high";
    notes.push("No obvious loops");
  }

  const space = recursive ? "O(n) stack/recursion" : depth >= 2 ? "O(n) typical" : "O(1)";

  return {
    time,
    space,
    confidence,
    method: "static",
    loop_depth: depth,
    loop_count: loops,
    recursive,
    notes,
  };
}

function estimateFromTimings(points) {
  if (points.length < 2) {
    return { time: "insufficient data", confidence: "low", method: "empirical" };
  }

  const filtered = points.filter((p) => p.timeMs > 0 && p.size > 0);
  if (filtered.length < 2) {
    return { time: "O(1) or too fast to measure", confidence: "low", method: "empirical" };
  }

  const ratios = [];
  for (let i = 1; i < filtered.length; i++) {
    const nRatio = filtered[i].size / filtered[i - 1].size;
    const tRatio = filtered[i].timeMs / Math.max(filtered[i - 1].timeMs, 1);
    if (nRatio > 1) ratios.push({ nRatio, tRatio });
  }

  const avgTRatio =
    ratios.reduce((s, r) => s + r.tRatio, 0) / Math.max(ratios.length, 1);
  const avgNRatio =
    ratios.reduce((s, r) => s + r.nRatio, 0) / Math.max(ratios.length, 1);

  const exponent = Math.log(avgTRatio) / Math.log(avgNRatio);

  let time;
  let confidence = "medium";
  if (exponent < 0.3) time = "O(1)";
  else if (exponent < 1.2) time = "O(n)";
  else if (exponent < 1.6) time = "O(n log n)";
  else if (exponent < 2.3) time = "O(n²)";
  else if (exponent < 3.3) time = "O(n³)";
  else time = "O(n^k), k≥4";

  if (filtered.length < 3) confidence = "low";

  return {
    time,
    space: "see peak_memory_kb from runs",
    confidence,
    method: "empirical",
    exponent: round(exponent, 2),
    samples: filtered,
    notes: [`Fitted exponent ≈ ${round(exponent, 2)} from ${filtered.length} timing points`],
  };
}

function round(v, d) {
  const f = Math.pow(10, d);
  return Math.round(v * f) / f;
}

function combine(staticResult, empiricalResult) {
  if (!empiricalResult || empiricalResult.confidence === "low") {
    return { ...staticResult, combined: staticResult.time };
  }
  return {
    time_static: staticResult.time,
    time_empirical: empiricalResult.time,
    space_static: staticResult.space,
    combined: empiricalResult.time,
    confidence:
      staticResult.time.includes(empiricalResult.time.split(" ")[0]) ||
      empiricalResult.time === staticResult.time
        ? "high"
        : "medium",
    static: staticResult,
    empirical: empiricalResult,
    notes: [
      ...(staticResult.notes || []),
      ...(empiricalResult.notes || []),
      staticResult.time !== empiricalResult.time
        ? `Static (${staticResult.time}) vs empirical (${empiricalResult.time}) differ — trust empirical if benchmark inputs scaled.`
        : "Static and empirical estimates agree",
    ],
  };
}

module.exports = {
  staticAnalysis,
  estimateFromTimings,
  combine,
};

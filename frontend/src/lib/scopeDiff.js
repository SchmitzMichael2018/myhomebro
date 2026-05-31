// Pure functions — no React.

// Parse scope text into normalized lines for comparison.
// Handles bullet points, numbered lists, and plain paragraphs.
export function parseScopeLines(text) {
  if (!text || typeof text !== "string") return [];

  // Split on newlines, then normalize each line
  const rawLines = text.split(/\r?\n/);
  const lines = [];

  for (const raw of rawLines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    // Strip leading bullet/number markers for comparison purposes but keep original for display
    lines.push(trimmed);
  }

  return lines;
}

// LCS-based diff. Returns DiffLine[].
// DiffLine shape: { type: 'added' | 'removed' | 'unchanged', text: string }
function lcs(a, b) {
  const m = a.length;
  const n = b.length;

  // Build LCS table
  const dp = [];
  for (let i = 0; i <= m; i++) {
    dp.push(new Array(n + 1).fill(0));
  }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to produce diff
  const result = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      result.unshift({ type: "unchanged", text: a[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: "added", text: b[j - 1] });
      j--;
    } else {
      result.unshift({ type: "removed", text: a[i - 1] });
      i--;
    }
  }

  return result;
}

// Compare two scope texts and return a structured diff.
export function diffScope(originalText, improvedText) {
  const originalLines = parseScopeLines(originalText || "");
  const improvedLines = parseScopeLines(improvedText || "");
  return lcs(originalLines, improvedLines);
}

// Format a diff with summary counts.
// Returns { addedCount, removedCount, unchangedCount, lines: DiffLine[] }
export function formatDiff(originalText, improvedText) {
  const lines = diffScope(originalText, improvedText);
  const addedCount = lines.filter((l) => l.type === "added").length;
  const removedCount = lines.filter((l) => l.type === "removed").length;
  const unchangedCount = lines.filter((l) => l.type === "unchanged").length;
  return { addedCount, removedCount, unchangedCount, lines };
}

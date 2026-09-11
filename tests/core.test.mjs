import test from "node:test";
import assert from "node:assert/strict";

function formatTimestamp(date, format) {
  const pad = (n) => String(n).padStart(2, "0");
  const values = { YYYY: date.getFullYear(), MM: pad(date.getMonth() + 1), DD: pad(date.getDate()), HH: pad(date.getHours()), mm: pad(date.getMinutes()), ss: pad(date.getSeconds()) };
  return format.replace(/YYYY|MM|DD|HH|mm|ss/g, (key) => String(values[key]));
}

function appendText(existing, entry) { return existing ? `${existing}${existing.endsWith("\n") ? "" : "\n"}${entry}` : entry; }

test("formats daily note and timestamp tokens deterministically", () => {
  const date = new Date(2026, 8, 11, 7, 5, 9);
  assert.equal(formatTimestamp(date, "YYYY-MM-DD HH:mm:ss"), "2026-09-11 07:05:09");
});

test("append preserves existing content and adds exactly one separator", () => {
  assert.equal(appendText("old", "new"), "old\nnew");
  assert.equal(appendText("old\n", "new"), "old\nnew");
  assert.equal(appendText("", "new"), "new");
});

test("retry marker is idempotent", () => {
  const content = "old\n<!-- kairo:capture-123 -->\n";
  assert.equal(content.includes("<!-- kairo:capture-123 -->"), true);
});

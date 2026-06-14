// Fullscreen TUI with border and cursor movement
// Usage: node tests/fixtures/fullscreen-tui.js

function drawBox() {
  process.stdout.write("\x1b[2J\x1b[H"); // clear
  const cols = 40;
  const rows = 10;
  // Top border
  process.stdout.write("+" + "-".repeat(cols - 2) + "+\n");
  for (let r = 0; r < rows - 2; r++) {
    process.stdout.write("|");
    if (r === 2) {
      process.stdout.write("  Fullscreen TUI Demo");
      process.stdout.write(" ".repeat(Math.max(0, cols - 24 - 2)));
    } else if (r === 4) {
      process.stdout.write("  Press q to quit");
      process.stdout.write(" ".repeat(Math.max(0, cols - 20 - 2)));
    } else {
      process.stdout.write(" ".repeat(cols - 2));
    }
    process.stdout.write("|\n");
  }
  // Bottom border
  process.stdout.write("+" + "-".repeat(cols - 2) + "+\n");
}

process.stdin.setRawMode(true);
process.stdin.setEncoding("utf8");
process.stdin.on("data", (key) => {
  if (key === "q" || key === "\x03") {
    process.stdout.write("\x1b[2J\x1b[HBye!\n");
    process.exit(0);
  }
});

drawBox();

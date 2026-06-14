// Arrow-key selectable menu TUI
// Usage: node tests/fixtures/menu-app.js

const items = ["Option A", "Option B", "Option C", "Exit"];
let selected = 0;

function render() {
  process.stdout.write("\x1b[2J\x1b[H"); // clear screen
  process.stdout.write("Use arrow keys to select, Enter to confirm:\n\n");
  items.forEach((item, i) => {
    if (i === selected) {
      process.stdout.write(`\x1b[7m > ${item} \x1b[0m\n`); // inverse video
    } else {
      process.stdout.write(`   ${item}\n`);
    }
  });
  process.stdout.write("\n");
}

process.stdin.setRawMode(true);
process.stdin.setEncoding("utf8");
process.stdin.on("data", (key) => {
  if (key === "\x1b[A" || key === "k") { // up
    selected = (selected - 1 + items.length) % items.length;
    render();
  } else if (key === "\x1b[B" || key === "j") { // down
    selected = (selected + 1) % items.length;
    render();
  } else if (key === "\r" || key === "\n") { // enter
    process.stdout.write(`\nSelected: ${items[selected]}\n`);
    if (items[selected] === "Exit") {
      process.exit(0);
    }
    render();
  } else if (key === "q" || key === "\x03") { // q or ctrl-c
    process.stdout.write("\nGoodbye!\n");
    process.exit(0);
  }
});

render();

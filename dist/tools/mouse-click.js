/** terminal.mouse_click — 在终端指定位置注入鼠标点击事件 */
import { z } from "zod";
import { errorToToolResult, okToolResult } from "./tool-helpers.js";
export function registerMouseClickTool(server, executor, logger) {
    server.registerTool("terminal.mouse_click", {
        description: "Click the mouse at a specific position in the terminal. " +
            "Sends SGR-1006 press+release sequences that interactive TUI programs (vim, lazygit, htop, etc.) understand. " +
            "The child process must have mouse mode enabled for clicks to take effect. " +
            "Coordinates are 1-based: (1,1) is top-left corner.",
        inputSchema: {
            sessionId: z.string().min(1).describe("Session ID from terminal.start — use exact value"),
            col: z.number().int().min(1).describe("1-based column (x position, left=1)"),
            row: z.number().int().min(1).describe("1-based row (y position, top=1)"),
            button: z.enum(["left", "right", "middle"]).describe("Mouse button").default("left"),
            shift: z.boolean().describe("Shift key held").default(false),
            alt: z.boolean().describe("Alt key held").default(false),
            ctrl: z.boolean().describe("Ctrl key held").default(false),
        },
    }, async (input) => {
        try {
            const button = input.button ?? "left";
            await executor.executeMouseClick(input.sessionId, {
                col: input.col,
                row: input.row,
                button,
                shift: input.shift ?? false,
                alt: input.alt ?? false,
                ctrl: input.ctrl ?? false,
            });
            const output = { ok: true, button, col: input.col, row: input.row };
            logger.debug("mouse click sent", { sessionId: input.sessionId, button, col: input.col, row: input.row });
            return okToolResult(`Clicked ${button} at (${input.col},${input.row}) in ${input.sessionId}`, output);
        }
        catch (err) {
            return errorToToolResult(err);
        }
    });
}

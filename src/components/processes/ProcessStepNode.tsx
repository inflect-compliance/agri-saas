"use client";

/**
 * R25-PR-C originally shipped ProcessStepNode as the canvas's only
 * custom node. R26-PR-B introduced the seven-kind taxonomy and
 * moved the renderer to `ProcessTypedNode`. This file is now a
 * thin re-export so existing imports (and the R25 structural
 * ratchet that asserts `<ProcessStepNode>` exists) keep working
 * without touching the call sites.
 *
 * New callers should import `ProcessTypedNode` directly.
 */

export {
    ProcessTypedNode as ProcessStepNode,
    PROCESS_STEP_NODE_TYPE,
} from "./ProcessTypedNode";

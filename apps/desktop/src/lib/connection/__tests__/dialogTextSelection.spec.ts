// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { preventDialogPasswordCopy, preventDialogDocumentSelectAll } from "../dialogTextSelection";

function keyboardEvent(target: EventTarget, options: { key?: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean } = {}) {
  return {
    key: options.key ?? "a",
    metaKey: options.metaKey ?? false,
    ctrlKey: options.ctrlKey ?? false,
    altKey: options.altKey ?? false,
    target,
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent;
}

describe("preventDialogDocumentSelectAll", () => {
  it("prevents page selection from non-text dialog surfaces", () => {
    const event = keyboardEvent(document.createElement("div"), { metaKey: true });

    expect(preventDialogDocumentSelectAll(event)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it.each([document.createElement("input"), document.createElement("textarea")])("keeps native select-all for text controls", (target) => {
    const event = keyboardEvent(target, { ctrlKey: true });

    expect(preventDialogDocumentSelectAll(event)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("keeps native select-all for nested textbox content", () => {
    const textbox = document.createElement("div");
    textbox.setAttribute("role", "textbox");
    const child = document.createElement("span");
    textbox.appendChild(child);
    const event = keyboardEvent(child, { metaKey: true });

    expect(preventDialogDocumentSelectAll(event)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("does not intercept ordinary typing", () => {
    const event = keyboardEvent(document.createElement("div"));

    expect(preventDialogDocumentSelectAll(event)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});

function clipboardEvent(target: EventTarget) {
  return {
    target,
    preventDefault: vi.fn(),
    clipboardData: { setData: vi.fn() },
  } as unknown as ClipboardEvent;
}

function passwordInput(value: string, options: { masked?: boolean; marker?: boolean; selection?: [number, number] } = {}) {
  const input = document.createElement("input");
  input.type = options.masked === false ? "text" : "password";
  if (options.marker !== false) input.setAttribute("data-password-input", "");
  input.value = value;
  const [start, end] = options.selection ?? [value.length, value.length];
  input.setSelectionRange(start, end);
  return input;
}

describe("preventDialogPasswordCopy", () => {
  it.each([{ masked: true }, { masked: false }, { masked: false, selection: [0, 4] as [number, number] }, { masked: true, marker: false }])("blocks password clipboard writes for %j", (options) => {
    const event = clipboardEvent(passwordInput("p^ss%40@x#y", options));
    expect(preventDialogPasswordCopy(event)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.clipboardData!.setData).not.toHaveBeenCalled();
  });

  it("also blocks an empty password field without requiring clipboard access", () => {
    const event = { target: passwordInput(""), preventDefault: vi.fn(), clipboardData: null } as unknown as ClipboardEvent;
    expect(preventDialogPasswordCopy(event)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it.each([passwordInput("app_user", { masked: false, marker: false }), document.createElement("textarea"), document.createElement("div")])("keeps normal text copying", (target) => {
    const event = clipboardEvent(target);
    expect(preventDialogPasswordCopy(event)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.clipboardData!.setData).not.toHaveBeenCalled();
  });
});

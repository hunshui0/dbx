function isDialogTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable) || !!target.closest("[contenteditable='true'], [role='textbox']");
}

export function preventDialogDocumentSelectAll(event: KeyboardEvent): boolean {
  const isSelectAll = event.key.toLowerCase() === "a" && (event.metaKey || event.ctrlKey) && !event.altKey;
  if (!isSelectAll || isDialogTextInputTarget(event.target)) return false;
  event.preventDefault();
  return true;
}

function isPasswordFieldTarget(target: EventTarget | null): target is HTMLInputElement {
  if (!(target instanceof HTMLInputElement)) return false;
  // A revealed password is a plain text input, so the reveal toggle marks it
  // explicitly; a masked one is recognizable from its type alone.
  return target.type === "password" || target.hasAttribute("data-password-input");
}

/** Prevent password fields from writing secrets through copy or cut. */
export function preventDialogPasswordCopy(event: ClipboardEvent): boolean {
  if (!isPasswordFieldTarget(event.target)) return false;
  event.preventDefault();
  return true;
}

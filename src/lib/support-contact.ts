export const SUPPORT_EMAIL = "contact@cleanmaapp.com";
export const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}`;

export async function copySupportEmail(link: HTMLAnchorElement | null) {
  try {
    await navigator.clipboard.writeText(SUPPORT_EMAIL);
    return true;
  } catch {
    const selection = window.getSelection();
    if (link && selection) {
      const range = document.createRange();
      range.selectNodeContents(link);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    return false;
  }
}

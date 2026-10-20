/**
 * Decide whether feed HTML has real, readable content.
 *
 * Content counts as readable when it has media (images/video/etc.) or any word
 * text outside of links. Content that is empty or consists of just one or two
 * links — e.g. a Hacker News item whose body is only a "Comments" link — is not
 * readable, so the reader shows an "only on the original site" placeholder.
 */
export function hasReadableContent(html: string | null | undefined): boolean {
  if (!html || !html.trim()) return false;

  let body: HTMLElement | null;
  try {
    body = new DOMParser().parseFromString(html, "text/html").body;
  } catch {
    // If we can't parse it, don't hide it.
    return true;
  }
  if (!body) return false;

  if (body.querySelector("img, picture, video, audio, iframe, figure, svg, embed, object")) {
    return true;
  }

  const linkCount = body.querySelectorAll("a").length;

  // Text outside of links — ignore whitespace and punctuation separators.
  const clone = body.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("a").forEach((a) => a.remove());
  if (/[\p{L}\p{N}]/u.test(clone.textContent ?? "")) return true;

  // Only links remain: a curated list of several links is still content.
  return linkCount >= 3;
}

export default hasReadableContent;

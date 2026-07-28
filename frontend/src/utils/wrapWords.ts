/**
 * Word-span wrapping for read-along highlighting.
 *
 * Walks the text nodes of a rendered container and wraps each whitespace-
 * delimited token in a ``<span class="ra-word" data-ra-index="N">`` so the
 * highlighter has stable, indexable targets. This only splits existing text
 * nodes (never inserts HTML from strings), so it introduces no XSS surface and
 * preserves the sanitized structure — including links and their attributes.
 */

export interface WrapResult {
    count: number;
    /** The created spans, in order; ``elements[i]`` has ``data-ra-index = startIndex + i``. */
    elements: HTMLElement[];
}

/** True if the node already lives inside a ``.ra-word`` span (so we skip it). */
function isInsideRaWord(node: Node): boolean {
    let el: Element | null = node.parentElement;
    while (el) {
        if (el.classList && el.classList.contains("ra-word")) return true;
        el = el.parentElement;
    }
    return false;
}

/**
 * Collect whitespace-delimited word texts in document order, using the same
 * tokenization as {@link wrapWords} (so indices line up). Read-only: does not
 * mutate the DOM. Skips text already inside ``.ra-word`` spans.
 */
export function collectWords(container: HTMLElement): string[] {
    const words: string[] = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
        const text = node as Text;
        if (!isInsideRaWord(text)) {
            const matches = text.data.match(/\S+/g);
            if (matches) words.push(...matches);
        }
        node = walker.nextNode();
    }
    return words;
}

/**
 * Wrap each whitespace-delimited token under ``container`` in an indexed
 * ``.ra-word`` span. Idempotent: text already inside a ``.ra-word`` is skipped,
 * so calling it again after a re-render adds no duplicates.
 *
 * @param container  Element whose text to wrap.
 * @param startIndex First ``data-ra-index`` to assign.
 */
export function wrapWords(container: HTMLElement, startIndex = 0): WrapResult {
    // Snapshot the eligible text nodes first, since we mutate the tree.
    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
        const text = node as Text;
        if (!isInsideRaWord(text) && /\S/.test(text.data)) {
            textNodes.push(text);
        }
        node = walker.nextNode();
    }

    const elements: HTMLElement[] = [];
    let index = startIndex;

    for (const textNode of textNodes) {
        const parent = textNode.parentNode;
        if (!parent) continue;

        const fragment = document.createDocumentFragment();
        // Split into words and the whitespace runs between them (kept verbatim).
        for (const part of textNode.data.split(/(\s+)/)) {
            if (part === "") continue;
            if (/^\s+$/.test(part)) {
                fragment.appendChild(document.createTextNode(part));
            } else {
                const span = document.createElement("span");
                span.className = "ra-word";
                span.dataset.raIndex = String(index);
                span.textContent = part;
                elements.push(span);
                index++;
                fragment.appendChild(span);
            }
        }
        parent.replaceChild(fragment, textNode);
    }

    return { count: index - startIndex, elements };
}

/**
 * Reverse {@link wrapWords}: replace every `.ra-word` span under `container`
 * with a plain text node of its text, then merge adjacent text nodes. This
 * restores the container to an unwrapped state so it can be re-wrapped cleanly
 * (e.g. when read-along highlighting is toggled off and back on). Idempotent:
 * a container with no `.ra-word` spans is left unchanged.
 *
 * @param container Element whose `.ra-word` spans to unwrap.
 */
export function unwrapWords(container: HTMLElement): void {
    const spans = container.querySelectorAll<HTMLElement>("span.ra-word");
    for (const span of spans) {
        span.replaceWith(document.createTextNode(span.textContent ?? ""));
    }
    // Merge the adjacent text nodes left behind so later tokenization matches
    // the original (unwrapped) structure.
    container.normalize();
}

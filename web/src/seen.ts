// What a move is put on. An animation of transform or opacity has the browser keep the whole of
// what it is on drawn, seen or not: WebKit by its size, so a conversation gliding as one thing
// took 1.3 GB more than at rest, each glide again, till the page was killed (kumo, 2026-11-23). So
// nothing that may be taller than the screen a few times over is moved whole: what is seen of it
// is, and what is not seen is not moved at all. For the conversation's glide (chat/stick.tsx)
// and rows changing places (moves.ts).

/** What of box is seen between top and bottom (the viewport's px): its rows; of a row taller than
 *  tall, what is seen of its own rows, as far down as it is only a box around them. ordered: box's
 *  rows are one under another, read from the end up, and none above the first one not seen is. */
export function partsSeen(box: Element, top: number, bottom: number, tall: number, ordered = false): HTMLElement[] {
  const out: HTMLElement[] = [];
  const take = (box: Element, depth: number) => {
    for (let r = box.lastElementChild; r; r = r.previousElementSibling) {
      if (!(r instanceof HTMLElement)) continue;
      const b = r.getBoundingClientRect();
      // No box of its own (display: contents): its rows are the box's.
      if (!b.width && !b.height) {
        if (r.firstElementChild && depth < 8) take(r, depth + 1);
        continue;
      }
      if (b.bottom < top) {
        if (ordered && !depth) break;
        continue;
      }
      if (b.top > bottom) continue;
      if (b.height > tall && depth < 8 && onlyABox(r)) take(r, depth + 1);
      else out.push(r);
    }
  };
  take(box, 0);
  return out;
}

/** What to move for el, seen between top and bottom at some moment of its move: itself; its parts
 *  seen, if it is taller than tall and only a box around them; nothing, if it is not seen. */
export function movedFor(el: HTMLElement, top: number, bottom: number, tall: number): HTMLElement[] {
  const b = el.getBoundingClientRect();
  if (b.bottom < top || b.top > bottom) return [];
  return b.height > tall && onlyABox(el) ? partsSeen(el, top, bottom, tall) : [el];
}

/** Whether el is only a box around its rows: they can be moved in its stead (nothing drawn of its
 *  own, nothing clipped). */
function onlyABox(el: HTMLElement): boolean {
  if (!el.firstElementChild) return false;
  for (const n of el.childNodes) if (n.nodeType === Node.TEXT_NODE && n.nodeValue?.trim()) return false;
  const cs = getComputedStyle(el);
  const clear = (c: string) => c === "transparent" || /,\s*0\)$/.test(c);
  return cs.overflowX === "visible" && cs.overflowY === "visible" && cs.backgroundImage === "none" && clear(cs.backgroundColor) && !parseFloat(cs.borderTopWidth) && !parseFloat(cs.borderBottomWidth) && !parseFloat(cs.borderLeftWidth) && !parseFloat(cs.borderRightWidth) && cs.boxShadow === "none" && !/^(inline|table)/.test(cs.display);
}

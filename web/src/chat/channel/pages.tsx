// A menu's next level (kumo, 2026-11-25): with a mouse, a submenu out of its row; with a finger,
// inside a Paged menu, the menu's next page, its row pressed, 返回 at its head. The + panel's way
// (top.tsx Invite), for every menu at the bar's right.
import { Menu } from "@base-ui/react/menu";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { createContext, useContext, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Tall } from "../../create";
import { cn, MenuPortal, useMedia } from "../../ui";
import { ITEM } from "./invite";

type Page = { id: string; title: string };
type Pages = { stack: Page[]; push: (p: Page) => void; slot: HTMLElement | null; back: boolean };
const Ctx = createContext<Pages | null>(null);

/** A menu whose next levels are its pages on a finger's screen; as it is with a mouse. The list
 *  and every page under the one shown stay drawn, only hidden: what they were left at is kept.
 *  One place the pages are put in, never made anew: a page's own rows (its next level's) keep
 *  who they are. Each slides in as it is shown (g-slide from display none). */
export function Paged({ children }: { children: ReactNode }) {
  const finger = useMedia("(pointer: coarse)");
  const [stack, setStack] = useState<Page[]>([]);
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  // Back from a page, what was under it comes in from the other side; as the menu opens nothing slides.
  const went = useRef<"" | "on" | "back">("");
  if (!finger) return <>{children}</>;
  const top = stack.at(-1);
  const push = (p: Page) => ((went.current = "on"), setStack((s) => [...s, p]));
  const pop = () => ((went.current = "back"), setStack((s) => s.slice(0, -1)));
  return (
    <Ctx.Provider value={{ stack, push, slot, back: went.current === "back" }}>
      <Tall>
        <div data-dir="back" className={cn("flex flex-col", went.current && "g-slide", top && "hidden")}>
          {children}
        </div>
        <div className={cn("flex flex-col", !top && "hidden")}>
          {top && (
            <Menu.Item key={top.id} closeOnClick={false} onClick={pop} data-dir={went.current === "back" ? "back" : undefined} className={cn(ITEM, "g-slide text-ink-2")}>
              <ChevronLeft size={15} />
              <span className="min-w-0 flex-1 truncate">{top.title}</span>
            </Menu.Item>
          )}
          <div ref={setSlot} className="flex flex-col" />
        </div>
      </Tall>
    </Ctx.Provider>
  );
}

/** A row opening a next level: row, what the row shows (its icon, name, what is picked); title,
 *  the page's head; popup, the submenu's surface; bare: no › at its end. */
export function Deeper({ row, title, i, popup, bare, children }: { row: ReactNode; title: string; i: number; popup: string; bare?: boolean; children: ReactNode }) {
  const pages = useContext(Ctx);
  const id = useId();
  const style = { "--i": i } as CSSProperties;
  if (pages) {
    const at = pages.stack.findIndex((p) => p.id === id);
    return (
      <>
        <Menu.Item closeOnClick={false} onClick={() => pages.push({ id, title })} style={style} className={ITEM}>
          {row}
        </Menu.Item>
        {at >= 0 && pages.slot && createPortal(<div data-dir={pages.back ? "back" : undefined} className={cn("g-slide flex flex-col", at !== pages.stack.length - 1 && "hidden")}>{children}</div>, pages.slot)}
      </>
    );
  }
  return (
    <Menu.SubmenuRoot>
      <Menu.SubmenuTrigger style={style} className={ITEM}>
        {row}
        {!bare && <ChevronRight size={14} className="text-ink-4" />}
      </Menu.SubmenuTrigger>
      <MenuPortal>
        <Menu.Positioner className="z-50" sideOffset={4} collisionPadding={8}>
          <Menu.Popup className={popup}>{children}</Menu.Popup>
        </Menu.Positioner>
      </MenuPortal>
    </Menu.SubmenuRoot>
  );
}

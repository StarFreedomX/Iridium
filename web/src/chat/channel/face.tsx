// Faces (docs/channels.md "头像"; the user, 2026-11-13): a session's agent's, under the session's
// id; a channel's as a channel (channel), a session's own channel's its own, else its agent's
// (kumo, 2026-11-16). One with none of its own has the one last given to a session of its model; with
// neither, the harness's logo.
import { useLayoutEffect, useRef, useState, type ReactNode, type SyntheticEvent } from "react";
import type { Agent } from "../../api/types.gen";
import { useApps } from "../../data";
import { useCarried } from "../../store";
import { Avatar, cn, isHost, Logo } from "../../ui";

// The pictures that have come to this page: a face drawn anew (a
// row of the sidebar as a folder is opened or shut) is its picture at once, not the logo for a
// moment and then the picture (kumo, 2026-11-23: every face in the sidebar blinked so at each
// fold).
const came = new Set<string>();
// And as drawn, at the size they were shown at (px across): a picture element made anew is asked
// of the server again and decoded again, a frame or more with nothing in it, however lately the
// same picture was on the page; what is kept here is drawn in the frame the face is (kumo,
// 2026-11-23: the faces still blinked, the picture known but not yet there). An address is one
// picture (its version in it): the oldest kept are let go past DRAWN.
const drawn = new Map<string, ImageBitmap>();
const DRAWN = 400;
const pxOf = (size: number) => Math.ceil(size * (typeof devicePixelRatio === "number" ? devicePixelRatio : 1));
function keep(img: HTMLImageElement, src: string, size: number) {
  const key = `${src}@${pxOf(size)}`;
  if (drawn.has(key) || typeof createImageBitmap !== "function" || !img.naturalWidth || !img.naturalHeight) return;
  // The middle of it, as object-cover shows it.
  const s = Math.min(img.naturalWidth, img.naturalHeight);
  const px = pxOf(size);
  void createImageBitmap(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, { resizeWidth: px, resizeHeight: px, resizeQuality: "high" })
    .then((b) => {
      if (drawn.has(key)) return b.close();
      drawn.set(key, b);
      for (const [k, old] of drawn) {
        if (drawn.size <= DRAWN) break;
        drawn.delete(k);
        old.close();
      }
    })
    .catch(() => {});
}

/** Where the face of session or channel id is fetched (channel: as a channel): under its own
 *  version (the carried state "faces"; internal/server/faces.go), an answer kept for good; one the
 *  state does not have (a session Iridium does not host), under the count of faces changed
 *  ("avatars"), asked again each time. "" for one the state says has none. */
export function useFaceSrc(id: string, channel?: boolean): string {
  const own = useCarried<Record<string, string>>("faces")?.[channel ? `c:${id}` : id];
  const count = useCarried<number>("avatars") ?? 0;
  if (own === "") return "";
  return `/v1/internal/channels/${encodeURIComponent(id)}/avatar?${channel ? "of=channel&" : ""}v=${own ?? `n${count}`}`;
}
/** A picture kept, drawn before the frame it is first in. */
function Kept({ b }: { b: ImageBitmap }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    try {
      ref.current?.getContext("2d")?.drawImage(b, 0, 0);
    } catch {
      // Let go meanwhile (past DRAWN): the next draw has the picture itself.
    }
  }, [b]);
  return <canvas ref={ref} width={b.width} height={b.height} aria-hidden className="absolute inset-0 size-full rounded-full" />;
}

/** The face of session id's agent, or with channel of channel id as a channel; round, size
 *  across; none given: the agent's logo, as large as logo, or what else stands for it. */
export function Face({ id, agent, size, logo, className, none: instead, low, channel }: { id: string; agent: Agent; size: number; logo?: number; className?: string; none?: ReactNode; low?: boolean; channel?: boolean }) {
  const src = useFaceSrc(id, channel);
  const [none, setNone] = useState<string | null>(null);
  // Something else standing for it (wider than the face): shown until the picture has come.
  const [got, setGot] = useState<string | null>(() => (came.has(src) ? src : null));
  // The picture shown: the last that came, kept while the next one loads, so that a face asked
  // for again does not blank and come back (kumo, 2026-11-16: every face in the list blinked).
  const [shown, setShown] = useState<string | null>(() => (came.has(src) ? src : null));
  if (!src || none === src) return instead ? <span className={cn("grid", className)}>{instead}</span> : <Logo agent={agent} size={logo ?? size} className={className} />;
  const here = (e: SyntheticEvent<HTMLImageElement>) => (came.add(src), keep(e.currentTarget, src, size), setGot(src), setShown(src));
  const kept = (of: string) => drawn.get(`${of}@${pxOf(size)}`);
  // Kept: drawn at once, nothing asked for.
  const mine = kept(src);
  if (mine)
    return (
      <span className={cn("relative grid shrink-0 place-items-center", className)} style={{ width: size, height: size }}>
        <Kept b={mine} />
      </span>
    );
  const before = shown && shown !== src ? kept(shown) : undefined;
  // low: one of many (the sidebar's rows), fetched after what the open page asks for.
  const next = <img key={src} src={src} alt="" draggable={false} fetchPriority={low ? "low" : undefined} onLoad={here} onError={() => setNone(src)} className={cn("absolute inset-0 size-full rounded-full object-cover", shown && shown !== src && "opacity-0")} />;
  const was = shown && shown !== src ? before ? <Kept key={shown} b={before} /> : <img key={shown} src={shown} alt="" draggable={false} className="absolute inset-0 size-full rounded-full object-cover" /> : null;
  if (instead && got !== src && !shown)
    return (
      <span className={cn("relative grid", className)}>
        {instead}
        <span className="invisible absolute size-0 overflow-hidden">{next}</span>
      </span>
    );
  return (
    <span className={cn("relative grid shrink-0 place-items-center", className)} style={{ width: size, height: size }}>
      {!instead && !shown && <Logo agent={agent} size={logo ?? size} />}
      {was}
      {next}
    </span>
  );
}

/** A member's own face, small (a read mark, one who is looking): an agent's ("agent:<session>":
 *  its Face), a login's avatar ("<app>/<login>"), an app's for one that names no login. */
export function MemberFace({ member, name, agent, size }: { member: string; name?: string; agent?: Agent; size: number }) {
  const d = useApps().data;
  if (member.startsWith("agent:") && agent)
    return (
      <span className="grid shrink-0 place-items-center rounded-full bg-fill" style={{ width: size, height: size }}>
        <Face id={member.slice(6)} agent={agent} size={size} logo={Math.round(size * 0.64)} />
      </span>
    );
  const i = member.indexOf("/");
  const login = d?.logins.find((l) => l.app === member.slice(0, i) && l.id === member.slice(i + 1));
  const app = d?.apps.find((a) => a.id === member.slice(0, i));
  return <Avatar src={login ? login.avatar : app?.avatar} name={name || login?.name || app?.name || member} size={size} host={isHost(member) || !!app?.host} />;
}

/** A channel of several agents with no face of its own (kumo's channels: the user, 2026-11-16):
 *  its first two agents' own faces (their models'), one at the top left, one at the bottom right
 *  over it, in a box size across; one alone, its face. */
export function FaceStack({ members, size }: { members: { id: string; agent: Agent }[]; size: number }) {
  const [a, b] = members;
  if (!a) return null;
  if (!b) return <Face id={a.id} agent={a.agent} size={size} logo={Math.round(size * 0.57)} />;
  const each = Math.round(size * 0.66);
  const disc = (m: typeof a, at: string) => (
    <span className={cn("absolute grid place-items-center rounded-full bg-fill", at)} style={{ width: each, height: each, boxShadow: "0 0 0 1.5px var(--row-bg, var(--paper))" }}>
      <Face id={m.id} agent={m.agent} size={each} logo={Math.round(each * 0.62)} />
    </span>
  );
  return (
    <span className="relative block shrink-0" style={{ width: size, height: size }}>
      {disc(a, "top-0 left-0")}
      {disc(b, "right-0 bottom-0")}
    </span>
  );
}

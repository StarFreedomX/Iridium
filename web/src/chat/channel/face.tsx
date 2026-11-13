// Faces (docs/channels.md "头像"; the user, 2026-11-13): a channel's, which for a session is
// its agent's. One with none of its own has the one last given to a session of its model; with
// neither, the harness's logo.
import { useState, type ReactNode } from "react";
import { api } from "../../api/client";
import type { Agent } from "../../api/types.gen";
import { useCarried } from "../../store";
import { errText, toast } from "../../toast";
import { t } from "../../i18n";
import { cn, Logo } from "../../ui";

/** The face of channel (session) id, round, size across; none given: the agent's logo, as
 *  large as logo, or what else stands for it. */
export function Face({ id, agent, size, logo, className, none: instead }: { id: string; agent: Agent; size: number; logo?: number; className?: string; none?: ReactNode }) {
  // Asked again as any face changes (the carried state "avatars", a count).
  const v = useCarried<number>("avatars") ?? 0;
  const src = `/v1/internal/channels/${encodeURIComponent(id)}/avatar?v=${v}`;
  const [none, setNone] = useState<string | null>(null);
  // Something else standing for it (wider than the face): shown until the picture has come.
  const [got, setGot] = useState<string | null>(null);
  if (none === src) return instead ? <span className={cn("grid", className)}>{instead}</span> : <Logo agent={agent} size={logo ?? size} className={className} />;
  const img = <img src={src} alt="" draggable={false} onLoad={() => setGot(src)} onError={() => setNone(src)} className="absolute inset-0 size-full rounded-full object-cover" />;
  if (instead && got !== src)
    return (
      <span className={cn("relative grid", className)}>
        {instead}
        <span className="invisible absolute size-0 overflow-hidden">{img}</span>
      </span>
    );
  return (
    <span className={cn("relative grid shrink-0 place-items-center", className)} style={{ width: size, height: size }}>
      {!instead && <Logo agent={agent} size={logo ?? size} />}
      {img}
    </span>
  );
}

const asDataURL = (f: Blob) =>
  new Promise<string>((done, fail) => {
    const r = new FileReader();
    r.onload = () => done(String(r.result));
    r.onerror = () => fail(r.error);
    r.readAsDataURL(f);
  });

/** Asks for a picture and makes it the face of channel (session) id. */
export function pickFace(id: string) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/webp";
  input.onchange = () => {
    const f = input.files?.[0];
    if (!f) return;
    void asDataURL(f)
      .then((url) => api.setAvatar(id, url))
      .catch((e) => toast(t("err.action"), { error: true, description: errText(e) }));
  };
  input.click();
}

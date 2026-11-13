// A channel's part of the chat's "⋯" (the user, 2026-11-13): who is looking at it now, its
// members and what each receives, and 邀请: agents (invite.tsx) and people, an app a submenu of
// its logins. No faces are lined up under the title.
import { Menu } from "@base-ui/react/menu";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, Eye, ImagePlus, UserPlus, Users } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { api } from "../../api/client";
import type { ChannelMembers, Viewer } from "../../api/types.gen";
import { useApps } from "../../data";
import { t, useLang } from "../../i18n";
import { openChat } from "../../route";
import { useCarried, useList } from "../../store";
import { toast } from "../../toast";
import { agentName, Avatar, cn, Lamp, Logo } from "../../ui";
import { pickFace } from "./face";
import { mayAct, useMembers } from "./gate";
import { AgentKinds, ITEM, POPUP } from "./invite";
import { memberError } from "./key";
import { appAll, everyone, hasApp, hasLogin, loginOf, peopleOf, pressApp, pressLogin } from "./setup";

const SUB = "no-bar max-h-[min(480px,var(--available-height))] min-w-52 max-w-[calc(100vw-16px)] overflow-y-auto p-1.5";
const HEAD = "truncate px-2.5 pt-2 pb-0.5 text-xs text-ink-3 select-none first:pt-1";

function Sub({ icon, label, now, i, children }: { icon: ReactNode; label: string; now?: string; i: number; children: ReactNode }) {
  return (
    <Menu.SubmenuRoot>
      <Menu.SubmenuTrigger style={{ "--i": i } as CSSProperties} className={ITEM}>
        <span className="text-ink-2">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {now && <span className="max-w-28 truncate text-xs text-ink-3">{now}</span>}
        <ChevronRight size={14} className="text-ink-4" />
      </Menu.SubmenuTrigger>
      <Menu.Portal>
        <Menu.Positioner className="z-50" sideOffset={4} collisionPadding={8}>
          <Menu.Popup className={cn(POPUP, SUB)}>
            <div className="g-stagger flex flex-col">{children}</div>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.SubmenuRoot>
  );
}

const check = (on: boolean) => <span className="grid size-3.5 place-items-center text-ink">{on && <Check size={14} />}</span>;

/** from: the place of its first item among the menu's, for the stagger. */
export default function ChannelMenu({ id, from = 0 }: { id: string; from?: number }) {
  useLang();
  const qc = useQueryClient();
  const list = useList();
  const members = useMembers(id);
  const viewers = useCarried<Viewer[]>(`viewers:${id}`) ?? [];
  const d = useApps().data;
  const may = mayAct(members);
  const set = (ms: ChannelMembers) => void qc.setQueryData<ChannelMembers>(["members", id], ms);
  const run = (f: () => Promise<ChannelMembers>) => void f().then(set, (e) => toast(memberError(e), { error: true }));
  const agents = (members?.members ?? []).filter((m) => m.session);
  const people = peopleOf(members);
  const apps = (d?.apps ?? []).filter((a) => !a.host);
  const ids = apps.map((a) => a.id);
  const loginsOf = (app: string) => (d?.logins ?? []).filter((l) => l.app === app);
  const idsOf = (app: string) => loginsOf(app).map((l) => l.id);
  const setPeople = (p: string[]) => run(() => api.setPeople(id, p));
  const recvWord = (r: string) => (r === "all" ? t("channel.recvAll") : t("channel.recvAt"));
  return (
    <>
      <div style={{ "--i": from } as CSSProperties} className="flex min-h-8 items-center gap-2.5 px-2.5 text-base select-none pointer-coarse:min-h-11" role="group" aria-label={t("channel.viewing")}>
        <span className="text-ink-2">
          <Eye size={15} />
        </span>
        <span className="shrink-0">{t("channel.viewing")}</span>
        <span className="ml-auto flex min-w-0 items-center gap-1 text-xs text-ink-3">
          {viewers.slice(0, 5).map((v) => (
            <Avatar key={v.member} name={v.name} size={16} />
          ))}
          <span className="truncate">{viewers.length === 1 ? viewers[0]!.name : viewers.length}</span>
        </span>
      </div>
      <Sub icon={<Users size={15} />} label={t("channel.members")} now={`${agents.length || 1} · ${everyone(people) ? t("channel.everyone") : t("channel.peopleN", { n: people.length })}`} i={from + 1}>
        <div className={HEAD}>{t("channel.agents")}</div>
        {agents.map((m) => {
          const row = list?.find((x) => x.id === m.session);
          const own = m.send !== "ir";
          return (
            <Sub key={m.member} icon={<Logo agent={m.agent ?? row?.agent ?? "claude"} size={16} />} label={m.nick || agentName(m.agent ?? row?.agent ?? "claude")} now={own ? t("channel.direct") : recvWord(m.recv)} i={0}>
              <div className={HEAD}>{m.name}</div>
              <div className={HEAD}>{t("channel.recv")}</div>
              <Menu.RadioGroup value={m.recv} onValueChange={(v) => may && run(() => api.patchMember(id, m.member, { recv: v as string }))}>
                {["all", "at"].map((r) => (
                  <Menu.RadioItem key={r} value={r} disabled={!may} closeOnClick className={ITEM}>
                    <span className="flex-1">{recvWord(r)}</span>
                    <Menu.RadioItemIndicator>
                      <Check size={14} />
                    </Menu.RadioItemIndicator>
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
              {m.session !== id && (
                <Menu.Item onClick={() => openChat(m.session!)} className={ITEM}>
                  {t("channel.session")}
                </Menu.Item>
              )}
              {!own && may && (
                <Menu.Item onClick={() => run(() => api.removeMember(id, m.member))} className={cn(ITEM, "text-err")}>
                  {t("channel.remove")}
                </Menu.Item>
              )}
              {row && (
                <div className="flex h-7 items-center gap-2 px-2.5 text-xs text-ink-3">
                  <Lamp status={row.status} />
                  <span className="truncate">{row.cwd}</span>
                </div>
              )}
            </Sub>
          );
        })}
        <div className={HEAD}>{t("channel.people")}</div>
        <div className="flex h-8 items-center px-2.5 text-base text-ink-2 pointer-coarse:h-11">{everyone(people) ? t("channel.everyone") : t("channel.peopleN", { n: people.length })}</div>
      </Sub>
      {may && (
        <Menu.Item onClick={() => requestAnimationFrame(() => pickFace(id))} style={{ "--i": from + 3 } as CSSProperties} className={ITEM}>
          <span className="text-ink-2">
            <ImagePlus size={15} />
          </span>
          {t("channel.avatar")}
        </Menu.Item>
      )}
      {may && (
        <Sub icon={<UserPlus size={15} />} label={t("channel.invite")} i={from + 2}>
          <div className={HEAD}>{t("channel.agents")}</div>
          <AgentKinds id={id} />
          {apps.length > 0 && <div className={HEAD}>{t("channel.people")}</div>}
          {apps.map((a) => {
            const name = a.web ? t("term.panel") : a.name;
            const logins = loginsOf(a.id);
            return (
              <Sub key={a.id} icon={<Avatar src={a.avatar} name={a.name} size={16} type={a.type} />} label={name} now={hasApp(people, a.id) ? t("channel.everyone") : String(logins.filter((l) => hasLogin(people, a.id, l.id)).length || "")} i={0}>
                <Menu.Item closeOnClick={false} disabled={members?.me === appAll(a.id)} onClick={() => setPeople(pressApp(people, ids, idsOf, a.id, members?.me))} className={ITEM}>
                  {check(hasApp(people, a.id))}
                  <span className="flex-1 font-medium">{t("channel.everyone")}</span>
                </Menu.Item>
                {logins.map((l) => (
                  <Menu.Item key={l.id} closeOnClick={false} disabled={members?.me === loginOf(a.id, l.id)} onClick={() => setPeople(pressLogin(people, ids, idsOf, a.id, l.id, members?.me))} className={ITEM}>
                    {check(hasLogin(people, a.id, l.id))}
                    <Avatar src={l.avatar} name={l.name} size={16} />
                    <span className="min-w-0 flex-1 truncate">{l.name}</span>
                  </Menu.Item>
                ))}
              </Sub>
            );
          })}
        </Sub>
      )}
    </>
  );
}

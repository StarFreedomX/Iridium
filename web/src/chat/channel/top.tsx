// A channel at the top of the chat (the user, 2026-11-13): who is looking at it now and its
// members (what each receives, each agent's context as a ring) at the bar's right, each a key of
// its own; 邀请 among the members: agents (invite.tsx) and people, an app a submenu of its
// logins. An agent's row opens the menu its face has (members.tsx MemberItems: one
// implementation). The face is the title's key (chat.tsx): its card, 编辑资料 in it; on a phone in ⋯.
import { Menu } from "@base-ui/react/menu";
import { useQueryClient } from "@tanstack/react-query";
import { useQuery } from "../../api/query";
import { Check, ChevronLeft, PencilLine, Plus, Users } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { api } from "../../api/client";
import type { Agent, ChannelMembers, Role, Script, Viewer } from "../../api/types.gen";
import { agentsQ, isComputer, useApps, useMachines } from "../../data";
import { t, useLang } from "../../i18n";
import { useMachine } from "../../machines";
import { prefetchRoles, roleStart } from "../../roles";
import { openChat } from "../../route";
import { useCarried, useList, useSession } from "../../store";
import { working } from "../../tree";
import { toast } from "../../toast";
import { agentName, Avatar, cn, Lamp, Tip, MenuPortal } from "../../ui";
import { openEdit } from "./editing";
import { Face, MemberFace } from "./face";
import { ContextMark } from "../meters";
import { mayAct, useMembers } from "./gate";
import { AddAgents, ITEM, KindPage, POPUP, RolePreview, useAdd, type Wake } from "./invite";
import { Deeper, Paged, usePaged } from "./pages";
import { Tall } from "../../create";
import { onAskAdd, takeAdd } from "./adding";
import type { Machine } from "../../machines";
import { prefetchChoices } from "./pick";
import { useAhead } from "../../prefetch";
import { memberError } from "./key";
import type { AgentRow } from "./lib";
import { MemberAsks, MemberItems, type Ask } from "./members";
import { ScriptFace, ScriptPop, scriptState, useScripts, type ScriptPage } from "./script";
import { onOf, ruleLine } from "./scripts";
import { triggerWords, useRecvName } from "./recv";
import { actsOf } from "./menu";
import { subName, SubTag } from "../subwork";
import { appAll, hasApp, hasLogin, loginOf, peopleOf, pressApp, pressLogin } from "./setup";

const SUB = "no-bar max-h-[min(480px,var(--available-height))] min-w-60 max-w-[calc(100vw-16px)] overflow-y-auto p-1.5";
const HEAD = "truncate px-2.5 pt-2 pb-0.5 text-xs text-ink-3 select-none first:pt-1";

/** bare: no mark at the row's end (the + panel's rows: kumo, 2026-11-25). */
function Sub({ icon, label, lead, now, i, bare, children }: { icon: ReactNode; label: string; lead?: ReactNode; now?: string; i: number; bare?: boolean; children: ReactNode }) {
  return (
    <Deeper
      row={
        <>
          <span className="text-ink-2">{icon}</span>
          {lead}
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {now && <span className="max-w-36 truncate text-xs text-ink-3">{now}</span>}
        </>
      }
      title={label}
      i={i}
      bare={bare}
      popup={cn(POPUP, SUB)}
    >
      <div className="g-stagger flex flex-col">{children}</div>
    </Deeper>
  );
}

const check = (on: boolean) => <span className="grid size-3.5 place-items-center text-ink">{on && <Check size={14} />}</span>;

/** The bar's right (the user, 2026-11-13): who is looking now, their faces, pressed their names;
 *  the members, a key with the faces and the count of who is looking, opening the list of them. */
export function TopRight({ id }: { id: string }) {
  useLang();
  const qc = useQueryClient();
  const list = useList();
  // The first screen can arrive before the sidebar's list.
  const row = useSession(id) ?? list?.find((x) => x.id === id);
  const here = useMachine(row?.machine);
  const local = (useQuery(agentsQ).data ?? []).filter((a) => !a.missing).map((a) => a.agent);
  const kinds = row?.machine ? (here?.online ? here.agents.map((a) => a.agent as Agent) : []) : local;
  const machines = useMachines(!!row?.machine);
  const members = useMembers(id);
  // The other computers' kinds too, where they would run (invite.tsx); its agents' own model
  // menus too (members.tsx MemberItems: at their machine, none: here).
  const ahead = () => {
    prefetchRoles();
    prefetchChoices(qc, kinds, { channel: id });
    for (const m of members?.members ?? []) if (m.session && m.agent) prefetchChoices(qc, [m.agent as Agent], { machine: list?.find((x) => x.id === m.session)?.machine || undefined });
    for (const m of machines) if (m.online && m.id !== row?.machine) prefetchChoices(qc, m.agents.map((a) => a.agent as Agent), { machine: m.id });
  };
  const keyAhead = useAhead(ahead, [id, kinds.join(" "), members?.members.length]);
  const viewers = useCarried<Viewer[]>(`viewers:${id}`) ?? [];
  // What an agent's menu asks with from the list (清空, 移出, 注入记录): the cards the face's
  // menu asks with, under the members' key.
  const key = useRef<HTMLButtonElement>(null);
  const [asked, setAsked] = useState<Ask | null>(null);
  // A script's card, or a new one, out of the members' key (script.tsx): its pages in one popover.
  const [script, setScript] = useState<ScriptPage | null>(null);
  // The + open by itself on a channel just made with no agent (create.tsx), once it may be
  // pressed (its members known).
  const may = mayAct(members);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    const take = () => may && takeAdd(id) && (ahead(), setAdding(true));
    take();
    return onAskAdd(take);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, may]);
  // Asked for as the bar is drawn: the list and each card open whole.
  useScripts(id);
  return (
    <span className="g-fade flex shrink-0 items-center gap-0.5">
      {/* Each kind's models asked for once idle and as the key is pointed at, pressed or opened,
          for 邀请's menus to pop at once (pick.tsx). */}
      <Menu.Root onOpenChange={(open) => open && ahead()}>
        <Tip label={t("channel.members")} side="bottom">
          <Menu.Trigger
            render={
              <button ref={key} type="button" aria-label={t("channel.members")} {...keyAhead} className="g-press flex h-8 items-center gap-1 rounded-md px-2 text-ink-2 hover:bg-fill hover:text-ink data-popup-open:bg-fill pointer-coarse:h-10">
                {/* Who is looking, their faces in place of the icon and how many they are: one key,
                    not two side by side; the members' count said nothing (kumo, 2026-11-25). The
                    names at the menu's head. */}
                {viewers.length ? (
                  <span className="flex items-center">
                    {viewers.slice(0, 3).map((v, i) => (
                      <span key={v.member} className="grid rounded-full ring-2 ring-paper" style={{ marginLeft: i ? -5 : 0, zIndex: 3 - i }}>
                        <MemberFace member={v.member} name={v.name} size={18} />
                      </span>
                    ))}
                  </span>
                ) : (
                  <Users size={16} />
                )}
                {viewers.length > 0 && <span className="text-xs tabular-nums">{viewers.length}</span>}
              </button>
            }
          />
        </Tip>
        <MenuPortal>
          <Menu.Positioner side="bottom" align="end" sideOffset={6} collisionPadding={8} className="z-50">
            <Menu.Popup finalFocus={false} className={cn(POPUP, SUB, "w-[min(344px,calc(100vw-16px))]")}>
              <Paged>
                <div className="g-stagger flex flex-col">
                  <MemberList id={id} viewers={viewers} ask={setAsked} script={(p) => requestAnimationFrame(() => setScript(p))} />
                </div>
              </Paged>
            </Menu.Popup>
          </Menu.Positioner>
        </MenuPortal>
      </Menu.Root>
      {/* 邀请, a key of its own (kumo, 2026-11-25): what it opens is the agents to add and the people. */}
      {may && (
        <Menu.Root open={adding} onOpenChange={(open) => (setAdding(open), open && ahead())}>
          <Tip label={t("channel.invite")} side="bottom">
            <Menu.Trigger
              render={
                <button type="button" aria-label={t("channel.invite")} {...keyAhead} className="g-press grid size-8 place-items-center rounded-md text-ink-2 hover:bg-fill hover:text-ink data-popup-open:bg-fill pointer-coarse:size-10">
                  <Plus size={16} />
                </button>
              }
            />
          </Tip>
          <MenuPortal>
            <Menu.Positioner side="bottom" align="end" sideOffset={6} collisionPadding={8} className="z-50">
              <Menu.Popup finalFocus={false} className={cn(POPUP, SUB, "w-[min(344px,calc(100vw-16px))]")}>
                <Invite id={id} />
              </Menu.Popup>
            </Menu.Positioner>
          </MenuPortal>
        </Menu.Root>
      )}
      <MemberAsks channel={id} anchor={key} asked={asked} done={() => setAsked(null)} />
      <ScriptPop channel={id} anchor={key} page={script} done={() => setScript(null)} align="end" />
    </span>
  );
}

/** The members: who is looking first, if any; each agent a submenu, the menu its face has (members.tsx MemberItems; what it
 *  asks with, ask, drawn by the bar); the commands of its IR,
 *  each pressed its card (script), and 新建脚本; then 邀请. */
function MemberList({ id, viewers, ask, script }: { id: string; viewers: Viewer[]; ask: (a: Ask) => void; script: (p: ScriptPage) => void }) {
  const list = useList();
  const scripts = useScripts(id) ?? [];
  const members = useMembers(id);
  const may = mayAct(members);
  const agents = (members?.members ?? []).filter((m) => m.session);
  const own = list?.find((x) => x.id === id);
  const subs = (list ?? []).filter((x) => x.subagent && x.parent === id && working(x, own, Date.now()));
  // What the channel's page lends: its composer's @, its way to a session's record.
  const lent = actsOf(id);
  return (
    <>
      {viewers.length > 0 && (
        <>
          <div className={HEAD}>{t("channel.viewing")}</div>
          {viewers.map((v) => (
            <div key={v.member} className="flex h-8 items-center gap-2.5 px-2.5 text-base pointer-coarse:h-11">
              <MemberFace member={v.member} name={v.name} size={18} />
              <span className="min-w-0 flex-1 truncate">{v.name}</span>
            </div>
          ))}
        </>
      )}
      <div className={HEAD}>{t("channel.agents")}</div>
      {agents.map((m) => {
        const row = list?.find((x) => x.id === m.session);
        const agent = m.agent ?? row?.agent ?? "claude";
        const a: AgentRow = { session: m.session!, member: m.member, agent, nick: m.nick ?? "", name: m.name ?? agentName(agent), status: m.status ?? row?.status ?? "idle", on: onOf(m.on) };
        return (
          <Sub key={m.member} icon={<Face id={m.session!} agent={agent} size={16} />} lead={<ContextMark session={m.session!} />} label={m.nick || agentName(agent)} i={0}>
            <MemberItems channel={id} a={a} may={may} call={lent.call} record={lent.record} ask={(kind) => ask({ kind, a })} />
          </Sub>
        );
      })}
      {/* Its subagents at work (kumo, 2026-11-15): members that only read, pressed their record;
          no @, no menu. */}
      {subs.length > 0 && <div className={HEAD}>{t("channel.subsAtWork")}</div>}
      {subs.map((x) => (
        <Menu.Item key={x.id} onClick={() => openChat(x.id)} className={ITEM}>
          <SubTag agent={x.agent} name={subName(x)} className="flex-1 gap-2.5" />
          <Lamp status="running" />
        </Menu.Item>
      ))}
      {/* The channel's commands (docs/channels.md "命令"), if it has any: a row each, pressed its
          card. What wakes an agent is not listed here (kumo, 2026-11-24): it is the agent's own,
          in its 唤醒 and its 编辑资料. */}
      <Commands id={id} scripts={scripts} script={script} />
      {/* No 人 / 所有人 here (kumo, 2026-11-16), no 邀请 (kumo, 2026-11-25): the + beside the key. */}
    </>
  );
}

/** The commands: a row each, its sentence ("每天 09:00 → 日报") and its state. */
function Commands({ id, scripts, script }: { id: string; scripts: Script[]; script: (p: ScriptPage) => void }) {
  const name = useRecvName(id);
  const w = triggerWords();
  if (!scripts.length) return null;
  return (
    <>
      <div className={HEAD}>{t("script.group")}</div>
      {scripts.map((x) => {
        const state = scriptState(x);
        return (
          <Menu.Item key={x.name} onClick={() => script({ k: "card", name: x.name })} className={ITEM}>
            <ScriptFace size={16} />
            <span className="min-w-0 flex-1 truncate">{t("on.to", { line: x.on.map((tr) => ruleLine(tr, name, w)).join(t("on.or")), who: x.name })}</span>
            {state && <span className={cn("shrink-0 text-xs", x.enabled ? "text-err" : "text-ink-3")}>{state}</span>}
          </Menu.Item>
        );
      })}
    </>
  );
}

/** What the + beside the members' key opens (kumo, 2026-11-25): the agents to add (invite.tsx),
 *  then the people (an app a submenu of its logins). */
function Invite({ id }: { id: string }) {
  const qc = useQueryClient();
  const members = useMembers(id);
  const d = useApps().data;
  const set = (ms: ChannelMembers) => void qc.setQueryData<ChannelMembers>(["members", id], ms);
  const run = (f: () => Promise<ChannelMembers>) => void f().then(set, (e) => toast(memberError(e), { error: true }));
  const people = peopleOf(members);
  // No computers: they are not invited (the owner, 2026-11-14).
  const apps = (d?.apps ?? []).filter((a) => !isComputer(a));
  const ids = apps.map((a) => a.id);
  const loginsOf = (app: string) => (d?.logins ?? []).filter((l) => l.app === app);
  const idsOf = (app: string) => loginsOf(app).map((l) => l.id);
  const setPeople = (p: string[]) => run(() => api.setPeople(id, p));
  // In the phone's layout no menu beside a row (kumo, 2026-11-25): pressed, what
  // it would open is the panel's next page, 返回 at its head. The list stays as it was left under
  // it (the computer picked), only not drawn.
  const paged = usePaged();
  const [page, setPage] = useState<{ k: Agent; m?: Machine } | { role: Role; m?: Machine } | { app: string } | null>(null);
  // What wakes the one added (kumo, 2026-11-25): the channel's first agent, only the one adding
  // it; one added after, only its @. As the panel opens; a press changes it.
  const [picked, setWake] = useState<Wake | null>(null);
  const wake: Wake = picked ?? ((members?.members ?? []).some((m) => m.session) ? "at" : "self");
  const { busy, add } = useAdd(id, wake);
  const stepped = useRef(false);
  if (page) stepped.current = true;
  const loginRows = (app: string) => (
    <>
      <Menu.Item closeOnClick={false} disabled={members?.me === appAll(app)} onClick={() => setPeople(pressApp(people, ids, idsOf, app, members?.me))} className={ITEM}>
        {check(hasApp(people, app))}
        <span className="flex-1 font-medium">{t("channel.everyone")}</span>
      </Menu.Item>
      {loginsOf(app).map((l) => (
        <Menu.Item key={l.id} closeOnClick={false} disabled={members?.me === loginOf(app, l.id)} onClick={() => setPeople(pressLogin(people, ids, idsOf, app, l.id, members?.me))} className={ITEM}>
          {check(hasLogin(people, app, l.id))}
          <Avatar src={l.avatar} name={l.name} size={16} />
          <span className="min-w-0 flex-1 truncate">{l.name}</span>
        </Menu.Item>
      ))}
    </>
  );
  return (
    <Tall>
      {/* Back from a page, the list comes in from the other side; as the panel opens it does not slide. */}
      <div data-dir="back" className={cn("flex flex-col", stepped.current ? "g-slide" : "g-stagger", page && "hidden")}>
        <AddAgents id={id} wake={wake} setWake={setWake} onKind={paged ? (k, m) => setPage({ k, m }) : undefined} onRole={paged ? (role, m) => setPage({ role, m }) : undefined} />
        {apps.length > 0 && <div role="separator" className="mx-2.5 my-1 border-t border-(--edge)" />}
        {apps.map((a) => {
          const name = a.web ? t("term.panel") : a.name;
          const now = hasApp(people, a.id) ? t("channel.everyone") : String(loginsOf(a.id).filter((l) => hasLogin(people, a.id, l.id)).length || "");
          const icon = <Avatar src={a.avatar} name={a.name} size={16} type={a.type} host={!!a.host} />;
          return paged ? (
            <Menu.Item key={a.id} closeOnClick={false} onClick={() => setPage({ app: a.id })} className={ITEM}>
              <span className="text-ink-2">{icon}</span>
              <span className="min-w-0 flex-1 truncate">{name}</span>
              {now && <span className="max-w-36 truncate text-xs text-ink-3">{now}</span>}
            </Menu.Item>
          ) : (
            <Sub key={a.id} icon={icon} label={name} now={now} i={0} bare>
              {loginRows(a.id)}
            </Sub>
          );
        })}
      </div>
      {page && (
        <div className="g-slide flex flex-col">
          <Menu.Item closeOnClick={false} onClick={() => setPage(null)} className={cn(ITEM, "text-ink-2")}>
            <ChevronLeft size={15} />
            <span className="min-w-0 flex-1 truncate">{"app" in page ? ((x) => (x?.web ? t("term.panel") : x?.name))(apps.find((a) => a.id === page.app)) : "role" in page ? page.role.name : agentName(page.k)}</span>
          </Menu.Item>
          {"app" in page ? (
            loginRows(page.app)
          ) : "role" in page ? (
            // Its card inside the panel's padding, its corners round as the panel's rows.
            <div className="overflow-hidden rounded-md">
              <RolePreview role={page.role} at={page.m ? { machine: page.m.id } : { channel: id }} off={busy !== null} busy={busy === `role:${page.role.id}`} add={() => void add(page.role.agent, "", "", "", roleStart(page.role), page.m).then(() => setPage(null))} />
            </div>
          ) : (
            <KindPage id={id} k={page.k} m={page.m} wake={wake} done={() => setPage(null)} />
          )}
        </div>
      )}
    </Tall>
  );
}

/** ⋯'s part: on a phone, where the title's logo opens the list, 编辑资料 (out of ⋯: chat.tsx
 *  EditAt; elsewhere the face's card turns into it). from: the place of its item among the menu's, for the stagger. */
export default function ChannelMenu({ id, from = 0, face }: { id: string; from?: number; face?: boolean }) {
  useLang();
  const members = useMembers(id);
  const may = mayAct(members);
  if (!may || !face) return null;
  return (
    <Menu.Item onClick={() => requestAnimationFrame(() => openEdit({ channel: id }))} style={{ "--i": from } as CSSProperties} className={ITEM}>
      <span className="text-ink-2">
        <PencilLine size={15} />
      </span>
      {t("profile.edit")}
    </Menu.Item>
  );
}

package api

import "encoding/json"

// ChannelMember is a member of a channel (docs/channels.md). Member: "agent:<session>", an
// app's login "<app>/<login>", or all of an app's "<app>/*". An agent's: Session, the session
// it is; Agent, its harness; Name, what it runs as now ("Claude Opus 5.5 High"); Nick, what it is
// called by, in every channel (@nick); Status, its lamp; Cwd, Machine, where it runs. Recv: an
// agent's "all" (what people say) or "at" (only what names it); a person's "all" or "mine".
// Send: how an agent speaks in the channel: "direct" (its turns are said there: the channel is
// its own) or "ir" (what it sends with ir, and its turn's reply, said there for it). Seen: the number of the last message the agent
// was given.
type ChannelMember struct {
	Member  string `json:"member"`
	Session string `json:"session,omitempty"`
	Agent   Agent  `json:"agent,omitempty"`
	Name    string `json:"name,omitempty"`
	Nick    string `json:"nick,omitempty"`
	Recv    string `json:"recv"`
	Send    string `json:"send,omitempty"`
	Seen    int64  `json:"seen,omitempty"`
	Status  Status `json:"status,omitempty"`
	Cwd     string `json:"cwd,omitempty"`
	Machine string `json:"machine,omitempty"`
}

// ChannelMembers are a channel's members: Channel, its id; Multi, it has more than one agent or
// is no session's (people call its agents by @nick; an agent then gets only what it is given).
type ChannelMembers struct {
	Channel string          `json:"channel"`
	Multi   bool            `json:"multi"`
	Members []ChannelMember `json:"members"`
	// Joined: the caller is one of its people (may speak, answer, change the members); not
	// joined, it only reads. Me: the member the caller is as a login ("<app>/<login>").
	Joined bool   `json:"joined"`
	Me     string `json:"me,omitempty"`
}

// NewMember adds an agent to a channel: Session, a session there is; else a new session of
// Agent (Model, Mode, Effort, Preset as NewSession's) started in Cwd at Machine (none: the
// channel's folder), listed there as any session. Nick: what it is called by ("": the one it
// has, else one made); Recv: what it receives ("": "at").
type NewMember struct {
	Session string `json:"session,omitempty"`
	Agent   Agent  `json:"agent,omitempty"`
	Cwd     string `json:"cwd,omitempty"`
	Machine string `json:"machine,omitempty"`
	Model   string `json:"model,omitempty"`
	Mode    string `json:"mode,omitempty"`
	Effort  string `json:"effort,omitempty"`
	Preset  string `json:"preset,omitempty"`
	Nick    string `json:"nick,omitempty"`
	Recv    string `json:"recv,omitempty"`
}

// MemberPatch changes a member: its nick, what it receives.
type MemberPatch struct {
	Nick *string `json:"nick,omitempty"`
	Recv *string `json:"recv,omitempty"`
}

// Injection is what an agent was given once (docs/channels.md "可追溯"): for message Seq of
// its channel, as input Input, at At (ms); Record says where each part of it came from
// (assemble.Record: the fragment and its hash, the values its slots took, the messages cited).
type Injection struct {
	ID int64 `json:"id"`
	// Channel: the channel the message is of (the session's own, or one it is in).
	Channel string          `json:"channel,omitempty"`
	Seq     int64           `json:"seq,omitempty"`
	Input   string          `json:"input,omitempty"`
	At      int64           `json:"at"`
	Record  json.RawMessage `json:"record"`
}

// ChannelAgent is an agent of a channel as the list of sessions has it: its session, its
// harness, the nick it is called by.
type ChannelAgent struct {
	Session string `json:"session"`
	Agent   Agent  `json:"agent,omitempty"`
	Nick    string `json:"nick,omitempty"`
}

// Spawned is where a session was started for a channel: Channel, the channel; By, the session
// whose agent started it ("": a person did).
type Spawned struct {
	By      string `json:"by,omitempty"`
	Channel string `json:"channel"`
}

// ChannelSetup is who a new session's channel has beside its own agent. Agents: more agents,
// each a session of its own (NewMember), in it by a subscription: called by what names it, its
// turn's reply said there for it. People: who may speak in it ("*" everyone, "<app>/*",
// "<app>/<login>"); none: the panel's logins and the host's. The one who makes it is always
// one of them.
type ChannelSetup struct {
	Agents []NewMember `json:"agents,omitempty"`
	People []string    `json:"people,omitempty"`
	// Nick, Recv: the first agent's own (the session's), as NewMember's; "": made, "all".
	Nick string `json:"nick,omitempty"`
	Recv string `json:"recv,omitempty"`
}

// Follow is what an agent asks to be given of a channel beside what names it (POST
// …/follow): the next Count messages (none: 1) of User (a nick, a user's id, "*" anyone) within
// Seconds (none: 600).
type Follow struct {
	User    string `json:"user"`
	Count   int    `json:"count,omitempty"`
	Seconds int    `json:"seconds,omitempty"`
}

// ChannelReads is how far each member has read a channel (GET …/reads, the carried state
// "reads:<channel>"): End, the number of its last message; Readers, a person a login that
// opened it, an agent each one in it. Who has read message n: those whose Seq is n or more.
type ChannelReads struct {
	Channel string   `json:"channel"`
	End     int64    `json:"end"`
	Readers []Reader `json:"readers"`
}

// Reader is how far Member (a login "<app>/<login>", an agent "agent:<session>") has read: Seq,
// the number of the last message it read (an agent: was given), at At (ms; a person's). Name:
// what it goes by; Nick, Agent: an agent's.
type Reader struct {
	Member string `json:"member"`
	Name   string `json:"name,omitempty"`
	Nick   string `json:"nick,omitempty"`
	Agent  Agent  `json:"agent,omitempty"`
	Seq    int64  `json:"seq"`
	At     int64  `json:"at,omitempty"`
}

// Viewer is someone looking at a channel now (the carried state "viewers:<channel>", a list of
// them): Member, the login ("<app>/<login>"); Name, what it goes by; Pages, how many of its
// pages have the channel open; Since, when the first did (ms).
type Viewer struct {
	Member string `json:"member"`
	Name   string `json:"name,omitempty"`
	Pages  int    `json:"pages"`
	Since  int64  `json:"since"`
}

// Read moves the caller's place in a channel up to message Seq (POST …/read).
type Read struct {
	Seq int64 `json:"seq"`
}

// Outline is a session's record by turn (POST internal/block.outline): between what an agent
// did in counts and the record whole. Start, End: the lines of the record it spans; More: there
// are earlier turns.
type Outline struct {
	Turns []OutlineTurn `json:"turns"`
	Start int64         `json:"start"`
	End   int64         `json:"end"`
	More  bool          `json:"more,omitempty"`
}

// OutlineTurn is one turn of a record in a line: At, End, the blocks it begins and ends with
// (block.list reads between them); Time, when it began (ms); From, who asked; Asked, their first
// words; Did, what the agent did in it (activity.Activity: bash, failed, cmds, read, search,
// fetch, agents, other, files, ms); Said, the first words of the last thing it said; Words,
// how many times it spoke.
type OutlineTurn struct {
	At    string          `json:"at"`
	End   string          `json:"end"`
	Time  int64           `json:"time,omitempty"`
	From  string          `json:"from,omitempty"`
	Asked string          `json:"asked,omitempty"`
	Did   json.RawMessage `json:"did,omitempty"`
	Said  string          `json:"said,omitempty"`
	Words int             `json:"words,omitempty"`
}

// People sets a channel's people (PUT …/people).
type People struct {
	People []string `json:"people"`
}

// AgentChoices is what a new agent of a kind may be started with at a machine, as the latest
// session of that kind there said it: its models (each with its own efforts) and efforts. None
// known (no session of the kind ran there yet): empty, and the agent's own defaults go.
// Presets: an agent with presets (dsh): those a session of it there listed last.
type AgentChoices struct {
	Models  []Model  `json:"models"`
	Efforts []string `json:"efforts"`
	Presets *Presets `json:"presets,omitempty"`
}

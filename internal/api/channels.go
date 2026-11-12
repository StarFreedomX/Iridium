package api

import "encoding/json"

// ChannelMember is a member of a channel (docs/channels.md). Member: "agent:<session>", an
// app's login "<app>/<login>", or all of an app's "<app>/*". An agent's: Session, the session
// it is; Agent, its harness; Name, what it runs as now ("Claude Opus 5.5 High"); Nick, what it is
// called by in the channel (@nick); Status, its lamp. Recv: an agent's "all" (what people say)
// or "at" (only what names it); a person's "all" or "mine". Seen: the number of the last
// message the agent was given.
type ChannelMember struct {
	Member  string `json:"member"`
	Session string `json:"session,omitempty"`
	Agent   Agent  `json:"agent,omitempty"`
	Name    string `json:"name,omitempty"`
	Nick    string `json:"nick,omitempty"`
	Recv    string `json:"recv"`
	Seen    int64  `json:"seen,omitempty"`
	Status  Status `json:"status,omitempty"`
}

// ChannelMembers are a channel's members: Channel, its id; Multi, it has more than one agent
// (people call them by @nick; an agent then gets only what it is given).
type ChannelMembers struct {
	Channel string          `json:"channel"`
	Multi   bool            `json:"multi"`
	Members []ChannelMember `json:"members"`
	// Joined: the caller is one of its people (may speak, answer, change the members); not
	// joined, it only reads. Me: the member the caller is as a login ("<app>/<login>").
	Joined bool   `json:"joined"`
	Me     string `json:"me,omitempty"`
}

// NewMember adds an agent to a channel: a new session of Agent started in the channel's folder
// (Model, Mode, Effort, Preset as NewSession's), under Nick ("": one made), receiving Recv
// ("": "at").
type NewMember struct {
	Agent  Agent  `json:"agent"`
	Model  string `json:"model,omitempty"`
	Mode   string `json:"mode,omitempty"`
	Effort string `json:"effort,omitempty"`
	Preset string `json:"preset,omitempty"`
	Nick   string `json:"nick,omitempty"`
	Recv   string `json:"recv,omitempty"`
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
	ID     int64           `json:"id"`
	Seq    int64           `json:"seq,omitempty"`
	Input  string          `json:"input,omitempty"`
	At     int64           `json:"at"`
	Record json.RawMessage `json:"record"`
}

// ChannelAgent is an agent of a channel as the list of sessions has it: its session, its
// harness, the nick it is called by.
type ChannelAgent struct {
	Session string `json:"session"`
	Agent   Agent  `json:"agent,omitempty"`
	Nick    string `json:"nick,omitempty"`
}

// ChannelSetup is who a new session's channel has beside its own agent. Agents: more agents,
// each a new session in the same folder. People: who may speak in it ("*" everyone, "<app>/*",
// "<app>/<login>"); none: everyone. The one who makes it is always one of them.
type ChannelSetup struct {
	Agents []NewMember `json:"agents,omitempty"`
	People []string    `json:"people,omitempty"`
	// Nick, Recv: the first agent's own (the session's), as NewMember's; "": made, "all".
	Nick string `json:"nick,omitempty"`
	Recv string `json:"recv,omitempty"`
}

// People sets a channel's people (PUT …/people).
type People struct {
	People []string `json:"people"`
}

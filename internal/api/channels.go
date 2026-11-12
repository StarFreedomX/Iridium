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

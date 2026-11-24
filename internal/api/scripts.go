package api

// Script is a script of a channel (docs/channels.md "脚本"): a command line the channel's IR
// (Iridium itself, one of every channel's members) runs when one of its triggers (On) fires, in
// the channel's folder at the host. What it prints is said in the channel under its name; with
// ir it may do anything else (IRIDIUM_SCRIPT names it, its words are said as its own).
// Name: one in the channel, as a nick is written; Avatar (an emoji, or a colour
// "#rrggbb"): its card. Enabled: off, it keeps its place and does not run. Made, Changed: who
// made it and who changed it last; Last: its latest run.
type Script struct {
	Channel string     `json:"channel"`
	Name    string     `json:"name"`
	Avatar  string     `json:"avatar,omitempty"`
	Run     string     `json:"run"`
	On      []Trigger  `json:"on"`
	Enabled bool       `json:"enabled"`
	Made    ScriptBy   `json:"made"`
	Changed ScriptBy   `json:"changed"`
	Last    *ScriptRun `json:"last,omitempty"`
	// Warn: what a change just made may lead to (a loop of subscriptions), a line each.
	Warn []string `json:"warn,omitempty"`
}

// Trigger is one subscription of a member of a channel (docs/channels.md "订阅事件"): what
// wakes an agent or runs a script; one of Message, Command, Cron, Event is set. Message: a
// message said in the channel (MessageTrigger). Command: a message that begins "/<command>" (a
// person's). Cron: a time, as cron writes it ("m h dom mon dow", the host's time zone). Event:
// a line of the channel's own or a message of an agent of these kinds (Events). Text: words an
// agent woken by it is given beside what woke it.
type Trigger struct {
	Message *MessageTrigger `json:"message,omitempty"`
	Command string          `json:"command,omitempty"`
	Cron    string          `json:"cron,omitempty"`
	Event   []string        `json:"event,omitempty"`
	Text    string          `json:"text,omitempty"`
}

// Events are what an event entry may wait for: a member joined or left (an agent, or people
// added or taken away), an agent renamed, someone's wake rules changed (an agent's, a
// command's), an agent's process ended badly, an agent asks (a question, an approval, a plan).
var Events = []string{"join", "leave", "rename", "wake", "error", "ask"}

// MessageTrigger: a message of a sender in From (as a receive set names them, Recv: "*" every
// person; none: anyone, an agent's turn's last words too) that has one of Words (none: any
// words; case is not minded). A script's own words never run a script.
type MessageTrigger struct {
	From  []string `json:"from,omitempty"`
	Words []string `json:"words,omitempty"`
}

// ScriptBy is who made or changed a script, and when (At, ms): Member, a login "<app>/<login>"
// or an agent "agent:<session>"; Name, what it goes by; an agent's Session, Nick, Model and
// Role (its role's name).
type ScriptBy struct {
	Member  string `json:"member,omitempty"`
	Name    string `json:"name,omitempty"`
	Session string `json:"session,omitempty"`
	Nick    string `json:"nick,omitempty"`
	Model   string `json:"model,omitempty"`
	Role    string `json:"role,omitempty"`
	At      int64  `json:"at"`
}

// NewScript adds a script to a channel (POST …/scripts). Enabled: none, on.
type NewScript struct {
	Name    string    `json:"name"`
	Avatar  string    `json:"avatar,omitempty"`
	Run     string    `json:"run"`
	On      []Trigger `json:"on"`
	Enabled *bool     `json:"enabled,omitempty"`
}

// ScriptPatch changes a script (PATCH …/scripts/{name}); what is not given stays.
type ScriptPatch struct {
	Name    *string    `json:"name,omitempty"`
	Avatar  *string    `json:"avatar,omitempty"`
	Run     *string    `json:"run,omitempty"`
	On      *[]Trigger `json:"on,omitempty"`
	Enabled *bool      `json:"enabled,omitempty"`
}

// ScriptRun is one run of a script: At, when it began (ms), Ms, how long it took; Trigger, what
// ran it (message, command, cron, event, hand); Seq, the message that did; Code, its exit code
// (-1: it did not finish, Err says why); Said, the message what it printed was said as; Out,
// Err, what it printed and its errors, cut.
type ScriptRun struct {
	ID      int64  `json:"id"`
	At      int64  `json:"at"`
	Ms      int64  `json:"ms"`
	Trigger string `json:"trigger"`
	Seq     int64  `json:"seq,omitempty"`
	Code    int    `json:"code"`
	Said    int64  `json:"said,omitempty"`
	Out     string `json:"out,omitempty"`
	Err     string `json:"err,omitempty"`
}

// ScriptTry runs a script by hand (POST …/scripts/{name}/run): Text, the words it is given as
// the message that ran it.
type ScriptTry struct {
	Text string `json:"text,omitempty"`
}

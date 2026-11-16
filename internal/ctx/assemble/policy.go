package assemble

import "strings"

// Policy: which pieces go when. Pure functions of what is known, apart from the text they
// choose (internal/prompts) and from how it is delivered.

// Where is where a hosted session's agent runs, as its system prompt depends on it.
type Where struct {
	// Remote: at another machine than Iridium's own (an executor's). IR: that machine has ir
	// (wire.Hello.IRClient); here there always is one.
	Remote, IR bool
	// Channel: the session is one agent of several in a channel (docs/channels.md): its title
	// is the channel's, set by people.
	Channel bool
	// Lang is the user's language as the web settings set it ("zh", "en"); "": not known.
	Lang string
	// Self: what the agent is told of itself (self.go); nil: nothing.
	Self *Self
}

// langs are the languages that have a name to tell the agent.
var langs = map[string]string{"zh": idLangZh, "en": idLangEn}

// systemPieces is the system prompt of a session at w. Here: ir's agent commands, how to ask
// for a secret, hand over a file, name and title. At another machine: with ir the commands it
// has there, without none; no file links (its files are that machine's, which ir attach there
// does not reach). Then the user's language, if known.
func systemPieces(w Where) []piece {
	var ps []piece
	switch {
	case !w.Remote:
		ps = append(ps, text(idHostIntro), help("agent"), help("layers"), text(idHostSecretsFiles))
	case w.IR:
		ps = append(ps, text(idRemoteIntro), help("remote"), help("layers"))
	default:
		ps = append(ps, text(idRemoteIntroBare))
	}
	ps = append(ps, text(idNames))
	if w.Channel {
		ps = append(ps, text(idChannelSystem))
	} else {
		ps = append(ps, text(idTitle))
	}
	if name := langs[w.Lang]; name != "" {
		ps = append(ps, text(idLang).filled("language", name))
	}
	return append(ps, selfPieces(w.Self)...)
}

// messagePieces is a message's line: the words after "[tag] ", the tag the sender's (its
// terminal's ID when it has none); a slash command as typed, which must reach the agent so.
func messagePieces(tag, terminal string, body piece, command bool) []piece {
	if command {
		return []piece{body}
	}
	if tag == "" {
		tag = terminal
	}
	return []piece{text(idMessageTag, "tag", tag), body}
}

// deniedPieces is what a call the user said no to is answered with: the words that came with
// the no, else Iridium's.
func deniedPieces(message, ask string) []piece {
	if message != "" {
		return []piece{words(message, Ref{Kind: "ask", ID: ask})}
	}
	return []piece{text(idAskDenied)}
}

// isCommand: the words are a slash command.
func isCommand(s string) bool { return strings.HasPrefix(s, "/") }

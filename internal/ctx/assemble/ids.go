package assemble

// The fragments (internal/prompts/texts/<id>.md) this package gives agents: every one of them,
// and each used (ids_test.go).
const (
	idHostIntro        = "host.intro"         // a session hosted here: what its ir reaches
	idHostSecretsFiles = "host.secrets-files" // how to ask for a secret, how to hand over a file
	idNames            = "names"              // how words name a session or a folder
	idTitle            = "title"              // title the session
	idLang             = "lang"               // the user's language: {{language}}
	idLangZh           = "lang.zh"            // a language's name, for lang
	idLangEn           = "lang.en"
	idRemoteIntro      = "remote.intro"       // a session at another machine that has ir there
	idRemoteIntroBare  = "remote.intro-bare"  // one without ir
	idMessageTag       = "message.tag"        // before a message: who it is from, {{tag}}
	idMessageAttach    = "message.attachment" // a file that came with a message: {{path}}
	idRecoverCrash     = "recover.crash"      // Iridium's own line after a crash mid-turn
	idRecoverQuota     = "recover.quota"      // and when the quota is back with nothing waiting
	idAskDenied        = "ask.denied"         // a no without words

	// A channel of several agents (channel.go).
	idChannelSystem     = "channel.system"             // in place of title: one agent of several
	idChannelMessage    = "channel.message"            // before the words: the message's number
	idChannelQuote      = "channel.quote"              // then the message it answers: its number, who said it
	idChannelQuoteEnd   = "channel.quote-end"
	idChannelGuest      = "channel.context.guest"      // who it is in a channel it is in by a subscription, and how it speaks there
	idChannelGuestBare  = "channel.context.guest-bare" // the same for an agent with no ir: its reply is said there for it
	idChannelAgain      = "channel.context.again"      // in place of those, given before: which channel this is
	idChannelSendUnseen = "channel.send.unseen"        // heads what an agent's ir is answered with: said since it last read
	idChannelSendBehind = "channel.send.behind"        // its ir refused: too far behind
	idChannelSendNamed  = "channel.send.named"         // its ir refused: something unseen names it
	idChannelSilent     = "channel.silent"             // to the agent that started one that said nothing where it was called
	idChannelOpen       = "channel.context.open"       // the block of what the channel said
	idChannelMembers    = "channel.context.members"    // who the agent is there, who else, how to call
	idChannelSkipped    = "channel.context.skipped"    // the earliest messages, not shown
	idChannelListed     = "channel.context.listed"     // heads the turns listed
	idChannelTurn       = "channel.context.turn"       // a turn in one line
	idChannelAnswered   = "channel.context.answered"   // who answered in it
	idChannelFull       = "channel.context.full"       // heads the messages in full
	idChannelLine       = "channel.context.line"       // before a message in full: its number, who, when
	idChannelLineDid    = "channel.context.line-did"   // then what its agent did before saying it
	idChannelLineEnd    = "channel.context.line-end"
	idChannelWork       = "channel.context.work"       // heads what each agent did since
	idChannelWorkLine   = "channel.context.work-line"  // an agent's line of it
	idChannelWorkFile   = "channel.context.work-files" // the files it changed

	// What an agent did, in few words (activity.go).
	idDidBash      = "activity.bash"
	idDidCmds      = "activity.cmds"
	idDidFailed    = "activity.failed"
	idDidFiles     = "activity.files"
	idDidRead      = "activity.read"
	idDidWeb       = "activity.web"
	idDidAgents    = "activity.agents"
	idDidOther     = "activity.other"
	idDidSep       = "activity.sep"
	idChannelCut   = "channel.context.cut"  // after one cut short: how to get the rest
	idChannelPull  = "channel.context.pull" // how to read more of the channel
	idChannelClose = "channel.context.close"
	idNL           = "nl" // a line's end
)

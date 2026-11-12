package assemble

// What Iridium gives agents, each as an Injection. An error is a fragment missing or its slots
// not matching: a broken build, which the tests catch.

// System is what is appended to a hosted agent's system prompt (plan "ir"), made anew at each
// start of its process.
func System(w Where) (Injection, error) {
	return build(KindSystem, systemPieces(w)...)
}

// Input is words that are not Iridium's, as they are: a person's or an app's message, with
// what names it (the input's id). A driver gets them through Message; alone they are for a
// test of one.
func Input(s string, refs ...Ref) Injection {
	in, _ := build(KindMessage, words(s, refs...)) // words alone cannot fail
	return in
}

// Message is the line an agent gets for message input from a sender: "[tag] " and the words
// (the terminal's ID for a sender without a tag); a slash command alone, as typed.
func Message(tag, terminal, said, input string) (Injection, error) {
	var refs []Ref
	if input != "" {
		refs = []Ref{{Kind: "input", ID: input}}
	}
	return build(KindMessage, messagePieces(tag, terminal, words(said, refs...), isCommand(said))...)
}

// Own is the line an agent gets for words of Iridium's own (Recovery, QuotaBack), from source
// (api.SourceIridium), as Message has a person's.
func Own(source string, own Injection) (Injection, error) {
	return build(KindMessage, messagePieces("", source, of(own), isCommand(own.String()))...)
}

// Recovery is what Iridium tells an agent that cannot run an interrupted turn again by itself.
func Recovery() (Injection, error) { return build(KindMessage, text(idRecoverCrash)) }

// QuotaBack goes when the quota is back and nothing else waits.
func QuotaBack() (Injection, error) { return build(KindMessage, text(idRecoverQuota)) }

// Attachment is the line a message gets for a file that came with it: its path where the
// agent runs, in inline code.
func Attachment(path string) (Injection, error) {
	return build(KindMessage, text(idMessageAttach, "path", path))
}

// Denied is what the agent's call is answered with after a no to ask: the words that came
// with it, or Iridium's for none.
func Denied(message, ask string) (Injection, error) {
	return build(KindToolResult, deniedPieces(message, ask)...)
}

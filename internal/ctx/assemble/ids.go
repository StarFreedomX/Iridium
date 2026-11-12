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
)

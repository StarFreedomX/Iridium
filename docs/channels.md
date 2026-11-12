# 频道

频道是人和 agent 说话的地方。频道的 ID 就是它最初那个会话的 ID；没有人改过成员的会话，自己就是一个频道：网页的全部登录，加它的 agent。用户定的（2026-11-12）。代码：`internal/channel`（记录、成员）、`internal/deliver`（叫起谁）、`internal/ctx/strategy`、`internal/ctx/assemble`、`internal/prompts`（给 agent 的上下文）、`internal/activity`（活动）、`internal/search`（搜索）、`internal/server/channels.go`（接口、路由）。

## 记录

- 频道只记“说出来的话”：人说的、agent 说的、提问、报错、Iridium 自己的一行。每条一个编号，从 1 起，不重用；Satori 的 `message.id` 就是这个编号（`#12`）。
- agent 的思考和工具调用不进频道，留在它自己的记录里：`POST /v1/internal/block.list`、`block.get`（`docs/satori.md`“记录”）。
- 人的话在发送时写进频道（引用是输入的 ID）。agent 的话从它的记录读进来（`Sync`，读到哪一行记在 `channel_sync`）；记录还没写到时先按听到的写，记录跟上后认作同一条。
- 以前的会话：频道第一次被读或写时，把整份记录读进来。读进来的不发事件。
- 终端里直接对 agent 打的话，读记录时补进频道，作者是 `terminal`。

## 成员

- 三种：一个应用的全部登录（`ir_web/*`）、单个登录（`应用/登录`）、agent（`agent:<会话ID>`）。这一版能改的只有 agent。
- agent 的 `user.name` 是它现在用什么跑的（`Claude Opus 5.5 High`），`nick` 是频道里叫它的名字：字母、数字、`_`、`-`，至多 32 个，频道内唯一，加入时自动起（`claude`、`claude2`）。`@` 只认 `nick`。
- 每个 agent 一个开关 `recv`：`all` 收人说的每句话；`at` 只收点到它的。频道原来的 agent 是 `all`，后加的默认 `at`。
- 一个频道至多 8 个 agent。加进来的 agent 是一个新会话，开在频道的文件夹里，列表里不单独出现（`Session.channel`）；频道的 `Session.agents` 列出它的全部 agent。
- 接口见 `docs/api.md`“频道”。agent 自己也能加：`ir api POST internal/channels/self/members agent=codex`。

## 叫起谁（两个以上 agent 时）

- 人的消息：叫起它 `@nick` 点到的 agent，加上 `recv` 是 `all` 的。
- agent 的话：只叫起它 `@nick` 点到的。agent 不会因为别的 agent 说了话就被叫起。
- `@nick` 要独立成词，不在代码块、行内代码和引用行里。
- 从人最后一次说话算起，agent 之间至多连续转交 4 次；再转，频道里记一行“未转交”，不再叫起谁。
- Claude：人要有 Claude 的权限才能点它；没有权限的人说话，`recv` 是 `all` 的 Claude 不被叫起。agent 点 Claude 不受限。
- 发给成员会话的 ID：只给那个 agent（斜杠命令这样发）。
- 只有一个 agent 的频道和以前完全一样。

## 给 agent 的上下文

被叫起的 agent 收到一条消息：`#编号: 原话`，后面一个 `<channel-context>` 块。

- 它是谁、频道里有哪些 agent、怎么叫别的 agent。
- 它上次读过之后的消息：近的给原文（`#431 [谁 · 时间 · 做了什么]: 正文`），只在消息之间切；单条超过 2000 字截断，写明怎么取全文。更早的按回合一行（谁问、头几个字、谁答），至多 30 个回合；再早的只写数量。总量约 24KB（`strategy.Default`）。
- 每个 agent 在这段时间里做了什么的合计，和改过的文件。
- 怎么查更多：`ir api message.list channel_id=self`、`_data.q`、`message.get`。在别的机器上的会话没有这一行。
- 每个 agent 一个已读位置（`channel_members.seen`），给过就往前移。同一个 agent 一次只给一条。

## 分层和可追溯

| 层 | 在哪 | 管什么 |
| --- | --- | --- |
| 文字 | `internal/prompts/texts/*.md` | 给 agent 的每个固定的字，一段一个文件，文件名是 ID |
| 策略 | `internal/ctx/strategy`、`assemble/policy.go`、`internal/deliver` | 纯函数：给什么、给谁；不产生字 |
| 组装 | `internal/ctx/assemble` | 策略的结果加文字，成一份注入（`Injection`），每段记着出处 |
| 投递 | `internal/agent/*`、`session` | 只收 `Injection`，不改内容 |

每次给 agent 的东西留一份注入单（`injections` 表，每个会话留最近 200 份）：用了哪些片段、片段的哈希、填进去的值、引用了哪些消息。不存正文。`GET /v1/internal/sessions/{id}/injections`。

## 活动

读 agent 的记录时数它的工具调用（`internal/activity`），挂在它下一句话上：bash 几次、失败几次、各是什么程序开头的；读了几次；网页搜索和抓取；子 agent；用编辑工具改的文件和增删行数。不记命令原文、搜索词和结果。shell 命令改的文件数不到。消息内容后面跟 `<iridium:activity>`，文件路径只给网页和主机。

## 搜索

`message.list` 的 `_data.q`：有这些词的消息，最近的若干条。索引是 SQLite 的 FTS5；中文按单字和相邻两字切，不用词典。索引的是正文，加上 agent 改过的文件路径和跑过的程序名。

## 隔离

agent 的 `ir` 读不到同频道另一个 agent 的记录（403 `not_yours`），只能读频道。

## 还没做

- 人作为成员的增减和“相关 / 全部”开关。
- 回复（`<quote>`）当作点名；`@全部`。
- 建会话时一次配好多个 agent 的面板。
- 网页以外的应用看到的活动、公开链接里的多 agent 频道。

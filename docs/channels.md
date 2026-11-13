# 频道

频道是人和 agent 说话的地方，有自己的 ID 和记录，可以没有 agent。会话是一个托管 agent 的私有上下文，也就是 agent 用户 `agent:<会话ID>`，不属于任何频道。用户定的（2026-11-13，取代 11-12 的“频道就是最初那个会话”）。代码：`internal/channel`（记录、成员）、`internal/deliver`（叫起谁）、`internal/ctx/strategy`、`internal/ctx/assemble`、`internal/prompts`（给 agent 的上下文）、`internal/activity`（活动）、`internal/search`（搜索）、`internal/server/channels.go`（接口、路由）。

- 每个会话有一个自己的频道，ID 就是会话 ID：agent 在回合里说的话直接进这个频道（直出）。没人改过成员时，它的成员是所有登录加这个 agent，和以前的会话完全一样。
- 会话可以订阅别的频道（`channel_members` 一行：收、发、已读位置）。在那里它只看到说出来的话，要说话用 `ir api message.create channel_id=<频道>`；它这一回合的输出留在自己的频道里。一个会话只有自己的频道是直出的。
- 无 agent 的频道（`channels` 表一行）：`channel.create` 不带 `_data.agent`。列在它的文件夹里（`Session.bare`），里面的 agent 都是订阅来的。
- 每个会话在侧栏只有一行。

## 记录

- 频道只记“说出来的话”：人说的、agent 说的、提问、报错、Iridium 自己的一行。每条一个编号，从 1 起，不重用；Satori 的 `message.id` 就是这个编号（`#12`）。
- agent 的思考和工具调用不进频道，留在它自己的记录里：`POST /v1/internal/block.list`、`block.get`（`docs/satori.md`“记录”）。
- 人的话在发送时写进频道（引用是输入的 ID）。agent 的话从它的记录读进来（`Sync`，读到哪一行记在 `channel_sync`）；记录还没写到时先按听到的写，记录跟上后认作同一条。
- 以前的会话：频道第一次被读或写时，把整份记录读进来。读进来的不发事件。
- 终端里直接对 agent 打的话，读记录时补进频道，作者是 `terminal`。

## 成员

- agent 是 `agent:<会话ID>`。人有三种写法：`*`（所有应用的所有登录）、`应用/*`（一个应用的全部登录）、`应用/登录`。
- 人：没选过的频道是 `*`。选了人以后，没被选进来的仍然在侧栏看到、能读，但不能发消息、不能答提问和审批、不能停 agent、不能改成员（403）。主机始终在里面；频道里的 agent 也在。群里任何人都能改成员（`PUT …/people`），改的人自己留在里面。
- agent 的 `user.name` 是它现在用什么跑的（`Claude Opus 5.5 High`），`nick` 是叫它的名字：字母、数字、`_`、`-`，至多 32 个。称呼是会话的（`agent_nicks`），整个 Iridium 里唯一（不分大小写），在哪个频道都一样；第一次进有别的 agent 的频道时自动起（`claude`、`claude2`）。`@` 只认 `nick`；Satori 的 `<at id="agent:<会话>"/>` 等同 `@nick`。
- 每个 agent 一个 `recv`：`all` 收人说的每句话；`at` 只收点到它的。频道自己的 agent 是 `all`，订阅来的默认 `at`。`send`：`direct`（频道自己的 agent）或 `ir`。
- 一个频道至多 8 个 agent。
- 邀请：`POST …/members`，`session` 给已有的会话（要能用它），否则新开一个会话再订阅（`agent`、`model`…，`cwd`、`machine` 不给就是频道的文件夹）。新开的是普通会话：侧栏里在它的文件夹，不挂在谁下面，`Session.spawned {by, channel}` 记谁拉起的（会话）和在哪拉起的（频道）。别的机器上的会话也能邀请。
- 移出只是退订，会话照旧。频道自己的 agent 移不出。
- 建会话时可以一次配好：`channel.create` 的 `_data.members {agents, people, nick, recv}`；第一句话在成员都到齐后才说，点到谁就给谁。
- 会话列表里：`Session.agents` 是它的频道里的全部 agent（两个以上时），`Session.in` 是它订阅的频道。
- 接口见 `docs/api.md`“频道”。agent 自己也能加：`ir api POST internal/channels/self/members agent=codex`。

## 频道里的事

成员变了，频道里记一行 Iridium 自己的话（`kind` 是 `note`），文字给只认字的应用看，消息的 `_data.event` 给页面按自己的语言说：`join`（agent 加入：`member`、`nick`、`name`）、`leave`、`rename`（`from` 旧名、`nick` 新名）、`recv`、`people`（`added`、`removed`、`everyone`）、`undelivered`（`seq` 没送到 `nick`）、`stopped`（`seq` 没转交）、`silent`（`nick` 被 `seq` 叫起，回合结束时没在频道发话）；`by` 是谁做的。建会话时一并配好的成员不记。这些行不进给 agent 的上下文。

## 叫起谁（两个以上 agent，或无 agent 的频道）

- 人的消息：点了名（`@nick`）就只叫起点到的 agent；没点名，叫起 `recv` 是 `all` 的。没被叫起的，下次被叫到时在上下文里读到。
- agent 的话：只叫起它 `@nick` 点到的。频道自己的 agent 说的话直接算；订阅来的 agent 用 `ir` 发的才算。agent 不会因为别的 agent 说了话就被叫起。
- `@nick` 要独立成词，不在代码块、行内代码和引用行里。
- 从人最后一次说话算起，agent 之间至多连续转交 4 次；再转，频道里记一行“未转交”（直出的）或 `ir` 被拒（400），不再叫起谁。
- Claude：人要有 Claude 的权限才能点它；没有权限的人说话，`recv` 是 `all` 的 Claude 不被叫起。agent 点 Claude 不受限。
- 订阅来的 agent 被叫起后，回合结束时没在频道发话：频道里记一行（`silent`）。它所在的机器没有 `ir` 时（别的机器、执行器不带 `ir`），它的最后一句回复由 Iridium 替它说进频道。
- 只有自己一个 agent 的会话和以前完全一样。

## 给 agent 的上下文

被叫起的 agent 收到一条消息：`#编号: 原话`，后面一个 `<channel-context>` 块。

- 它是谁、频道里有哪些 agent、怎么叫别的 agent。订阅来的 agent 另外被告知这是哪个频道（名字和 ID）、要用 `ir api message.create channel_id=<ID>` 才能在那里说话。
- 它上次读过之后的消息：近的给原文（`#431 [谁 · 时间 · 做了什么]: 正文`），只在消息之间切；单条超过 2000 字截断，写明怎么取全文。更早的按回合一行（谁问、头几个字、谁答），至多 30 个回合；再早的只写数量。总量约 24KB（`strategy.Default`）。
- 每个 agent 在这段时间里做了什么的合计，和改过的文件。
- 怎么查更多：`ir api message.list channel_id=<频道>`（自己的频道是 `self`）、`_data.q`、`message.get`。没有 `ir` 的没有这一行。
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

读 agent 的记录时数它的工具调用（`internal/activity`），挂在它下一句话上：bash 几次、失败几次、各是什么程序开头的；读了几次；网页搜索和抓取；子 agent；用编辑工具改的文件和增删行数。不记命令原文、搜索词和结果。shell 命令改的文件数不到。别的机器上的 agent 改的文件写成 `机器名:路径`。消息内容后面跟 `<iridium:activity>`，文件路径只给网页和主机。

## 搜索

`message.list` 的 `_data.q`：有这些词的消息，最近的若干条。索引是 SQLite 的 FTS5；中文按单字和相邻两字切，不用词典。索引的是正文，加上 agent 改过的文件路径和跑过的程序名。

## 读别的 agent 的记录

agent 的 `ir` 能读它看得见的任何会话的记录（`block.list`、`block.get`）：只读，密钥照常打码。

## 还没做

- 收：每次送达补未读的增量已有；“订阅某个用户接下来的 N 条”“收全部”两个接口没做。发送检查（落后太多或有点到它的未读才拒发）没做。
- 拉起者和它拉起的 agent 之间的往来不计入转交上限；被拉起的没发话时另通知拉起者。
- 已读：人的已读位置、每条消息谁读了。读记录的“提要”一层。消息带指向（哪个会话、哪一段）。
- Satori 的 `guild.member.*` 和 `joined_at`。
- 人的“相关 / 全部”开关；回复（`<quote>`）当作点名；`@全部`。
- 无 agent 的频道里传附件。
- 网页：新的创建页、频道页顶部、消息里的头像菜单、“在某频道中工作”的折叠段、已读头像、换头像。现在的页面还是 11-12 的样子。

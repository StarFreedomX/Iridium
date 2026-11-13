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
- 人：2026-11-13 起新建的频道默认是面板的登录和主机的（`ir_web/*`、`local/*`），不带 Bot；建它的应用自己也在。新建页里可改（`channel.create` 的 `_data.members.people`）。之前的、没选过的频道是 `*`。选了人以后，没被选进来的仍然在侧栏看到、能读，但不能发消息、不能答提问和审批、不能停 agent、不能改成员（403）。主机始终在里面；频道里的 agent 也在。群里任何人都能改成员（`PUT …/people`），改的人自己留在里面。
- agent 的 `user.name` 是它现在用什么跑的（`Claude Opus 5.5 High`），`nick` 是叫它的名字：字母、数字、`_`、`-`，至多 32 个。称呼是会话的（`agent_nicks`），整个 Iridium 里唯一（不分大小写），在哪个频道都一样；第一次进有别的 agent 的频道时自动起（`claude`、`claude2`）。`@` 只认 `nick`；Satori 的 `<at id="agent:<会话>"/>` 等同 `@nick`。
- 每个 agent 一个 `recv`：`all` 收人说的每句话；`at` 只收点到它的。频道自己的 agent 是 `all`，订阅来的默认 `at`。`send`：`direct`（频道自己的 agent）或 `ir`。
- 一个频道至多 8 个 agent。
- 邀请：`POST …/members`，`session` 给已有的会话（要能用它），否则新开一个会话再订阅（`agent`、`model`…，`cwd`、`machine` 不给就是频道的文件夹）。新开的是普通会话：侧栏里在它的文件夹，不挂在谁下面，`Session.spawned {by, channel}` 记谁拉起的（会话）和在哪拉起的（频道）。别的机器上的会话也能邀请。
- 移出只是退订，会话照旧。频道自己的 agent 移不出。
- 建会话时可以一次配好：`channel.create` 的 `_data.members {agents, people, nick, recv}`；第一句话在成员都到齐后才说，点到谁就给谁。
- 会话列表里：`Session.agents` 是它的频道里的全部 agent（两个以上时；无 agent 的频道一个也列），`Session.in` 是它订阅的频道。
- 接口见 `docs/api.md`“频道”。agent 自己也能加：`ir api POST internal/channels/self/members agent=codex`。

## 频道里的事

成员变了，频道里记一行 Iridium 自己的话（`kind` 是 `note`），文字给只认字的应用看，消息的 `_data.event` 给页面按自己的语言说：`join`（agent 加入：`member`、`nick`、`name`）、`leave`、`rename`（`from` 旧名、`nick` 新名）、`recv`、`people`（`added`、`removed`、`everyone`）、`undelivered`（`seq` 没送到 `nick`）、`stopped`（`seq` 没转交）、`silent`（`nick` 被 `seq` 叫起，回合结束时没在频道发话）；`by` 是谁做的。建会话时一并配好的成员不记。这些行不进给 agent 的上下文。

## 叫起谁（两个以上 agent，或无 agent 的频道）

- 人的消息：点了名（`@nick`）就只叫起点到的 agent；没点名，叫起 `recv` 是 `all` 的。
- `@全体成员`、`@全体Agent`：叫起频道里所有 agent（发话的除外），和每个都点了名一样；Satori 里是 `<at type="all"/>`、`<at role="agent"/>`。这两个名字不能当称呼。
- 引用（Satori 的 `<quote id="编号"/>`）：被引用的是某个 agent 的话，就当点了它的名；给它的消息里在原话前写上引用的那条（编号、谁、头 200 字）。频道记下引用的编号（`_data.quote`，内容开头的 `<quote id/>`）。单 agent 的会话里，引用的话写成 `>` 引用行放在前面。没被叫起的，下次被叫到时在上下文里读到。
- agent 的话：只叫起它 `@nick` 点到的。频道自己的 agent 说的话直接算；订阅来的 agent 用 `ir` 发的才算。agent 不会因为别的 agent 说了话就被叫起。
- `@nick` 要独立成词，不在代码块、行内代码和引用行里。
- 从人最后一次说话算起，agent 之间至多连续转交 4 次；再转，频道里记一行“未转交”（直出的）或 `ir` 被拒（400），不再叫起谁。拉起者和它拉起的 agent（`Session.spawned.by`）之间的往来不计数，到了上限也照送。
- Claude：人要有 Claude 的权限才能点它；没有权限的人说话，`recv` 是 `all` 的 Claude 不被叫起。agent 点 Claude 不受限。
- 订阅来的 agent 被叫起后，可以直接回复：回合结束时它没用 `ir` 在频道发过话，最后一句回复由 Iridium 替它说进频道（2026-11-13）。用 `ir` 说过了就不再转。回合结束时什么也没说：频道里记一行（`silent`）；它是另一个 agent 为这个频道拉起的，拉起者另收到一条通知。
- 只有自己一个 agent 的会话和以前完全一样。

## 收和发

- 默认只收点到它的（`recv` 是 `at`）。agent 自己能改：`ir api PATCH internal/channels/<频道>/members/agent:<自己> recv=all` 收人说的每句话（只能改自己的 `recv`）。
- 跟随：`ir api POST internal/channels/<频道>/follow user=<称呼|用户ID|*> count:=N seconds:=T`，接下来 `user` 说的 N 条（默认 1，至多 50）在 T 秒内（默认 600，至多 3600）不点名也给它。只记在内存里，重启就没了。
- 发话：`ir api message.create channel_id=<频道> _data.text=@- <<'IR'`，正文在后面几行，`IR` 单独一行收尾（引号里的 here-document，shell 不解释正文）；短的可以直接 `content="…"`。在自己所在的频道里这样发话，手动审批下也不弹审批（`session.speaksOnly`：只认这两种写法，带别的参数、接别的命令照常问）。
- 发送检查：agent 用 `ir` 发话时，它没读过的消息随回答一起给它（`_data.unseen`，`ir` 直接印出来），已读位置前移。没读过的超过 12 条，或其中有点到它的：不发，回 409 `behind`，正文是这些消息；读完再发。

## 给 agent 的上下文

被叫起的 agent 收到一条消息：`#编号: 原话`，后面一个 `<channel-context>` 块。

- 它是谁、频道里有哪些 agent、怎么叫别的 agent。订阅来的 agent 另外被告知这是哪个频道（名字和 ID）、要用 `ir api message.create channel_id=<ID>` 才能在那里说话。
- 它上次读过之后的消息：近的给原文（`#431 [谁 · 时间 · 做了什么]: 正文`），只在消息之间切；单条超过 2000 字截断，写明怎么取全文。更早的按回合一行（谁问、头几个字、谁答），至多 30 个回合；再早的只写数量。总量约 24KB（`strategy.Default`）。
- 每个 agent 在这段时间里做了什么的合计，和改过的文件。
- 怎么查更多：`ir api message.list channel_id=<频道>`（自己的频道是 `self`）、`_data.q`、`message.get`。没有 `ir` 的没有这一行。
- 每个 agent 一个已读位置（`channel_members.seen`），给过就往前移。同一个 agent 一次只给一条。
- 增量（2026-11-13）：频道的固定说明（它是谁、频道、有哪些 agent、怎么回答，加上怎么查更多）只在这些时候给：第一次被这个频道叫起；说明变了（agent 换了、频道改名、提示改了，按说明全文的哈希比）；上次给过之后它压缩过上下文（读它的记录，看有没有压缩那一行）。别的时候只给一行“仍在「频道」里”（订阅来的）或什么都不给（频道自己的 agent）。注入单记着 `static`（说明的哈希）、`full`（这次给没给）、`line`（当时它的记录到哪）。清空会话是换了新会话，自然从头给。

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

## 已读

- 每个成员在每个频道有一个已读位置（读到第几条）。人：页面看到哪条就 `POST …/read {seq}`，按登录记（`channel_reads`），只进不退。agent：给过它的最后一条（`channel_members.seen`）。频道自己的 agent 收全部时算全读；只收 @ 时，是给过它的和它自己说的最后一条里靠后的那条。
- `GET …/reads` 和携带状态 `reads:<频道>`：`ChannelReads {end, readers[]}`。某条消息谁读了：`seq` 不小于它的那些。

## 元素

消息里 Markdown 和 Satori 的元素可以混着写（2026-11-13）：Markdown 没有的用 Satori 的（`<at>`），两边都有的随便用哪个（图片 `![](…)` 或 `<img src/>`）。Iridium 叫起谁时把 `<at>` 读成 `@称呼`（`satori.AtWords`），网页显示时把 Satori 元素换成 Markdown 再画（`web/src/chat/refs.ts` `fromSatori`）；代码里的照原样。

## 记录里的转发

agent 自己的记录里，频道转给它的那条，`block.list` 给成 Satori 的合并转发：`<iridium:relay channel name seq full>说明</iridium:relay><message forward>…</message>`，转发里每条是一个带 `<author>` 的 `<message id="编号">`，是这次给它的那些消息（按注入单），叫它的那条在最后；说明只在这次给了时才有（`full`）。只认 Satori 的客户端看到的就是一条合并转发。注入单已经不在的（每个会话留最近 200 份）照原文给。

## 读别的 agent 的记录

agent 的 `ir` 能读它看得见的任何会话的记录：只读，密钥照常打码。三层：

- 活动：频道消息后面的 `<iridium:activity>`（做了什么的计数、改的文件）。
- 提要：`POST /v1/internal/block.outline {channel_id, from?, to?, limit?}`，一回合一行：谁问的、头几个字，这回合做了什么（同活动），最后一句的头几个字，以及这回合在记录里从哪块到哪块。
- 全文：`block.list`、`block.get`。

## 指向

频道里 agent 的消息带出处（`message.list` 的 `_data`），网页展开和 agent 读取用同一份：`session` 是哪个会话；直出的话带 `block`（记录里的那一块）；用 `ir` 发的带 `from`、`to`（它被叫起之后到发话时，自己记录里的行号范围）。拿去 `block.outline`、`block.list` 读那一段。

## 头像

- 频道有头像；会话的头像就是它自己那个频道的（`avatars` 表，`c:<ID>`）。`PUT /v1/internal/channels/{id}/avatar`（图片本身，或 JSON `{avatar: base64}`；存成 128px）、`DELETE`、`GET`。只给频道里的人，agent 的 `ir` 不能改。
- 给会话换头像时同时记为它那个模型的头像（`m:<agent>:<model>`）：同模型、自己没头像的会话都用它，以后新开的也是。
- Satori 里 agent 用户的 `avatar` 就是这个地址；携带状态 `avatars` 是一个只增的数，头像变了就加一。

## 正在看的人

页面订阅携带状态 `viewers:<频道>` 就算在看这个频道，状态的值是现在在看的登录（`Viewer {member, name, pages, since}`）。

## 网页

- 新会话页：选一个 agent 就开，最后一个是“不带 agent”；上面一行“成员”，默认面板用户和主机，点开按应用、登录增减。
- 输入框里 `@` 只叫频道成员（agent 的称呼、`全体成员`、`全体Agent`）；提及会话和文件夹用 `&`。
- 消息右键（长按）：引用、复制；引用的那条显示在输入框上方，发出的消息上面一行灰字写它引用的哪条。
- 输入框底部：“添加”（agent 的种类 → 它的模型和思考强度，选定就加入）和“已邀请”栏。
- 标题下不排头像。标题前是频道头像（没有就是 agent 图标），电脑上点它换头像；手机上它打开会话列表，换头像在“⋯”。顶栏右侧：正在看的人（头像，点开看名字）、成员（人数，点开：各自收什么、直出还是 `ir`、查看会话、移出）。“⋯”：邀请（agent；人：应用一层、登录一层），以及原来的会话操作。
- 用量在输入框底部那一排（多个 agent 的频道里每种 agent 一个）。
- 频道页里只有自己的话在右侧；别的登录、应用、agent 都在左侧，各自的头像。点 agent 的头像弹出它的资料卡（像 QQ）：头像、称呼、模型、状态、上下文；“发消息”去它自己的频道（会话，和它绑定的那个频道），“提及”在这里 @ 它；频道自己的 agent 是“换头像”和“查看会话”。agent 头像的右键（长按）菜单：提及、压缩、模型、强度、模式、停止、接收、改名、用量、换头像、查看会话、给了它什么、移出。
- 已读：每个成员的小头像停在它读到的那条下面。
- agent 的每条消息上面是它这一段的思考和工具调用，从它自己的记录里取（按“指向”），和单 agent 会话一样折叠；取不到时是一行计数。
- 单 agent 的会话里 agent 也有头像：两条消息之间它做的和说的是一段，头像在左，上面是称呼和模型；右键菜单同频道页。
- agent 自己的记录里，别的频道叫它的那条不折叠：左侧是 Iridium 发来的一条（“转自「频道」· #编号”，点了去那个频道），内容是一张“聊天记录 · N 条”卡片：这次补给它的消息一条一行（谁、说了什么，前面的灰、最多三行），叫它的那条在最后；这次给了说明的，卡片右上角有“频道说明”，点开看全文。接着是它这一回合，和平常一样。没有注入单的旧记录照原文显示（原话加“上下文补充”）。
- 侧栏：为频道拉起的会话是文件夹里的普通一行，不带拉起者的标记。

## 还没做

- 人的“相关 / 全部”开关。
- 人的资料卡和人与人私聊。
- 无 agent 的频道里传附件。
- 网页：侧栏不显示头像图片；无 agent 的频道页没有专门的空状态。

# 飞书(Lark) 机器人通道完整接入指南：收消息 · 发文件 · 事件订阅 · 群 webhook · 手机当总控台

> 记的是实际跑通过的路，不是抄文档。照着一节一节做就能通。
> 最后更新：2026-11-06

---

## 一句话：这套东西到底能干什么

配好之后，一个机器人账号能干这些事：

- **有人说话它马上知道** —— 群里或私聊来了新消息，飞书主动推给它，不用一遍遍去问「有没有新消息」。这是它跟「定时去查一遍」最大的区别：不用轮询，来了就有，没来就没有。
- **分得清是谁说的、在哪说的** —— 每条推送里都带着发送人、所在群、会话 ID、消息 ID 和原文，能据此决定理不理、怎么回。
- **能自己动** —— 收到就能自动回一句、自动转给别人、自动存进库、自动触发别的活。
- **能回头翻** —— 过去几百条消息可以拉出来查（`GET /im/v1/messages`），不只是看新的。
- **能发也能收文件和图片** —— 别人丢进来的 PDF、截图能下来读；它也能把文件发回去。
- **手机发一句话，电脑和手机的 AI 一起动** —— 飞书当总控台。人在外面掏手机说一句，家里电脑上的程序收到就开始干，手机上的程序也同时知道，干完把结果发回群里。不用远程桌面、不用 SSH、不用公网 IP。（怎么搭见第 12 节）
- **两条腿互补** —— webhook 那条只管往外喊，**收消息只能靠应用 API**；应用 API 坏了或额度没了，webhook 还能把话送出去。
- **不挑网络** —— 用长连接模式就不需要公网 IP、不需要域名、不需要内网穿透，能正常上网就行。

一句话：**别人在群里说一句，它能立刻收到、判断、自己回。** 具体怎么搭，往下看。

---

## 0. 先搞清两条腿

| 通道 | 能干什么 | 吃什么额度 | 什么时候用 |
|---|---|---|---|
| **企业自建应用 API** | 发文本 / 图片 / 文件，能发群也能发私聊 | 吃应用月度额度 | 主力，发文件图片只能靠它 |
| **群自定义机器人 webhook** | 只能往**这一个群**发**纯文本** | 不吃应用额度，单独算频率 | 应用额度烧光时的保命腿 |

**结论：两条都配上。** 先试 webhook，发不出去再退到应用 API。

---

## 1. 建应用（飞书开放平台）

1. 打开 <https://open.feishu.cn>，进「开发者后台」→「创建企业自建应用」
2. 进应用 →「凭证与基础信息」，抄下 **App ID** 和 **App Secret**（Secret 只显示一次，丢了只能重置）
3. 「权限管理」里开这几个：
   - `im:message`（读消息）
   - `im:message:send_as_bot`（以机器人身份发消息）
   - `im:resource`（上传/下载图片和文件）
   - 要私聊还要 `im:chat` 权限
4. 「版本管理与发布」→ 创建版本 → 提交 → **要管理员审批通过才生效**（企业里没审批的会一直 401/无权限）
5. 把机器人拉进群：**群设置 → 群机器人 → 添加机器人 → 选你自己那个应用**

> 坑：应用建好了但没拉进群，`chat_id` 拿到了也是 `230002 Bot is not in the chat`。

---

## 2. 拿 chat_id 和 open_id

**chat_id（群）**：群里发一条消息，然后用应用去查消息列表，`container_id` 就是 chat_id：

```
GET /open-apis/im/v1/messages?container_id_type=chat&container_id=<chat_id>&sort_type=ByCreateTimeDesc&page_size=20
```

第一次不知道 chat_id 怎么办——两种办法：
- 在群里 @ 机器人，用「事件订阅」接 `im.message.receive_v1` 事件，事件体里带 `chat_id`；
- 或者拿群列表：`GET /open-apis/im/v1/chats?page_size=20`（需要 `im:chat` 权限）。

**open_id（私聊某人）**：`GET /open-apis/im/v1/chats/{chat_id}/members` 里能拿到群成员的 `member_id`。
或者用户先给机器人发一条消息，事件里带 `sender.sender_id.open_id`。

> 坑：open_id 在**换个应用/换个企业**之后会变。变了之后发私聊会报
> `230013 Bot has NO availability to this user`。重新取一次，别怀疑代码。

---

## 3. 拿 tenant_access_token

```
POST https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal
Content-Type: application/json

{"app_id":"<APP_ID>","app_secret":"<APP_SECRET>"}
```

返回 `{"code":0,"tenant_access_token":"t-xxxx","expire":7200}`。

**有效期 2 小时。** 一定要缓存，别每条消息都现取一次——实测中因为每条消息都现取 token，
把应用月度额度整个吃光了，之后一整天一个字都发不出去（报 `99991403`）。
进程活着就内存里存到快过期再刷。

---

## 4. 发文本（最常用的一个）

```
POST https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id
Authorization: Bearer <token>
Content-Type: application/json

{
  "receive_id": "<CHAT_ID>",
  "msg_type": "text",
  "content": "{\"text\":\"要发的话\"}"
}
```

⚠️ **`content` 是一个「JSON 字符串」，不是对象。** 要 `JSON.stringify` 一层再塞进去。
直接传对象会报 `230001 Invalid request parameter`。这个坑最容易踩。

`receive_id_type` 可以是 `chat_id`（发群）或 `open_id`（发私聊）。

### 不要发 interactive 卡片
默认桥接工具爱发 `msg_type: "interactive"` 卡片，部分客户端渲染不出来，显示「请升级」空壳。
**发纯文本最稳。** 也不要带 markdown 标记（`**`、`#`、`-` 这些），飞书文本消息不会解析，原样吐出来很丑。

---

## 5. 发文件

两步：先上传拿 `file_key`，再用 `file_key` 发消息。

**① 上传**
```
POST https://open.feishu.cn/open-apis/im/v1/files
Authorization: Bearer <token>
Content-Type: multipart/form-data; boundary=----xxx

form 字段：
  file_type = "stream"          # 也可以是 pdf / doc / xls / ppt / mp4 ...
  file_name = "报告.pdf"
  file      = <二进制>
```
返回 `{"code":0,"data":{"file_key":"file_v2_xxxx"}}`

**② 发**
```
POST /open-apis/im/v1/messages?receive_id_type=chat_id
{"receive_id":"<CHAT_ID>","msg_type":"file","content":"{\"file_key\":\"file_v2_xxxx\"}"}
```

> 坑：multipart 的 boundary 要自己拼，字段顺序无所谓，但 `\r\n` 必须是 CRLF，用 `\n` 会 400。

---

## 6. 发图片

同文件，两步，接口换成 images：

**① 上传**
```
POST https://open.feishu.cn/open-apis/im/v1/images
form 字段：image_type = "message"，image = <二进制>
```
返回 `data.image_key`（`img_v2_xxxx`）

**② 发**
```
{"receive_id":"<CHAT_ID>","msg_type":"image","content":"{\"image_key\":\"img_v2_xxxx\"}"}
```

---

## 7. 群自定义机器人（第二条腿，必配）

1. 群里：**群设置 → 群机器人 → 添加机器人 → 自定义机器人** → 起个名 → 拿到 Webhook 地址
   `https://open.feishu.cn/open-apis/bot/v2/hook/<一串 UUID>`
2. 用法：

```
POST https://open.feishu.cn/open-apis/bot/v2/hook/<UUID>
Content-Type: application/json

{"msg_type":"text","content":{"text":"要发的话"}}
```

**注意这里 `content` 是真对象，不用再 stringify 一层**——跟应用 API 正好相反，别搞混。

- 优点：不吃应用额度；不用 token；秒发
- 缺点：只能发**这一个群**、只能**文本**，发不了文件图片，**发不了私聊**
- 频率限制：自定义机器人每分钟 100 条，超了报 `9499`

**`<UUID>` 就是凭证，别提交到公开仓库。**

---

## 8. 最小可跑实现（Node.js，零依赖）

```js
const https = require("https");
const APP_ID = process.env.FEISHU_APP_ID;       // 从环境变量读，别写死在代码里
const APP_SECRET = process.env.FEISHU_APP_SECRET;
const CHAT_ID = process.env.FEISHU_CHAT_ID;
const WEBHOOK = process.env.FEISHU_WEBHOOK;     // 可选

function req(opts, body) {
  return new Promise((res, rej) => {
    const r = https.request(opts, (s) => {
      let d = ""; s.on("data", c => d += c); s.on("end", () => res(d));
    });
    r.on("error", rej); if (body) r.write(body); r.end();
  });
}

async function say(text) {
  // 先走 webhook：不吃额度
  if (WEBHOOK) {
    const b = JSON.stringify({ msg_type: "text", content: { text } });
    const out = JSON.parse(await req({
      hostname: "open.feishu.cn", path: new URL(WEBHOOK).pathname, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(b) }
    }, b));
    if (out.code === 0) return "webhook";
  }
  // 退到应用 API
  const tb = JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET });
  const tk = JSON.parse(await req({
    hostname: "open.feishu.cn", path: "/open-apis/auth/v3/tenant_access_token/internal",
    method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(tb) }
  }, tb)).tenant_access_token;

  const mb = JSON.stringify({ receive_id: CHAT_ID, msg_type: "text", content: JSON.stringify({ text }) });
  const out = JSON.parse(await req({
    hostname: "open.feishu.cn", path: "/open-apis/im/v1/messages?receive_id_type=chat_id",
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tk,
                               "Content-Length": Buffer.byteLength(mb) }
  }, mb));
  if (out.code !== 0) throw new Error(JSON.stringify(out));
  return "api";
}

say("测试一下").then(console.log).catch(console.error);
```

---

## 9. 报错对照表

| code | 意思 | 怎么办 |
|---|---|---|
| `99991403` | 应用 API 额度用光了 | 当天只能靠 webhook；第二天自动恢复。别再轮询。 |
| `99991663` | token 失效 | 重新取 token |
| `230001` | 参数错，九成是 `content` 没 stringify | 检查 `content` 是不是字符串 |
| `230002` | 机器人不在这个群里 | 把应用拉进群 |
| `230013` | 这个 open_id 用不了（换过应用/企业） | 重新取 open_id |
| `9499` | webhook 发太快 | 降频 |
| `19001`/`19002` | App ID / Secret 错 | 去凭证页重抄 |

---

## 10. 安全提醒

- **App Secret、webhook UUID、chat_id、open_id 都不要提交到公开仓库。** 全部走环境变量。
- Secret 一旦进过 git 历史，就算删了文件也算泄露，得去后台**重置 Secret**。
- 这份文档只有通用字段和占位符，不含任何具体应用的凭证。

---

## 11. 让它自己收消息、自己回（事件订阅）

前面十节讲的是「它怎么往外发」。这一节讲**它怎么知道别人说了话**——这才是「自动识别有没有信息」那一步。

### 11.1 两种接法，别选错

| 接法 | 要不要公网 | 适合谁 |
|---|---|---|
| 回调 URL（webhook） | 要，还得有域名、走 HTTPS | 有正式服务器的 |
| **长连接（WebSocket）** | **不要** | 本地、内网、手机、家宽，首选 |

长连接的意思是：**你的程序主动往外连飞书，飞书顺着这根线把事件推回来**。
所以不用公网 IP、不用域名、不用 ngrok/frp 这类内网穿透，SDK 里自带加密和验签，不用自己写校验。
**只支持企业自建应用，商店应用不行。**

### 11.2 Node.js 最小实现

```bash
npm i @larksuiteoapi/node-sdk     # 版本要 ≥ 1.24.0，低了没有 WSClient
```

```js
const Lark = require("@larksuiteoapi/node-sdk");
const cfg = { appId: process.env.FEISHU_APP_ID, appSecret: process.env.FEISHU_APP_SECRET };
const client = new Lark.Client(cfg);
const ws = new Lark.WSClient(cfg);

const seen = new Set();                 // 去重：飞书会重推同一条

ws.start({
  eventDispatcher: new Lark.EventDispatcher({}).register({
    "im.message.receive_v1": async (data) => {
      const msg = data.message;
      if (seen.has(msg.message_id)) return;     // 重推的直接丢
      seen.add(msg.message_id);
      if (seen.size > 500) seen.delete(seen.values().next().value);

      let text = "";
      try { text = JSON.parse(msg.content || "{}").text || ""; } catch (e) { return; }
      if (!text.trim()) return;                 // 空的（图片、表情）先不理

      await client.im.v1.message.create({
        params: { receive_id_type: "chat_id" },
        data: {
          receive_id: msg.chat_id,
          msg_type: "text",
          content: JSON.stringify({ text: "收到：" + text }),   // 注意还是要 stringify
        },
      });
    },
  }),
});
```

### 11.3 后台怎么配（顺序反了会卡住）

1. **先把上面的程序跑起来**，保持连接在线
2. 开放平台 →「事件与回调」→「事件配置」→ 订阅方式选 **「使用长连接接收事件」** → 保存
   ⚠️ **客户端不在线，这一步保存不了。** 先跑程序，再进后台点。
3. 在这个页面**添加事件** `im.message.receive_v1`（接收消息）
4. 权限里补上接收消息相关的权限，**改完必须重新发布一个版本**才生效
5. 群里 @ 一下机器人试试，程序那边应该立刻打印

### 11.4 坑（每一条都真会咬人）

- **3 秒**：事件处理超过 3 秒没返回，飞书算失败并**重推**。所以先返回，重活丢后台异步做。
- **会重复**：重推意味着同一条可能来两次。**按 `message_id` 去重**，不然自动回两遍。
- **不是广播**：起了好几个进程同时连，消息只随机给其中一个，别的收不到。想让多台机器都收到，看第 12 节。
- **连接数上限 50**：每个 `new WSClient()` 算一个，反复重连不释放会把名额耗光。
- **群里默认只推 @ 机器人的消息**。要收全部群消息，得另外申请敏感权限。
- **自己发的消息可能也会推回来**，别自己回自己，会无限套娃。
- 权限改了不重新发布版本 = 白改，会一直收不到。

### 11.5 「怎么知道有没有新消息」

不用轮询。**推来就是有，不推就是没有。** 定时去 `GET /im/v1/messages` 一遍遍翻，既慢又吃应用额度
（`99991403` 就是这么烧出来的），只在「要翻历史」的时候才用那个接口。

---

## 12. 飞书当总控台：手机发一句话，电脑和手机的 AI 一起干活

### 12.1 要的效果

人在外面，掏出手机，打开飞书，打一句「把桌面那个表填了」，发出去。

- 家里电脑上常驻的那个程序收到 → 开始干 → 干完把结果发回群里
- 手机上那个程序也收到 → 该它的那部分它干

**你不用远程桌面，不用 SSH，不用公网 IP，不用内网穿透。** 飞书就是那根线，手机就是遥控器。
这是这套东西最值钱的地方：**手里一个飞书，两头都能使唤。**

### 12.2 每台机器上跑的其实是同一个循环

不管是电脑还是手机，程序长一个样：

1. 长连接连上应用（第 11 节）
2. 收到消息，**先判断这条是不是给我的**：@ 了谁、带了什么关键词、在哪个群
3. 认领了才干活，没认领就装没看见
4. 干完用第 4/5 节的接口把结果发回群里

### 12.3 关键坑：一条消息怎么让两头都收到

⚠️ 长连接是**集群模式，不是广播**。同一个应用在两个地方同时开长连接，一条消息只会随机给其中一个，另一个收不到。
想两头都干活，只有这几条路：

| 做法 | 怎么做 | 适合 |
|---|---|---|
| **各建一个应用** | 电脑一个、手机一个，各自 app_id/app_secret，各自订阅事件 | 最干净，推荐 |
| 一个收、一个转 | 只有一端连飞书，收到后按需转发给另一端 | 省额度、好排查 |
| 分群或分工 | 不同的群，或 @ 不同的机器人，各管各的 | 简单，但发的人得知道找谁 |

**最稳的是第一条**：两个应用互不干扰，各自去后台配长连接就行。
**同一个应用别在两个地方同时开长连接**，那是一半消息石沉大海的根源。

### 12.4 必须防的四件事

- **重复干**：转发的时候把原始 `message_id` 一起带上，收到方按它去重（见 11.4），不然一条命令干两遍。
- **抢着干**：两头都判「这条是我的」就会执行两次。提前约定分工，用 @ 或关键词划清楚。
- **谁能指挥**：进了那个群的人就能使唤这些机器。**群只拉自己人**，应用权限按最小给。
- **断了没人知道**：长连接断了 SDK 会自己重连，但一定要有日志和心跳。断了没日志 = 等于没搭。

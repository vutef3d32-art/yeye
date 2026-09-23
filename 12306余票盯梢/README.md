# 12306 余票盯梢 + Termux 双向通知

盯火车票余票的小工具：定时去看一眼、只把「变了」的告诉你；配一条能从系统通知栏直接回话的双向通道。

自己用着顺手，拿出来给同样被「抢票、等退票、等降价」和「消息发不出去/收不回来」折磨的人。

两个功能，一句话各讲清：

- **盯梢**：定时去看一眼 → 跟上次比 → 只把变了的那点告诉你。
- **双向通知**：走的不是聊天软件，是系统通知本身。弹一条，对方能在通知栏里直接打字回你。

## 里面有什么

| 文件 | 干什么 |
|---|---|
| `ticket-watch.py` | 12306 余票盯梢：定时查一趟车，只在冒出新车次/新票种时通知 |
| `ticket-watch-cron.sh` | 定时器外壳：每 5 分钟跑一次，过了目标日自己收工 |
| `notify.sh` | 弹一条带「回复我」按钮的 Termux 通知（Android Direct Reply） |
| `on-reply.sh` | 对方回话后：留痕 + 叫「接话」程序接一句 |
| `reply-agent.sh` | 接话样板：直连 OpenAI 兼容接口生成一句短的，再弹回去 |

## 盯梢怎么用

```bash
chmod +x ticket-watch.py ticket-watch-cron.sh
QUIET=1 ./ticket-watch.py 2026-10-01 BJP SHH 08:00 20:00   # 先手动跑一次看结果
crontab -e
*/5 * * * * /绝对路径/ticket-watch-cron.sh 2026-10-01 BJP SHH 08:00 20:00
```

站代码在 12306 的 `station_name.js` 里（`BJP`=北京，`SHH`=上海，`HZH`=杭州…）。
填城市代码会带上同城站：`SHH` 会一并查出上海南、上海虹桥。

环境变量：`SEAT_CLASSES`（默认 `二等,一等,无座`）、`NOTIFY_CMD`（默认 `notify.sh`）、
`TICKET_COOKIE`、`STATE_DIR`、`QUIET=1`（只建基线）、`SELFTEST=1`（自测，不联网）。

## 双向通知怎么用

前置条件（缺一个都不响，**而且不给报错**，所以第一次一定手工验一遍）：

1. Termux 里 `pkg install termux-api`
2. 手机上装 **Termux:API** 那个 App
3. 给它通知权限

```bash
chmod +x notify.sh on-reply.sh reply-agent.sh
./notify.sh "试试看" "提醒"          # 手机上应该弹出来，带一个「回复我」按钮
```

点了按钮打完字、按发送 → 文字会进 `on-reply.sh` → 留痕到 `~/.termux-reply/reply.log`，
再交给 `reply-agent.sh` 接一句（要接 API：设 `API_BASE` / `API_KEY` / `MODEL` / `PERSONA`）。
不想接话就 `REPLY_AGENT=""`，它只留痕。

`notify.sh` 的 `NOTIFY_ID` 一定要**给且固定**；`NOTIFY_ICON` 可换图标。

## 四个真栽过的坑（这才是这份代码的主要价值）

1. **通知不给 `--id` = 通知栏变山。** 不带 id 的 `termux-notification` 每次都被当成一条全新通知，
   喊十次堆十条 —— 真栽过，一晚上堆了 95 条。**固定 id，新的自动顶掉旧的。**
2. **`&` 丢后台 + proot `--kill-on-exit` = 接话程序压根没跑起来。**
   如果回调脚本跑在 proot/chroot 里、外层壳又是 `exec proot --kill-on-exit`，
   脚本自己就是那个 proot 的根进程：一 exit，proot 立刻杀光所有子进程。
   铁证是接话程序**连日志文件都没被建出来** —— 不是「跑了才失败」，是根本没启动。
   **改成同步等**，代价只是按钮多等一两秒。
3. **按钮回调的路径，必须是 Termux 层能执行的。** 按钮按下时是 Termux 去执行那串命令，
   所以别把 chroot/proot 里的路径（`/home/xxx/...`）写进去 —— 点了没反应，还不报错。
   要么用 Termux 自己的路径（`/data/data/com.termux/files/home/...`），
   要么在 Termux 侧放一个壳脚本，由它再去 `proot-distro login` 转进去。
4. **通知上那行「Termux:API」改不掉** —— 那是包名。要改得拆包重做，别在这上面耗。

## 注意

- **别把盯票频率调到一分钟一次。** 余票不是秒级变动的，给人家的服务器留点余地，五分钟够了。
- 盯票是**公开查询接口的读取**：不登录、不下单、不绕过风控。下单还得自己在 App 里点 ——
  脚本抢票在国内有封号风险，不值当。
- 接口变了脚本就会失效（`查询失败，跳过` 那种）。它是「省你盯手机的时间」，不是基础设施。
- 自测：`SELFTEST=1 ./ticket-watch.py`（验「什么算变化」那条判断，不联网）；
  `DRY_RUN=1 API_BASE=x ./reply-agent.sh "你好"`（只验请求体合法，不真发）。

## 许可

MIT。拿去改，不用问我。

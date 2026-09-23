#!/bin/bash
# 对方在通知栏里打完字、按了发送 —— 文字会作为第一个参数传进来。这里做两件事：
#   1. 落盘（留痕，出事能查）
#   2. 叫「接话」的程序接一句（默认同目录的 reply-agent.sh）
#
# 这条通道的意义：对方不一定在聊天软件里，但他手机上一定看得到通知。
#
# 环境变量:
#   ON_REPLY_DIR   留痕目录（默认 ~/.termux-reply）
#   REPLY_AGENT    接话程序（默认同目录 reply-agent.sh；指到空字符串就只留痕、不接话）
#   REPLY_TIMEOUT  超时秒数（默认 60）

R="${1:-}"
[ -z "${R// }" ] && exit 0            # 空内容直接走，别让留痕里全是空行

LOG_DIR="${ON_REPLY_DIR:-$HOME/.termux-reply}"
mkdir -p "$LOG_DIR" 2>/dev/null
printf '[%s] 收到：%s\n' "$(date '+%F %T')" "$R" >> "$LOG_DIR/reply.log"

AGENT="${REPLY_AGENT:-$(dirname "$0")/reply-agent.sh}"
[ -n "$AGENT" ] && [ -x "$AGENT" ] || exit 0

# ⚠️ 这里**必须同步等**，不要用 `&` 丢后台。
# 如果你的脚本跑在 proot/chroot 里、外层壳又是 `exec proot --kill-on-exit`，
# 那这个脚本自己就是那个 proot 的根进程：一 exit，proot 立刻杀掉所有子进程 ——
# 你用 & 丢出去的那句根本活不到把日志写完。
# 这是真栽过的：接话程序连日志文件都没被建出来（不是"跑了才失败"，是压根没跑起来）。
# 代价是按钮那边多等一两秒，无所谓。
timeout "${REPLY_TIMEOUT:-60}" "$AGENT" "$R" >> "$LOG_DIR/agent.log" 2>&1

exit 0

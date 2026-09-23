#!/bin/bash
# Termux 双向通知 —— 弹一条通知，对方能在通知栏里直接打字回你。
#
# 为什么值钱：走的不是聊天软件，是系统通知本身。微信哑了、飞书不弹的时候，
# 这是唯一一条「发得出、也回得来」的通道 —— 而且不用装任何桥。
#
# 用法: notify.sh "内容" ["标题"] ["回话交给谁"]
#
# 环境变量:
#   NOTIFY_ID    通知 id（默认 notify）。**必须给，而且固定**。
#                不带 id 的 termux-notification 每次都被当成一条全新通知：
#                喊十次堆十条，通知栏会变成山（真栽过，一晚上堆了 95 条）。
#   NOTIFY_ICON  图标（默认 favorite）
#
# 前置条件（缺一个都不响，且**不给报错**，所以第一次一定手工验一遍）:
#   1) Termux 里 pkg install termux-api
#   2) 手机上装 Termux:API 那个 App
#   3) 给它通知权限
#   4) 通知上的「Termux:API」四个字改不掉 —— 那是包名，要改得拆包重做
CONTENT="${1:?用法: notify.sh \"内容\" [标题] [回话交给谁]}"
TITLE="${2:-通知}"
ON_REPLY="${3:-$(dirname "$0")/on-reply.sh}"

if ! command -v termux-notification >/dev/null 2>&1; then
  echo "没找到 termux-notification：要么没装 termux-api，要么不在 Termux 层跑" >&2
  exit 1
fi

# $REPLY 用转义挡住，留给 Termux 在执行动作时替换成对方打的字。
# 退出码要查：termux-notification 失败时可能一声不吭，不查就成了
# 「以为发出去了、其实没发」—— 这类哑失败最难查。
if ! termux-notification --id "${NOTIFY_ID:-notify}" --icon "${NOTIFY_ICON:-favorite}" \
  --title "$TITLE" --content "$CONTENT" \
  --button1 "回复我" --button1-action "$ON_REPLY \"\$REPLY\""; then
  echo "termux-notification 报错了，这条通知没发出去" >&2
  exit 1
fi

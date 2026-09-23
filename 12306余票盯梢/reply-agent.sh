#!/bin/bash
# 「接一句」的样板 —— 把对方说的话丢给一个 OpenAI 兼容的接口，拿回一句短的，再弹回他手机上。
#
# 为什么要自己直连，不套重量级的 agent 壳：
#   壳一场对话要背上完整人设 + 全部记忆 + 一堆钩子 —— 实测 3 万 token 起、光启动 5 秒以上；
#   这里只带精简人设 + 最近几轮，约 500 token、1 秒多就出声。便宜十几倍，还快。
#
# 用法: reply-agent.sh "对方说的话"
# 环境变量:
#   API_BASE   接口地址，例 https://api.example.com/v1
#   API_KEY    密钥
#   MODEL      模型名
#   PERSONA    人设提示（一两句就够，别写成小作文）
#   TALK_LOG   对话留痕（默认 ~/.termux-reply/talk.log；最近 8 行会带进上下文）
#   DRY_RUN=1  只打印将要发出去的请求体，不真发（自测用）
HER="${1:-$*}"
API_BASE="${API_BASE:?先设 API_BASE}"
API_KEY="${API_KEY:-}"
MODEL="${MODEL:-gpt-4o-mini}"
TALK_LOG="${TALK_LOG:-$HOME/.termux-reply/talk.log}"
PERSONA="${PERSONA:-你说话很短、很口语，一到两句。接住对方刚说的那件事，别复述，别问好。}"

RECENT=$(tail -8 "$TALK_LOG" 2>/dev/null)
PROMPT="$PERSONA
${RECENT:+
最近几轮（别重复自己说过的）：
$RECENT
}
对方刚说：$HER

只输出你要说的那句话本身。"

BODY=$(python3 -c 'import json,sys
print(json.dumps({"model": sys.argv[1], "max_tokens": 200,
                  "messages": [{"role": "user", "content": sys.argv[2]}]},
                 ensure_ascii=False))' "$MODEL" "$PROMPT")

if [ -n "$DRY_RUN" ]; then
  echo "$BODY" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("请求体合法，模型:", d["model"], "| 提示词字数:", len(d["messages"][0]["content"]))'
  exit 0
fi

LINE=$(curl -s --max-time 25 "$API_BASE/chat/completions" \
  -H "Authorization: Bearer $API_KEY" -H 'content-type: application/json' -d "$BODY" \
  | python3 -c 'import json,sys
try:
    print(json.load(sys.stdin)["choices"][0]["message"]["content"].strip())
except Exception:
    pass')

# 接不上也得回一句，别让对方那边一片安静（安静比说错更伤人）
[ -z "${LINE// }" ] && LINE="这次没接上，你再说一句。"

mkdir -p "$(dirname "$TALK_LOG")" 2>/dev/null
printf '[%s] 对方：%s\n[%s] 我：%s\n' "$(date '+%T')" "$HER" "$(date '+%T')" "$LINE" >> "$TALK_LOG"

# 把回话再弹回去 —— 于是这条通道就能一直接下去，而不是说完一句就断
"$(dirname "$0")/notify.sh" "$LINE"

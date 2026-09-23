#!/bin/bash
# 定时器外壳 —— 到目标日期为止每 5 分钟跑一次盯梢，过了那天自己收工。
#
# 为什么要这层壳：定时任务里写死「跑到某天」，到日子它自己停，
# 不需要谁记得来撤掉它。（健忘的定时任务 = 半夜给你推过期消息。）
#
# 用法: ticket-watch-cron.sh <日期 YYYY-MM-DD> <出发站> <到达站> [最早发点] [最晚发点]
# 挂法（crontab -e）:
#   */5 * * * * /path/to/ticket-watch-cron.sh 2026-10-01 BJP SHH 08:00 20:00
D="${1:?用法: ticket-watch-cron.sh <日期> <出发站> <到达站> [最早] [最晚]}"
[ "$(date +%Y%m%d)" -le "${D//-/}" ] || exit 0
exec python3 "$(dirname "$0")/ticket-watch.py" "$@"

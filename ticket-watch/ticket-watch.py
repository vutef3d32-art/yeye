#!/usr/bin/env python3
"""12306 余票盯梢 —— 定时查一趟车，只在「冒出新的」时候喊你。

原理就三下：
  1. 查一次：一个请求，把某天从 A 到 B 的全部车次和余票拿回来
  2. 存一份：把这一轮的结果写进状态文件
  3. 比一次：新出现的车次、或同一趟多出了票种，才通知；其他一律不吵你
     （同一票种只剩数量在变，比如 17 张变 16 张，不算变化）

用法:
  ticket-watch.py <日期 YYYY-MM-DD> <出发站代码> <到达站代码> [最早发点] [最晚发点]
例:
  ticket-watch.py 2026-10-01 BJP SHH 08:00 20:00

站代码：12306 的 station_name.js 里是全部站名和电报码（BJP=北京，SHH=上海）。
出发站填城市代码会连带同城站——SHH 会把同城的上海南、上海虹桥一起带出来。

环境变量:
  SEAT_CLASSES   要盯的座别，逗号分隔（默认 二等,一等,无座）
  TICKET_COOKIE  cookie 文件路径（可选，12306 有时要；默认 ~/.ticket-cookie.txt）
  NOTIFY_CMD     有变化时执行的命令，消息作为第一个参数（默认 notify.sh）
  STATE_DIR      状态文件目录（默认 /tmp）
  QUIET=1        只建基线不通知（第一次挂上时用，免得拿本来就有票的喊一遍）
  SELFTEST=1     只跑自测，不联网

建议挂定时器每 5 分钟跑一次（见 ticket-watch-cron.sh）。
别改成一分钟一次：给人家服务器留点余地，余票本来也不是秒级变动的。
"""
import json
import os
import subprocess
import sys

# 12306 余票串里各座别的下标
IDX = {'商务': 32, '一等': 31, '二等': 30, '无座': 26,
       '软卧': 23, '硬卧': 28, '硬座': 29}

if len(sys.argv) < 4 and not os.environ.get('SELFTEST'):
    sys.exit(__doc__.strip())

DATE = sys.argv[1] if len(sys.argv) > 1 else ''
FROM = sys.argv[2] if len(sys.argv) > 2 else ''
TO = sys.argv[3] if len(sys.argv) > 3 else ''
LO = sys.argv[4] if len(sys.argv) > 4 else '00:00'
HI = sys.argv[5] if len(sys.argv) > 5 else '23:59'

WANT = tuple(x.strip() for x in
             os.environ.get('SEAT_CLASSES', '二等,一等,无座').split(',') if x.strip())
SEATS = tuple((l, IDX[l]) for l in WANT if l in IDX)

COOKIE = os.path.expanduser(os.environ.get('TICKET_COOKIE', '~/.ticket-cookie.txt'))
NOTIFY = os.environ.get('NOTIFY_CMD', 'notify.sh')
STATE = os.path.join(os.environ.get('STATE_DIR', '/tmp'),
                     'ticket-watch.%s.%s-%s.state' % (DATE, FROM, TO))
os.makedirs(os.path.dirname(STATE) or '/tmp', exist_ok=True)   # 目录不存在就自己建
UA = ['-H', 'User-Agent: Mozilla/5.0',
      '-H', 'Referer: https://kyfw.12306.cn/otn/leftTicket/init']


def classes(seat_str):
    """从 '二等2 一等有' 里取出票种集合 {'二等','一等'}"""
    return frozenset(c for c in WANT if c in seat_str)


def newly(now, old):
    """冒出来的＝新车次，或已有车次多出了票种（同票种只剩数量变化不算）"""
    return {k: v for k, v in now.items()
            if old.get(k) is None or classes(v) - classes(old.get(k, ''))}


def curl(url):
    cmd = ['curl', '-s', '-m', '25', url] + UA
    if os.path.exists(COOKIE):
        cmd[3:3] = ['-b', COOKIE]
    return subprocess.run(cmd, capture_output=True, text=True).stdout


def query(date):
    """返回 {'车次 发站 发点': '二等有 一等3'}；接口抽风返回 None（这一轮不动状态）"""
    url = ('https://kyfw.12306.cn/otn/leftTicket/queryG?'
           'leftTicketDTO.train_date=%s&leftTicketDTO.from_station=%s'
           '&leftTicketDTO.to_station=%s&purpose_codes=ADULT' % (date, FROM, TO))
    try:
        data = json.loads(curl(url), strict=False)['data']
    except Exception:
        return None
    m = data.get('map', {})
    out = {}
    for row in data.get('result', []):
        a = row.split('|')
        if not (LO <= a[8] <= HI):
            continue
        seats = ['%s%s' % (l, a[i]) for l, i in SEATS if a[i] and a[i] != '无']
        if seats:
            out['%s %s %s' % (a[3], m.get(a[6], a[6]), a[8])] = ' '.join(seats)
    return out


def main():
    now = query(DATE)
    if now is None:
        print('查询失败，跳过')
        return
    old = {}
    if os.path.exists(STATE):
        try:
            old = json.load(open(STATE))
        except Exception:
            pass
    fresh = newly(now, old)
    if fresh and os.environ.get('QUIET'):        # 建基线用，别拿本来就有票的喊一遍
        print('QUIET 建基线，不通知：', fresh)
        fresh = {}
    if fresh:
        body = '\n'.join('%s：%s' % kv for kv in fresh.items())
        subprocess.run([NOTIFY, '【票】%s %s→%s 冒出 %d 趟：\n%s'
                        % (DATE, FROM, TO, len(fresh), body)], timeout=60)
        print('NEW:', fresh)
    else:
        print('无变化，%d 趟有票' % len(now))
    json.dump(now, open(STATE, 'w'), ensure_ascii=False)


if os.environ.get('SELFTEST'):
    # 自测：只验「什么算冒出来」这条判断，不联网、不碰状态文件
    assert newly({'X 06:00': '二等1'}, {}) == {'X 06:00': '二等1'}          # 上次没记录 → 报
    assert newly({'X 06:00': '二等2'}, {'X 06:00': '二等1'}) == {}          # 同票种只有数量变 → 不报
    assert newly({'X 06:00': '商务3 二等有'}, {'X 06:00': '商务3'}) == \
        {'X 06:00': '商务3 二等有'}                                        # 多出票种 → 报
    assert newly({'X 06:00': '二等有'}, {'X 06:00': '二等有 无座9'}) == {}  # 票种变少（被抢走）→ 不报
    assert newly({'X 06:00': '二等1'}, {'X 06:00': '二等1'}) == {}          # 一模一样 → 不报
    assert classes('二等2 一等有') == {'二等', '一等'}
    assert classes('无座17') == {'无座'}
    print('自测 7 项全过')
else:
    main()

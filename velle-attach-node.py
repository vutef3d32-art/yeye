"""起 velle sidecar 的启动器：不碰 velle 源码，只在使用前把「贴哪个控制台」换掉。

原来的 injector 贴的是「父进程」的控制台。这台机器上 velle 的 python 是被包在一个
启动器 python 下面的，父进程那个控制台没人读 —— 字打进去了，她那边一个字也看不见。
改成往上找第一个 node.exe（就是真我那个会话），贴它的控制台。
"""
import ctypes
import ctypes.wintypes as wintypes
import os
import sys

VELLE_SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "velle", "src")
sys.path.insert(0, VELLE_SRC)

import velle.injector as inj  # noqa: E402

TH32CS_SNAPPROCESS = 0x00000002


class PROCESSENTRY32(ctypes.Structure):
    _fields_ = [
        ("dwSize", wintypes.DWORD),
        ("cntUsage", wintypes.DWORD),
        ("th32ProcessID", wintypes.DWORD),
        ("th32DefaultHeapID", ctypes.POINTER(ctypes.c_ulong)),
        ("th32ModuleID", wintypes.DWORD),
        ("cntThreads", wintypes.DWORD),
        ("th32ParentProcessID", wintypes.DWORD),
        ("pcPriClassBase", ctypes.c_long),
        ("dwFlags", wintypes.DWORD),
        ("szExeFile", ctypes.c_char * 260),
    ]


def _find_node_pid():
    snap = inj.kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
    pe = PROCESSENTRY32()
    pe.dwSize = ctypes.sizeof(PROCESSENTRY32)
    table = {}
    if inj.kernel32.Process32First(snap, ctypes.byref(pe)):
        while True:
            table[pe.th32ProcessID] = (
                pe.th32ParentProcessID,
                pe.szExeFile.decode("mbcs", "replace").lower(),
            )
            if not inj.kernel32.Process32Next(snap, ctypes.byref(pe)):
                break
    inj.kernel32.CloseHandle(snap)

    pid = os.getpid()
    for _ in range(15):
        entry = table.get(pid)
        if not entry:
            return None
        ppid, name = entry
        if name == "node.exe":
            return pid
        if ppid == 0 or ppid == pid:
            return None
        pid = ppid
    return None


def _attach_target_console():
    target = _find_node_pid()
    inj.kernel32.FreeConsole()
    if target and inj.kernel32.AttachConsole(target):
        return True
    # 找不到 node 祖先就退回老办法，别把整个服务弄哑
    if inj.kernel32.AttachConsole(inj.ATTACH_PARENT_PROCESS):
        return True
    raise inj.ConsoleNotAvailable(
        "AttachConsole 失败（node=%s, err=%d）" % (target, ctypes.get_last_error())
    )


inj._attach_parent_console = _attach_target_console

from velle.server import main  # noqa: E402

main()

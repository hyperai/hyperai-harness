#!/usr/bin/env python3
"""RFC-001 PoC: run a command on a real PTY, capture the screen stream, replay keys.

The dsh TUI needs an interactive terminal; a pipe is not supported upstream, so
every runtime check in RFC-001 T4 uses this harness. It records the raw byte
stream (ANSI included) and a plain-text rendering with control sequences removed,
which is what the evidence files quote.

Usage:
    pty-capture.py --out out --cols 120 --rows 40 --seconds 25 \\
        --send 4:/update\\r --send 2:\\x1b -- <command> [args...]

Each `--send <delay>:<text>` fires after <delay> seconds from start. `\\r` is a
carriage return (what a terminal sends for Enter) and `\\x1b` is Esc. The process
is terminated after <seconds> or when it exits on its own.
"""
import argparse
import codecs
import faulthandler
import fcntl
import os
import pty
import re
import select
import signal
import struct
import sys
import termios
import time

ANSI = re.compile(
    rb"(?:\x1b\[[0-?]*[ -/]*[@-~])"
    rb"|(?:\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?)"
    rb"|(?:\x1b[@-_])"
)


def strip_ansi(data: bytes) -> str:
    text = ANSI.sub(b"", data)
    text = text.replace(b"\r\n", b"\n").replace(b"\r", b"")
    return text.decode("utf-8", "replace")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True, help="output prefix (writes .raw and .txt)")
    parser.add_argument("--cols", type=int, default=120)
    parser.add_argument("--rows", type=int, default=40)
    parser.add_argument("--seconds", type=float, default=25.0)
    parser.add_argument("--send", action="append", default=[], help="delay:keystrokes")
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command
    if command and command[0] == "--":
        command = command[1:]
    if not command:
        parser.error("no command")

    steps = []
    for spec in args.send:
        delay, _, text = spec.partition(":")
        steps.append((float(delay), codecs.decode(text, "unicode_escape").encode("utf-8")))
    steps.sort()

    pid, fd = pty.fork()
    if pid == 0:
        os.execvpe(command[0], command, os.environ.copy())
        os._exit(127)

    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", args.rows, args.cols, 0, 0))
    # A hung capture must still end: dump the stack and exit 15 s after the
    # nominal deadline instead of blocking the caller forever.
    faulthandler.dump_traceback_later(args.seconds + 15, exit=True)

    chunks, started, next_step = [], time.time(), 0
    deadline = started + args.seconds
    exited = False
    while True:
        now = time.time()
        if now >= deadline:
            break
        while next_step < len(steps) and now - started >= steps[next_step][0]:
            os.write(fd, steps[next_step][1])
            next_step += 1
        timeout = max(0.0, min(0.2, deadline - now))
        ready, _, _ = select.select([fd], [], [], timeout)
        if ready:
            try:
                data = os.read(fd, 65536)
            except OSError:
                break
            if not data:
                break
            chunks.append(data)
        done, status = os.waitpid(pid, os.WNOHANG)
        if done == pid:
            exited = True
            # Drain whatever is still buffered.
            while True:
                ready, _, _ = select.select([fd], [], [], 0.2)
                if not ready:
                    break
                try:
                    data = os.read(fd, 65536)
                except OSError:
                    data = b""
                if not data:
                    break
                chunks.append(data)
            break

    if not exited:
        # The TUI starts helper processes on the same session; kill the whole
        # group so no orphan keeps the PTY (and this script's exit) alive.
        for sig in (signal.SIGTERM, signal.SIGKILL):
            try:
                os.killpg(pid, sig)
            except ProcessLookupError:
                break
            end = time.time() + 1.0
            while time.time() < end:
                try:
                    done, _status = os.waitpid(pid, os.WNOHANG)
                except ChildProcessError:
                    done = pid
                if done == pid:
                    break
                time.sleep(0.05)
    os.close(fd)

    raw = b"".join(chunks)
    with open(args.out + ".raw", "wb") as handle:
        handle.write(raw)
    with open(args.out + ".txt", "w", encoding="utf-8") as handle:
        handle.write(strip_ansi(raw))
    sys.stdout.write(f"captured {len(raw)} bytes -> {args.out}.raw/.txt\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

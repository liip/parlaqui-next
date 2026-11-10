#!/usr/bin/env bash
# Polls /healthz every half second and reports how long the site did not answer 200.
# Run it just before a release, stop it with Ctrl-C once the new pod serves.
#   scripts/measure-downtime.sh https://parlaqui.ch
#   scripts/measure-downtime.sh https://parlaqui.ch 203.0.113.10    # before the local DNS knows the new address
set -u
# printf reads the decimals python prints, whatever the shell's locale
export LC_ALL=C

base="${1:?usage: scripts/measure-downtime.sh <base-url> [ip]}"
base="${base%/}"
ip="${2:-}"
host=$(printf '%s' "$base" | sed -E 's#^[a-z]+://([^/:]+).*#\1#')
resolve=()
[ -n "$ip" ] && resolve=(--resolve "$host:443:$ip")

down_since=''
longest=0
total=0

now() { python3 -c 'import time; print(f"{time.time():.1f}")'; }

close_cut() {
	cut=$(python3 -c "print(round($(now) - $down_since, 1))")
	total=$(python3 -c "print($total + $cut)")
	longest=$(python3 -c "print(max($longest, $cut))")
	down_since=''
}

report() {
	if [ -n "$down_since" ]; then
		close_cut
		printf '\nstill down after %s s' "$cut"
	fi
	printf '\nlongest cut %.1f s, total %.1f s\n' "$longest" "$total"
	exit 0
}
trap report INT TERM

while true; do
	code=$(curl -s -m 2 ${resolve[@]+"${resolve[@]}"} -o /dev/null -w '%{http_code}' "$base/healthz")
	if [ "$code" = 200 ]; then
		if [ -n "$down_since" ]; then
			close_cut
			printf '%s  back after %s s\n' "$(date +%T)" "$cut"
		fi
	elif [ -z "$down_since" ]; then
		down_since=$(now)
		printf '%s  down (%s)\n' "$(date +%T)" "$code"
	fi
	sleep 0.5
done

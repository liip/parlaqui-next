#!/usr/bin/env bash
# Checks that a Parlaqui instance is ready to be played and found.
#   scripts/readiness.sh https://parlaqui.ch --production                          # crawlers let in
#   scripts/readiness.sh https://parlaqui.ch --production --resolve 203.0.113.10   # before DNS points there
#   scripts/readiness.sh https://staging.example --staging                         # crawlers kept out
#   scripts/readiness.sh http://localhost:4320                                     # no crawler checks
# --resolve sends every request for the parlaqui host names to that address. The other host names
# are checked whenever the base is https://parlaqui.ch. The game smoke test plays one timed game.
# Exits non-zero when any check fails; prints one line per check.
set -u

usage='usage: scripts/readiness.sh <base-url> [--production | --staging] [--resolve <ip>]'
base="${1:?$usage}"
base="${base%/}"
shift
mode=''
ip=''
while [ $# -gt 0 ]; do
	case "$1" in
	--production | --staging) mode="${1#--}" ;;
	--resolve)
		ip="${2:?$usage}"
		shift
		;;
	*)
		echo "$usage" >&2
		exit 2
		;;
	esac
	shift
done

CANONICAL=https://parlaqui.ch
OTHER_NAMES='https://www.parlaqui.ch https://parlaqui.swiss https://www.parlaqui.swiss http://parlaqui.ch'

resolve=()
if [ -n "$ip" ]; then
	for host in parlaqui.ch www.parlaqui.ch parlaqui.swiss www.parlaqui.swiss; do
		resolve+=(--resolve "$host:443:$ip" --resolve "$host:80:$ip")
	done
	# the base may be another name or port, such as a staging address
	authority=$(printf '%s' "$base" | sed -E 's#^[a-z]+://([^/]+).*#\1#')
	port=$(printf '%s' "$authority" | sed -n -E 's#.*:([0-9]+)$#\1#p')
	case "$base" in https:*) default_port=443 ;; *) default_port=80 ;; esac
	resolve+=(--resolve "${authority%:*}:${port:-$default_port}:$ip")
fi

jar=$(mktemp)
trap 'rm -f "$jar"' EXIT

failures=0
pass() { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; failures=$((failures + 1)); }
check() { if eval "$2"; then pass "$1"; else fail "$1"; fi; }

# the expansion stays empty without --resolve, also under set -u in bash 3
c() { curl -s -m 20 ${resolve[@]+"${resolve[@]}"} -b "$jar" -c "$jar" "$@"; }
body() { c "$base$1"; }
status() { c -o /dev/null -w '%{http_code}' "$base$1"; }
header() { c -I "$base$1" | tr -d '\r' | grep -i "^$2:" | cut -d' ' -f2-; }
content_type() { c -o /dev/null -w '%{content_type}' "$base$1"; }
post() { c -X POST -H 'content-type: application/json' -d "$2" "$base$1"; }
field() { grep -o -E "\"$1\":\"?[^\",}]*" | head -1 | sed -E "s/^\"$1\":\"?//"; }

echo "Parlaqui readiness for $base${ip:+ at $ip}${mode:+ ($mode)}"

echo "Pages"
check "/healthz answers 200" '[ "$(status /healthz)" = 200 ]'
for lang in de fr it rm; do
	check "/$lang answers 200" '[ "$(status /$lang)" = 200 ]'
	check "/$lang/members answers 200" '[ "$(status /$lang/members)" = 200 ]'
	check "/$lang/privacy answers 200" '[ "$(status /$lang/privacy)" = 200 ]'
done
check "/ redirects to a language" '[ "$(status /)" = 302 ]'

echo "Data"
members=$(body /de | grep -o -E '[0-9]+ Gesichter' | head -1 | grep -o -E '[0-9]+')
check "the roster has 240 to 246 playable members (found ${members:-none})" \
	'[ -n "$members" ] && [ "$members" -ge 240 ] && [ "$members" -le 246 ]'
check "the home page does not warn about stale data" '! body /de | grep -q "älter als drei Tage"'
check "the last roster import is less than 36 hours old" '[ "$(status /healthz/roster)" = 200 ]'
national=$(body /de/members | grep -o -E 'Nationalrat ?<span[^>]*>[0-9]+' | grep -o -E '[0-9]+$' | head -1)
states=$(body /de/members | grep -o -E 'Ständerat ?<span[^>]*>[0-9]+' | grep -o -E '[0-9]+$' | head -1)
check "the members page lists 195 to 200 national councillors (found ${national:-none})" \
	'[ -n "$national" ] && [ "$national" -ge 195 ] && [ "$national" -le 200 ]'
check "the members page lists 44 to 46 states councillors (found ${states:-none})" \
	'[ -n "$states" ] && [ "$states" -ge 44 ] && [ "$states" -le 46 ]'

echo "Game"
game=$(post /api/game '{"council":"all","language":"de"}')
game_id=$(printf '%s' "$game" | field gameId)
photo=$(printf '%s' "$game" | field photoUrl)
check "a game starts (got ${game_id:-nothing})" '[ -n "$game_id" ]'
played=0
for index in 0 1 2 3 4 5 6 7 8 9; do
	[ -n "$game_id" ] && [ -n "$photo" ] || break
	[ "$(content_type "$photo")" = image/jpeg ] || break
	round=$(post "/api/game/$game_id/round/$index/start" '{}')
	[ "$(printf '%s' "$round" | grep -o '"firstName"' | wc -l | tr -d ' ')" = 6 ] || break
	member=$(printf '%s' "$round" | field id)
	verdict=$(post "/api/game/$game_id/round/$index/answer" "{\"memberId\":$member}")
	printf '%s' "$verdict" | grep -q '"correct":' || break
	photo=$(printf '%s' "$verdict" | field photoUrl)
	played=$((played + 1))
	# the next round opens once the verdict has been shown
	reveal=$(printf '%s' "$verdict" | field revealMs)
	sleep "$(awk "BEGIN { print (${reveal:-3000} + 200) / 1000 }")"
done
check "10 rounds play through: a JPEG photo, 6 options, a verdict each (played $played)" \
	'[ "$played" = 10 ]'
check "the summary answers once the game is over" \
	'[ "$(status "/api/game/$game_id/summary")" = 200 ]'
share=$(post "/api/game/$game_id/share" '{}' | field token)
check "the score can be shared (got ${share:-nothing})" '[ -n "$share" ]'
check "the story image is a JPEG" '[ "$(content_type "/de/s/$share/story.jpg")" = image/jpeg ]'
# the check game leaves the figures as they were
check "the check game is forgotten" \
	'[ "$(c -o /dev/null -w "%{http_code}" -X DELETE "$base/api/game/$game_id")" = 204 ]'
check "the forgotten game is gone" '[ "$(status "/api/game/$game_id/summary")" = 404 ]'

echo "Search engines"
robots=$(body /robots.txt)
case "$mode" in
staging)
	check "robots.txt keeps crawlers out" '[ "$robots" = "$(printf "User-agent: *\nDisallow: /")" ]'
	check "pages carry x-robots-tag noindex" '[ -n "$(header /de x-robots-tag)" ]'
	;;
production)
	check "robots.txt lets crawlers in and names the sitemap" \
		'printf "%s" "$robots" | grep -q "Allow: /" && printf "%s" "$robots" | grep -q "Sitemap: https://parlaqui.ch/sitemap.xml"'
	check "the home page carries no x-robots-tag" '[ -z "$(header /de x-robots-tag)" ]'
	;;
esac
check "the sitemap lists 12 pages" '[ "$(body /sitemap.xml | grep -o "<loc>" | wc -l | tr -d " ")" = 12 ]'
check "the home page has a description and a canonical on parlaqui.ch" \
	'body /fr | grep -q "<meta name=\"description\"" && body /fr | grep -q "rel=\"canonical\" href=\"https://parlaqui.ch/fr\""'
check "the share image answers" '[ "$(status /images/og.jpg)" = 200 ]'
check "llms.txt answers" '[ "$(status /llms.txt)" = 200 ]'
check "the game page is noindex" '[ -n "$(header "/de/game?council=all" x-robots-tag)" ]'

echo "Security"
check "an unknown import token gets 404" \
	'[ "$(c -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer nope" "$base/api/import")" = 404 ]'
check "insights without a token get 404" '[ "$(status /api/insights)" = 404 ]'
check "the audience page without a session gets 404" '[ "$(status /insights)" = 404 ]'
check "robots.txt never names the audience page" '! body /robots.txt | grep -q insights'

if [ "$base" = "$CANONICAL" ]; then
	echo "Other names"
	for name in $OTHER_NAMES; do
		target=$(c -o /dev/null -w '%{redirect_url}' "$name/")
		check "$name redirects to $CANONICAL (got ${target:-nothing})" \
			'case "$target" in "$CANONICAL"/*) true ;; *) false ;; esac'
	done
fi

echo
if [ "$failures" -eq 0 ]; then
	echo "Ready."
else
	echo "$failures check(s) failed."
	exit 1
fi

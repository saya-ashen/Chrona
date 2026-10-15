#!/usr/bin/env bash
# TEST ONLY: records one fake transport attempt; never contacts QQ or reads credentials.
set -eu
: "${FAKE_HERMES_DIR:?test capture directory required}"
n=0
if [[ -f "$FAKE_HERMES_DIR/count" ]]; then read -r n < "$FAKE_HERMES_DIR/count"; fi
n=$((n + 1))
printf '%s\n' "$n" > "$FAKE_HERMES_DIR/count"
printf '%s\0' "$@" >> "$FAKE_HERMES_DIR/argv"
printf '%s\0' "$@" > "$FAKE_HERMES_DIR/argv-$n"
# Read stdin verbatim without interpreting attachment markers or shell syntax.
cat > "$FAKE_HERMES_DIR/stdin-$n"
mode=ok
if [[ -f "$FAKE_HERMES_DIR/mode" ]]; then read -r mode < "$FAKE_HERMES_DIR/mode"; fi
case "$mode" in
  ok) printf '{"success":true,"platform":"qqbot","chat_id":"TESTOPENID","message_id":"m-%s"}\n' "$n" ;;
  reject) printf '%s\n' '{"error":"QQBot send failed: channel=404 c2c=500 group=500"}'; exit 1 ;;
  unknown) printf '%s\n' '{"error":"QQBot send failed: ReadTimeout"}'; exit 1 ;;
  hang) sleep 60 ;;
  *) exit 2 ;;
esac

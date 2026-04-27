#!/usr/bin/env bash
set -euo pipefail

ARTIFACTS_DIR="artifacts/demo/playwright"
OUT_DIR="docs/assets"
TMP_DIR="${ARTIFACTS_DIR}/tmp"

mkdir -p "$OUT_DIR" "$TMP_DIR"

find_video() {
  local keyword="$1"
  find "$ARTIFACTS_DIR" -maxdepth 2 -name "*.webm" | grep "$keyword" | head -1
}

PLAN_VIDEO=$(find_video "Demo-1")
ASSISTANT_VIDEO=$(find_video "Demo-2")

if [ -z "$PLAN_VIDEO" ] || [ -z "$ASSISTANT_VIDEO" ]; then
  echo "ERROR: Could not find both demo videos in $ARTIFACTS_DIR"
  echo "  plan video:     ${PLAN_VIDEO:-NOT FOUND}"
  echo "  assistant video: ${ASSISTANT_VIDEO:-NOT FOUND}"
  exit 1
fi

echo "Plan video:     $PLAN_VIDEO"
echo "Assistant video: $ASSISTANT_VIDEO"

# ── Demo 1: Plan Generation ──
# Take first 30s (form fill + click generate) then skip to end
PLAN_DURATION=$(ffprobe -v error -show_entries format=duration \
  -of default=noprint_wrappers=1:nokey=1 "$PLAN_VIDEO")
PLAN_END=$(printf "%.0f" "$(echo "$PLAN_DURATION - 15" | bc)")

echo "Plan video duration: ${PLAN_DURATION}s, capturing segment 0-30 + ${PLAN_END}-end"

ffmpeg -y \
  -ss 0  -i "$PLAN_VIDEO" -t 30 -c copy "${TMP_DIR}/plan-start.webm" 2>/dev/null
ffmpeg -y \
  -ss "$PLAN_END" -i "$PLAN_VIDEO" -t 15 -c copy "${TMP_DIR}/plan-end.webm" 2>/dev/null

# Concat and convert
ffmpeg -y -i "concat:${TMP_DIR}/plan-start.webm|${TMP_DIR}/plan-end.webm" \
  -c copy "${TMP_DIR}/plan-concat.webm" 2>/dev/null
ffmpeg -y -i "${TMP_DIR}/plan-concat.webm" \
  -vf "fps=10,scale=640:-1:flags=lanczos" \
  "$OUT_DIR/demo-plan.gif" 2>/dev/null

# ── Demo 2: Assistant ──
# Skip first 5s (page load), keep until response comes and plan is accepted
ASSISTANT_DURATION=$(ffprobe -v error -show_entries format=duration \
  -of default=noprint_wrappers=1:nokey=1 "$ASSISTANT_VIDEO")
ASSISTANT_KEEP=$(printf "%.0f" "$(echo "$ASSISTANT_DURATION - 5" | bc)")

echo "Assistant video duration: ${ASSISTANT_DURATION}s, capturing from 5s for ${ASSISTANT_KEEP}s"

ffmpeg -y -ss 5 -i "$ASSISTANT_VIDEO" -t "$ASSISTANT_KEEP" \
  -vf "fps=10,scale=640:-1:flags=lanczos" \
  "$OUT_DIR/demo-assistant.gif" 2>/dev/null

# Cleanup
rm -rf "$TMP_DIR"

echo ""
du -sh "$OUT_DIR/demo-plan.gif" "$OUT_DIR/demo-assistant.gif"
echo "GIFs written to $OUT_DIR/"

#!/usr/bin/env bash

set -u

# Run from backend directory even if invoked elsewhere.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$BACKEND_DIR"

DEFAULT_TIMEOUT_SECONDS=1800
TIMEOUT_SECONDS_VALUE="${TIMEOUT_SECONDS:-$DEFAULT_TIMEOUT_SECONDS}"

cyan='\033[0;36m'
green='\033[0;32m'
yellow='\033[0;33m'
red='\033[0;31m'
nc='\033[0m'
current_child_pid=0

print_usage() {
  cat <<USAGE
Usage:
  ./src/testing/run_test.sh [timeout_seconds] --universityIds="UNIVERSITY_ID" [manager args...]
  ./src/testing/run_test.sh --universityIds="UNIVERSITY_ID" [manager args...]

Examples:
  ./src/testing/run_test.sh --universityIds="1c08965e-a829-483e-9417-3f4f602af357"
  ./src/testing/run_test.sh --universityIds="1c08965e-a829-483e-9417-3f4f602af357" --q="Advanced Computing"
  ./src/testing/run_test.sh 900 --universityIds="1c08965e-a829-483e-9417-3f4f602af357" --q="Advanced Computing"

Notes:
  - Arguments after the optional timeout are passed directly to src/scrapers/manager.ts.
  - Use npx prisma studio to find university IDs.
  - Set TIMEOUT_SECONDS=0 to disable timeout.
USAGE
}

kill_process_tree() {
  local target_pid="$1"
  if ! [[ "$target_pid" =~ ^[0-9]+$ ]]; then
    return 0
  fi

  if ! kill -0 "$target_pid" 2>/dev/null; then
    return 0
  fi

  kill -TERM -- "-$target_pid" 2>/dev/null || true
  sleep 2
  kill -KILL -- "-$target_pid" 2>/dev/null || true
  wait "$target_pid" 2>/dev/null || true
}

handle_interrupt() {
  printf "\n${yellow}[!] Interrupt received. Stopping active process...${nc}\n" >&2
  kill_process_tree "$current_child_pid"
  exit 130
}

trap 'handle_interrupt' INT TERM

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  print_usage
  exit 0
fi

if [[ "${1:-}" =~ ^[0-9]+$ ]]; then
  TIMEOUT_SECONDS_VALUE="$1"
  shift
fi

manager_args=("$@")

if [ "${#manager_args[@]}" -eq 0 ]; then
  printf "${red}Error:${nc} no manager arguments provided.\n" >&2
  print_usage >&2
  exit 1
fi

has_university_ids=false
for arg in "${manager_args[@]}"; do
  if [[ "$arg" == --universityIds=* ]]; then
    has_university_ids=true
    break
  fi
done

if [ "$has_university_ids" = false ]; then
  printf "${red}Error:${nc} --universityIds is required.\n" >&2
  printf "${yellow}[!] Use 'npx prisma studio' to find the university ID. ${nc}\n" >&2
  print_usage >&2
  exit 1
fi

if ! [[ "$TIMEOUT_SECONDS_VALUE" =~ ^[0-9]+$ ]]; then
  printf "${red}Error:${nc} timeout must be a non-negative integer in seconds.\n" >&2
  printf "${yellow}[!] Got: %s${nc}\n" "$TIMEOUT_SECONDS_VALUE" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  printf "${red}Error:${nc} node is not installed or not in PATH.\n" >&2
  exit 1
fi

if ! node -e 'const [maj, min, patch] = process.versions.node.split(".").map(Number); const ok = (maj === 20 && (min > 18 || (min === 18 && patch >= 1))) || (maj >= 22 && (maj > 22 || min >= 3)); process.exit(ok ? 0 : 1);'; then
  current_node="$(node -v 2>/dev/null || echo "unknown")"
  printf "${red}Error:${nc} Unsupported Node version ${current_node}.\n" >&2
  printf "${yellow}[!] This backend needs Node >=20.18.1 (<21) or >=22.3.0.${nc}\n" >&2
  printf "${yellow}[!] Example with nvm: nvm install 20 && nvm use 20${nc}\n" >&2
  exit 1
fi

if [ ! -d "node_modules" ]; then
  printf "${yellow}[!] node_modules not found in backend/.${nc}\n" >&2
  printf "${yellow}[!] Run 'npm install' in backend first for stable local execution.${nc}\n" >&2
fi

if [ -z "${DATABASE_URL:-}" ] && [ ! -f ".env" ]; then
  printf "${red}Error:${nc} DATABASE_URL is not set.\n" >&2
  printf "${yellow}[!] Create backend/.env from .env.example and set DATABASE_URL.${nc}\n" >&2
  exit 1
fi

if ! command -v setsid >/dev/null 2>&1; then
  printf "${red}Error:${nc} setsid is required but not found.\n" >&2
  printf "Install util-linux and rerun.\n" >&2
  exit 1
fi

if [ -x "./node_modules/.bin/ts-node" ]; then
  runner=(./node_modules/.bin/ts-node)
else
  if ! command -v npx >/dev/null 2>&1; then
    printf "${red}Error:${nc} npx is not installed or not in PATH.\n" >&2
    exit 1
  fi
  runner=(npx ts-node)
fi

printf "\n${cyan}======================================================${nc}\n"
printf "${cyan}Running scraper manager${nc}\n"
printf "${cyan}======================================================${nc}\n"
printf "Command: %s src/scrapers/manager.ts" "${runner[*]}"
printf " %q" "${manager_args[@]}"
printf "\n"

start_secs=$(date +%s)
start_precise=$(date +%s.%N)
timed_out=false

setsid "${runner[@]}" src/scrapers/manager.ts "${manager_args[@]}" &
pid=$!
current_child_pid="$pid"

while kill -0 "$pid" 2>/dev/null; do
  elapsed=$(( $(date +%s) - start_secs ))
  if (( TIMEOUT_SECONDS_VALUE > 0 && elapsed >= TIMEOUT_SECONDS_VALUE )); then
    timed_out=true
    printf "\n${yellow}[!] Timeout of %ss reached. Terminating process tree...${nc}\n" "$TIMEOUT_SECONDS_VALUE"
    kill_process_tree "$pid"
    break
  fi
  sleep 0.5
done

end_precise=$(date +%s.%N)
elapsed_precise=$(awk "BEGIN {printf \"%.2f\", $end_precise - $start_precise}")

if [ "$timed_out" = false ]; then
  wait "$pid"
  exit_code=$?
else
  exit_code=124
fi

current_child_pid=0

if [ "$exit_code" -eq 0 ]; then
  printf "\n${green}[+] Scraper finished in %s seconds.${nc}\n" "$elapsed_precise"
else
  printf "\n${yellow}[!] Scraper finished in %s seconds with exit code %s.${nc}\n" "$elapsed_precise" "$exit_code"
fi

exit "$exit_code"

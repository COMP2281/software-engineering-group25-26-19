#!/usr/bin/env bash

set -u

# Run from backend directory even if invoked elsewhere.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$BACKEND_DIR"

universities=(
  # "University of Aberdeen"
  # "University of Bath"
  # "University of Birmingham"
  # "University of Bristol"
  # "University of Cambridge"
  # "Cardiff University"
  # "Durham University"
  # "The University of Edinburgh"
  # "University of Exeter"
  # "University of Glasgow"
  # "Imperial College London"
  # "King's College London, University of London (KCL)"
  # "Lancaster University"
  # "University of Leeds"
  # "University of Liverpool"
  # "Loughborough University"
  # "London School of Economics and Political Science, University of London (LSE)"
  # "University of Manchester"
  # "Newcastle University"
  # "Northumbria University, Newcastle"
  #"University of Nottingham"
  #"University of Oxford"
  #"Queen Mary University of London"
  "Queen's University Belfast"
  "Royal Holloway, University of London"
  "University of Sheffield"
  "SOAS University of London"
  "University of Southampton"
  "University of St Andrews"
  "University of Sunderland"
  "University of Surrey"
  "University of Sussex"
  "UCL (University College London)"
  "University of Warwick"
  "University of York"
)

default_timeout_seconds=1800
timeout_seconds="${1:-${TIMEOUT_SECONDS:-$default_timeout_seconds}}"

cyan='\033[0;36m'
green='\033[0;32m'
yellow='\033[0;33m'
red='\033[0;31m'
nc='\033[0m'
current_child_pid=0

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

if ! command -v npx >/dev/null 2>&1; then
  printf "${red}Error:${nc} npx is not installed or not in PATH.\n" >&2
  exit 1
fi

if ! [[ "$timeout_seconds" =~ ^[0-9]+$ ]]; then
  printf "${red}Error:${nc} timeout must be a non-negative integer (seconds).\n" >&2
  printf "${yellow}[!] Got: %s${nc}\n" "$timeout_seconds" >&2
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
  printf "${yellow}[!] Create backend/.env (you can copy .env.example) and set DATABASE_URL.${nc}\n" >&2
  printf "${yellow}[!] Example: cp .env.example .env${nc}\n" >&2
  exit 1
fi

if ! command -v setsid >/dev/null 2>&1; then
  printf "${red}Error:${nc} setsid is required but not found.\n" >&2
  printf "Install util-linux and rerun.\n" >&2
  exit 1
fi

for uni in "${universities[@]}"; do
  printf "\n${cyan}======================================================${nc}\n"
  printf "${cyan}Processing: %s${nc}\n" "$uni"
  printf "${cyan}======================================================${nc}\n"

  start_secs=$(date +%s)
  start_precise=$(date +%s.%N)
  timed_out=false

  if [ -x "./node_modules/.bin/ts-node" ]; then
    runner=(./node_modules/.bin/ts-node)
  else
    runner=(npx ts-node)
  fi

  # Start in its own session so we can terminate the whole process group on timeout.
  setsid "${runner[@]}" src/scripts/test.ts "$uni" &
  pid=$!
  current_child_pid="$pid"

  while kill -0 "$pid" 2>/dev/null; do
    elapsed=$(( $(date +%s) - start_secs ))
    if (( timeout_seconds > 0 && elapsed >= timeout_seconds )); then
      timed_out=true
      printf "\n${yellow}[!] Timeout of %ss reached for '%s'. Terminating process tree...${nc}\n" "$timeout_seconds" "$uni"
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
    if [ "$exit_code" -eq 0 ]; then
      printf "\n${green}[+] Finished processing '%s' in %s seconds.${nc}\n" "$uni" "$elapsed_precise"
    else
      printf "\n${yellow}[!] Finished '%s' in %s seconds with exit code %s.${nc}\n" "$uni" "$elapsed_precise" "$exit_code"
    fi
  fi
  current_child_pid=0

  # Brief pause between universities to allow sockets/connections to settle.
  sleep 1
done

printf "\n${cyan}======================================================${nc}\n"
printf "${green}All universities processed.${nc}\n"
printf "${cyan}======================================================${nc}\n"

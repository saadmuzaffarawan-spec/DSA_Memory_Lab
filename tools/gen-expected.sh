#!/usr/bin/env bash
# Regenerates tests/programs/*.expected from a real g++ (Linux, -O0, C++17). Run this on a machine with g++.
set -euo pipefail
cd "$(dirname "$0")/../tests/programs"
for f in *.cpp; do
  b="${f%.cpp}"
  g++ -std=c++17 -O0 -w -o "/tmp/stackyard_$b" "$f"
  "/tmp/stackyard_$b" < "$( [ -f "$b.in" ] && echo "$b.in" || echo /dev/null )" > "$b.expected" || true
done
echo "expected outputs regenerated"

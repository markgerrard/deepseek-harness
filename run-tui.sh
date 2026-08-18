#!/bin/bash
set -euo pipefail
export PATH=/home/box/node22/bin:$PATH
cd /workspace/deepseek-harness
exec pnpm dsh tui "$@"

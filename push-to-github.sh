#!/bin/bash
# 一键推送 Marmot 到 GitHub。
#
# 用法：
#   ./push-to-github.sh <github_token>
#
# 令牌需要 repo 权限（创建仓库 + 推送代码）。
# 令牌不会写入文件，仅在本次运行中使用。

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OWNER="lishuiping"
REPO_NAME="marmot"
DESCRIPTION="An open-source, completely free live-preview Markdown editor in the spirit of Typora. No activation code, no account, no telemetry — because Typora requires a paid license. Built with Electron + React + TypeScript."

if [ $# -lt 1 ]; then
  echo "用法: $0 <github_token>" >&2
  exit 1
fi

TOKEN="$1"
AUTH="x-access-token:${TOKEN}"

echo "==> 创建仓库 ${OWNER}/${REPO_NAME}（若已存在则跳过）"
HTTP_CODE=$(curl -s -o /tmp/marmot-create-repo.json -w "%{http_code}" \
  -X POST \
  -H "Authorization: Bearer ${AUTH}" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -d "{\"name\":\"${REPO_NAME}\",\"description\":\"${DESCRIPTION}\",\"private\":false,\"autoInit\":false}" \
  "https://api.github.com/user/repos")

case "$HTTP_CODE" in
  201) echo "    仓库创建成功" ;;
  422) echo "    仓库已存在，继续" ;;
  *)   echo "    创建失败 (HTTP ${HTTP_CODE}):" >&2
       cat /tmp/marmot-create-repo.json >&2
       exit 1 ;;
esac

echo "==> 推送代码到 main 分支"
cd "$REPO_DIR"
git push -u "https://x-access-token:${TOKEN}@github.com/${OWNER}/${REPO_NAME}.git" main

echo "==> 设置仓库信息"
curl -s -o /dev/null -X PATCH \
  -H "Authorization: Bearer ${AUTH}" \
  -H "Accept: application/vnd.github+json" \
  -d "{\"description\":\"${DESCRIPTION}\",\"topics\":[\"markdown\",\"editor\",\"electron\",\"react\",\"typescript\",\"typeset\",\"offline\",\"open-source\",\"free\"]}" \
  "https://api.github.com/repos/${OWNER}/${REPO_NAME}"

echo
echo "完成: https://github.com/${OWNER}/${REPO_NAME}"

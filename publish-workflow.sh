#!/bin/bash
# Publishes the multi-platform build workflow to GitHub.
#
# GitHub refuses to create or update anything under .github/workflows/ unless
# the token carries the "workflow" scope. The GitHub connector in WorkBuddy is
# read-only, so this step needs a personal access token with both "repo" and
# "workflow".
#
# Create one at:
#   https://github.com/settings/tokens/new?scopes=repo,workflow&description=marmot-ci
#
# Usage:
#   ./publish-workflow.sh <github_token>

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKFLOW="build-release.yml"
SOURCE="${REPO_DIR}/.github/workflows/${WORKFLOW}"

if [ $# -lt 1 ]; then
  echo "用法: $0 <github_token>" >&2
  echo "令牌需要 repo 与 workflow 权限" >&2
  exit 1
fi

TOKEN="$1"
AUTH="x-access-token:${TOKEN}"

if [ ! -f "$SOURCE" ]; then
  echo "找不到 ${SOURCE}" >&2
  exit 1
fi

echo "==> 检查令牌权限"
SCOPES=$(curl -s -I -H "Authorization: Bearer ${TOKEN}" "https://api.github.com/user" \
  | grep -i "x-oauth-scopes" | tr -d '\r' | sed -E 's/.*: //')
echo "    scopes: ${SCOPES:-（未返回）}"
case "$SCOPES" in
  *workflow*) ;;
  *) echo "    警告：令牌缺少 workflow 权限，推送 .github/workflows/ 会被 GitHub 拒绝。" >&2 ;;
esac

echo "==> 推送工作流文件"
cd "$REPO_DIR"
git push "https://${AUTH}@github.com/lishuiping/marmot.git" \
  HEAD:refs/heads/main -- ".github/workflows/${WORKFLOW}"

echo "==> 触发一次构建"
git push "https://${AUTH}@github.com/lishuiping/marmot.git" "v1.0.0" || {
  echo "    标签已存在，跳过推送；可在 Actions 页面手动触发。"
}

echo
echo "完成。构建进度见：https://github.com/lishuiping/marmot/actions"

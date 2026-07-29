#!/bin/bash
# Bumps every cache-busting marker in one shot, so a deploy can't ship with only
# some of them updated.
#
# There are three, and they have to move together:
#   1. DEPLOY_DATE in js/main.js   — shown in the UI
#   2. ?v=... on the CSS/JS tags in index.html — busts the browser HTTP cache
#   3. CACHE_NAME in sw.js         — busts the service worker's cache
#
# Missing #3 is what shipped commit 9454285 ("Bump cache version so devices stop
# serving the pre-revert bundle"): index.html was updated but the service worker
# kept handing devices the old bundle from its own cache.
#
# Run directly, or let the pre-push hook call it.

set -euo pipefail
cd "$(dirname "$0")/.."

TIMESTAMP=$(date '+%Y-%m-%d %H:%M')
VERSION=$(date '+%Y%m%d%H%M')

sed -i '' "s/const DEPLOY_DATE='[^']*'/const DEPLOY_DATE='$TIMESTAMP'/" js/main.js

# Any ?v=<token> on a local asset, whatever the previous format was.
sed -i '' -E "s/\?v=[A-Za-z0-9._-]+/?v=$VERSION/g" index.html

# benefits-tracker-v43 -> benefits-tracker-v44
CURRENT_CACHE=$(grep -o "benefits-tracker-v[0-9]*" sw.js | head -1)
CACHE_NUM=${CURRENT_CACHE##*-v}
NEXT_CACHE="benefits-tracker-v$((CACHE_NUM + 1))"
sed -i '' "s/benefits-tracker-v[0-9]*/$NEXT_CACHE/g" sw.js

echo "bump-version: DEPLOY_DATE=$TIMESTAMP  assets=?v=$VERSION  sw=$NEXT_CACHE"

if ! git diff --quiet js/main.js index.html sw.js; then
  git add js/main.js index.html sw.js
  git commit -m "chore: bump cache version $VERSION ($NEXT_CACHE)"
fi

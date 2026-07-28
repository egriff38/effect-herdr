#!/usr/bin/env bash
# Guards against a known changesets/cli bug under npm trusted publishing
# (OIDC): with no auth token present, the pre-publish `npm info` precheck
# can't see private/scoped packages and returns 404 for everything,
# so `changeset publish` re-attempts every already-published version on
# each run. npm's E403 response for those includes an error.summary
# changesets checks for, but a retried/duplicate run can still crash
# (see https://github.com/changesets/changesets/issues/2099) rather than
# skip cleanly.
#
# Workaround (documented in that issue): before the tokenless OIDC publish
# step, mark any package whose current version is ALREADY on the registry
# as private in this CI checkout only — never committed — so
# `changeset publish` skips it outright instead of re-attempting it.
set -euo pipefail

for pkg_json in packages/*/package.json; do
  dir=$(dirname "$pkg_json")
  name=$(node -p "require('./$pkg_json').name")
  version=$(node -p "require('./$pkg_json').version")
  private=$(node -p "require('./$pkg_json').private ?? false")

  if [ "$private" = "true" ]; then
    continue
  fi

  published_version=$(npm view "$name" version 2>/dev/null || echo "")

  if [ "$published_version" = "$version" ]; then
    echo "$name@$version is already published — marking private for this run"
    node -e "
      const fs = require('node:fs')
      const path = '$pkg_json'
      const pkg = JSON.parse(fs.readFileSync(path, 'utf8'))
      pkg.private = true
      fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n')
    "
  fi
done

if ! git diff --quiet; then
  git config user.name "github-actions[bot]"
  git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
  git commit -am "chore: mark already-published packages private for this CI run [skip ci]"
fi

#!/bin/bash

##############################################
# MediaHub set_version developed by Lucasion #
##############################################

# Updates the version everywhere it's stored: package.json, setup.sh, ipm-package.yaml and the input helper.
# Usage: ./set_version.sh 1.2.0

VERSION="$1"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]]; then
  echo "Set the version of MediaHub everywhere it's stored."
  echo "Usage: ./set_version.sh <VERSION>"
  echo "The version must be semver, like 1.2.0 or 2.0.0-alpha.0."
  exit 2
fi

cd "$(dirname "$0")" || exit 1
npm version "$VERSION" --no-git-tag-version --allow-same-version > /dev/null || exit 1
sed -i "s/^MEDIAHUB_VERSION=\".*\"/MEDIAHUB_VERSION=\"$VERSION\"/" setup.sh
sed -i "s/^version: \".*\"/version: \"$VERSION\"/" ipm-package.yaml
sed -i "s/^const version = \".*\"/const version = \"$VERSION\"/" native/input/cmd/mediahub-input/main.go
echo "Done! Version set to $VERSION."

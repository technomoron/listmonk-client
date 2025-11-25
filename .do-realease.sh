#!/bin/sh

VERSION=$(node -p "require('./package.json').version")

echo "Creating release for ${VERSION}"

git tag -a "v${VERSION}" -m "Release version ${VERSION}"
git push origin "v${VERSION}"

npm publish --access=public

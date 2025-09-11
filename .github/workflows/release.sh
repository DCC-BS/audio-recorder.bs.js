#!/usr/bin/env bash

# prerequisites: 
# - npm version patch --no-git-tag-version  (or [<newversion> | major | minor | patch | premajor | preminor | prepatch | prerelease | from-git])
# - bun install
# - bun generate
# - bun prepack

set -e

NEXT_VERSION=$(node -p "require('./package.json').version")
echo "Next version: $NEXT_VERSION"

# Create a temporary directory to store the dist and necessary files
TEMP_DIR=$(mktemp -d)
echo "Created temporary directory: $TEMP_DIR"

# Copy essential files to the temporary directory
cp -r dist "$TEMP_DIR/"
cp package.json "$TEMP_DIR/"
cp README.md "$TEMP_DIR/"

# Create or checkout the releases branch
BRANCH="releases/v$NEXT_VERSION"
git checkout -b $BRANCH 2>/dev/null || git checkout $BRANCH

# Clear everything except .git
find . -mindepth 1 -maxdepth 1 -not -name '.git' -exec rm -rf {} \;

# Copy the files back from the temporary directory
cp -r "$TEMP_DIR"/* .

# Clean up the temporary directory
rm -rf "$TEMP_DIR"

git add .
git commit -m "Release v$NEXT_VERSION"
git tag -a "v$NEXT_VERSION" -m "Release v$NEXT_VERSION"
git push origin $BRANCH --follow-tags

# Go back to the original branch
git checkout -

echo "Released version $NEXT_VERSION on branch $BRANCH"
#!/usr/bin/env bash
# Copyright IBM Corp. 2016, 2025
# SPDX-License-Identifier: BUSL-1.1

# build-and-verify.sh builds a fips-tagged Vault binary natively for this
# runner, builds the FIPS-path UBI container image from it (Dockerfile
# `ubi` target, WO-046), and hands the resulting image to
# enos/scripts/verify-fips-startup.sh (WO-055).
#
# This must run on a Linux amd64/arm64 host: the "fips" build tag requires
# cgo (see helper/constants/fips_cgo_check.go), and cross-compiling cgo for
# Linux from a non-Linux host requires a Linux C cross-toolchain this
# script does not attempt to set up. Real CI runners (ubuntu-latest) and an
# Enos-provisioned FIPS-enabled host (see WO-060) both satisfy this
# natively. Developers on macOS can reproduce the same build inside a
# `golang` container (`docker run --rm -v "$PWD":/src -w /src golang:1.27
# env CGO_ENABLED=1 GOOS=linux GOARCH=arm64 go build -tags "fips
# fips_140_3" -o dist/linux/arm64/vault .`) before invoking this script.
#
# Required environment variables:
#   ROOT_DIR         - absolute path to the Vault repository root
#   IMAGE_TAG         - the docker image tag to build, e.g. vault:fips-check
#   PRODUCT_VERSION   - PRODUCT_VERSION Dockerfile build-arg
#   PRODUCT_REVISION  - PRODUCT_REVISION Dockerfile build-arg

set -euo pipefail

: "${ROOT_DIR:?ROOT_DIR must be set}"
: "${IMAGE_TAG:?IMAGE_TAG must be set}"
: "${PRODUCT_VERSION:?PRODUCT_VERSION must be set}"
: "${PRODUCT_REVISION:?PRODUCT_REVISION must be set}"

cd "$ROOT_DIR"

GOOS="linux"
GOARCH="$(go env GOARCH)"
BIN_PATH="dist/${GOOS}/${GOARCH}/vault"

echo "build-and-verify: building fips-tagged binary for ${GOOS}/${GOARCH}"
mkdir -p "$(dirname "$BIN_PATH")"
CGO_ENABLED=1 GOOS="$GOOS" GOARCH="$GOARCH" go build -tags "fips fips_140_3" -o "$BIN_PATH" .

echo "build-and-verify: building FIPS-path UBI image ${IMAGE_TAG}"
docker build --target ubi \
  --build-arg BIN_NAME=vault \
  --build-arg TARGETOS="$GOOS" \
  --build-arg TARGETARCH="$GOARCH" \
  --build-arg PRODUCT_VERSION="$PRODUCT_VERSION" \
  --build-arg PRODUCT_REVISION="$PRODUCT_REVISION" \
  --build-arg LICENSE_SOURCE=LICENSE \
  --build-arg LICENSE_DEST=/usr/share/doc/vault/LICENSE.txt \
  -t "$IMAGE_TAG" .

echo "build-and-verify: running startup verification"
"${ROOT_DIR}/enos/scripts/verify-fips-startup.sh" --image "$IMAGE_TAG"

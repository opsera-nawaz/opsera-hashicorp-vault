# Copyright IBM Corp. 2016, 2026
# SPDX-License-Identifier: BUSL-1.1

## Builder
#
#  A build container used to build the Vault binary. We use focal because the
#  version of glibc is old enough for all of our supported distros for editions
#  that require CGO. This container is used in CI to build all binaries that
#  require CGO.
#
#  To run it locally, first build the builder container:
#    docker build -t builder --build-arg GO_VERSION=$(cat .go-version) .
#
#  Then build Vault using the builder container:
#    docker run -it -v $(pwd):/build -v GITHUB_TOKEN=$GITHUB_TOKEN --env GO_TAGS='ui enterprise cgo hsm venthsm' --env GOARCH=s390x --env GOOS=linux --env VERSION=1.20.0-beta1 --env VERSION_METADATA=ent.hsm --env CGO_ENABLED=1 builder make ci-build
#
#  You can also share your local Go modules with the container to avoid downloading
#  them every time:
#    docker run -it -v $(pwd):/build -v $(go env GOMODCACHE):/go-mod-cache --env GITHUB_TOKEN=$GITHUB_TOKEN --env GO_TAGS='ui enterprise cgo hsm venthsm' --env GOARCH=s390x --env GOOS=linux --env VERSION=1.20.0-beta1 --env VERSION_METADATA=ent.hsm --env GOMODCACHE=/go-mod-cache --env CGO_ENABLED=1 builder make ci-build
#
#  If you have a linux machine you can also share the tools
#    GOBIN="$(go env GOPATH)/bin" make tools
#    docker run -it -v $(pwd):/build -v $(go env GOMODCACHE):/go-mod-cache -v "$(go env GOPATH)/bin":/opt/tools/bin --env GITHUB_TOKEN=$GITHUB_TOKEN --env GO_TAGS='ui enterprise cgo hsm venthsm' --env GOARCH=s390x --env GOOS=linux --env VERSION=1.20.0-beta1 --env VERSION_METADATA=ent.hsm --env GOMODCACHE=/go-mod-cache --env CGO_ENABLED=1 builder make ci-build
FROM ubuntu:focal AS builder

# Pass in the GO_VERSION as a build-arg
ARG GO_VERSION

# Set our environment
ENV PATH="/root/go/bin:/opt/go/bin:/opt/tools/bin:$PATH"
ENV GOPRIVATE='github.com/hashicorp/*'

# Install the necessary system tooling to cross compile vault for our various
# CGO targets. Do this separately from branch specific Go and build toolchains
# so our various builder image layers can share cache.
COPY .build/system.sh .
RUN chmod +x system.sh && ./system.sh && rm -rf system.sh

# Install the correct Go toolchain
COPY .build/go.sh .
RUN chmod +x go.sh && ./go.sh && rm -rf go.sh

# Install the vault tools installer. It might be required during build if the
# pre-build tools are not mounted into the container.
COPY tools/tools.sh .
RUN chmod +x tools.sh

# Run the build
COPY .build/entrypoint.sh .
RUN chmod +x entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]

#  Default
#
#  Our default conatiner image.
#
FROM alpine:3 AS default

ARG BIN_NAME
# NAME and PRODUCT_VERSION are the name of the software in releases.hashicorp.com
# and the version to download. Example: NAME=vault PRODUCT_VERSION=1.2.3.
ARG NAME=vault
ARG PRODUCT_VERSION
ARG PRODUCT_REVISION
# TARGETARCH and TARGETOS are set automatically when --platform is provided.
ARG TARGETOS TARGETARCH
# LICENSE_SOURCE is the path to IBM license documents, which may be architecture-specific.
ARG LICENSE_SOURCE
# LICENSE_DEST is the path where license files are installed in the container
ARG LICENSE_DEST

# Additional metadata labels used by container registries, platforms
# and certification scanners.
LABEL name="Vault" \
      maintainer="Vault Team <vault@hashicorp.com>" \
      vendor="HashiCorp" \
      version=${PRODUCT_VERSION} \
      release=${PRODUCT_REVISION} \
      revision=${PRODUCT_REVISION} \
      summary="Vault is a tool for securely accessing secrets." \
      description="Vault is a tool for securely accessing secrets. A secret is anything that you want to tightly control access to, such as API keys, passwords, certificates, and more. Vault provides a unified interface to any secret, while providing tight access control and recording a detailed audit log."

# Copy the license file as per Legal requirement
COPY ${LICENSE_SOURCE} ${LICENSE_DEST}

# Set ARGs as ENV so that they can be used in ENTRYPOINT/CMD
ENV NAME=$NAME

# Create a non-root user to run the software.
RUN addgroup ${NAME} && adduser -S -G ${NAME} ${NAME}

# Install su-exec for exec-ing Vault when the container is run with a privileged
# user. Install dumb-init to use as the entrypoint PID 1 to handle reaping
# zombie processes. Update our timezone database.
RUN apk update && apk add --upgrade --no-cache su-exec dumb-init tzdata

COPY dist/$TARGETOS/$TARGETARCH/${BIN_NAME} /bin/${BIN_NAME}

# /vault/logs is made available to use as a location to store audit logs, if
# desired; /vault/file is made available to use as a location with the file
# storage backend, if desired; the server will be started with /vault/config as
# the configuration directory so you can add additional config files in that
# location.
RUN mkdir -p /vault/logs && \
    mkdir -p /vault/file && \
    mkdir -p /vault/config && \
    chown -R ${NAME}:${NAME} /vault

# Expose the logs directory as a volume since there's potentially long-running
# state in there
VOLUME /vault/logs

# Expose the file directory as a volume since there's potentially long-running
# state in there
VOLUME /vault/file

# 8200/tcp is the primary interface that applications use to interact with
# Vault.
EXPOSE 8200

# The entry point script uses dumb-init as the top-level process to reap any
# zombie processes created by Vault sub-processes.
#
# For production derivatives of this container, you should add the IPC_LOCK
# capability so that Vault can mlock memory.
COPY .release/docker/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["docker-entrypoint.sh"]

# Use the Vault user as the default user for starting this container.
USER ${NAME}

# # By default you'll get a single-node development server that stores everything
# # in RAM and bootstraps itself. Don't use this configuration for production.
CMD ["server", "-dev"]


#  UBI
#
#  Our UBI container image
#
#  FIPS 140-3 Phase 3 (WO-046, quality gate FIPS-CONTAINER-001): this stage
#  is the CE-buildable FIPS-path candidate image documented in
#  fips/inventory/container_kms_inventory.yaml (id: ce-ubi10-minimal,
#  role: fips_path_candidate). It is glibc-based (a prerequisite for the
#  OpenSSL FIPS provider self-test mechanism -- musl/Alpine does not support
#  it reliably, see the `default` stage above and FIPS-CONTAINER-001) and
#  installs/activates that provider below. It is distinct from, and does
#  NOT replace, the Enterprise-only `ubi-fips` / `ubi-hsm-fips` targets
#  referenced by .github/actions/containerize/action.yml, which require the
#  Enterprise build/license pipeline and do not exist in this CE Dockerfile.
#
#  To build and tag the FIPS-path image locally:
#    docker build --target ubi \
#      --build-arg BIN_NAME=vault --build-arg TARGETOS=linux --build-arg TARGETARCH=amd64 \
#      --build-arg PRODUCT_VERSION=$(cat version/VERSION) --build-arg PRODUCT_REVISION=$(git rev-parse --short HEAD) \
#      --build-arg LICENSE_SOURCE=LICENSE --build-arg LICENSE_DEST=/usr/share/doc/vault/LICENSE.txt \
#      -t vault:$(cat version/VERSION)-fips .
#
#  Then verify the FIPS provider is active and self-tests successfully:
#    docker run --rm vault:$(cat version/VERSION)-fips openssl list -providers
#    docker run --rm vault:$(cat version/VERSION)-fips sh -c \
#      "echo -n selftest | openssl dgst -sha256 -provider fips -propquery fips=yes"
FROM registry.access.redhat.com/ubi10/ubi-minimal AS ubi

ARG BIN_NAME
# NAME and PRODUCT_VERSION are the name of the software in releases.hashicorp.com
# and the version to download. Example: NAME=vault PRODUCT_VERSION=1.2.3.
ARG NAME=vault
ARG PRODUCT_VERSION
ARG PRODUCT_REVISION
# TARGETARCH and TARGETOS are set automatically when --platform is provided.
ARG TARGETOS TARGETARCH
# LICENSE_SOURCE is the path to IBM license documents, which may be architecture-specific.
ARG LICENSE_SOURCE
# LICENSE_DEST is the path where license files are installed in the container
ARG LICENSE_DEST

# Additional metadata labels used by container registries, platforms
# and certification scanners.
LABEL name="Vault" \
      maintainer="Vault Team <vault@hashicorp.com>" \
      vendor="HashiCorp" \
      version=${PRODUCT_VERSION} \
      release=${PRODUCT_REVISION} \
      revision=${PRODUCT_REVISION} \
      summary="Vault is a tool for securely accessing secrets." \
      description="Vault is a tool for securely accessing secrets. A secret is anything that you want to tightly control access to, such as API keys, passwords, certificates, and more. Vault provides a unified interface to any secret, while providing tight access control and recording a detailed audit log."

# Set ARGs as ENV so that they can be used in ENTRYPOINT/CMD
ENV NAME=$NAME

# Copy the license file as per Legal requirement
COPY ${LICENSE_SOURCE} ${LICENSE_DEST}/

# We must have a copy of the license in this directory to comply with the HasLicense Redhat requirement
# Note the trailing slash on the first argument -- plain files meet the requirement but directories do not.
COPY ${LICENSE_SOURCE}/ /licenses/

# Update our timezone database. Install shadow-utils for creating our vault user
# and group. Install util-linux for su for exec when the container is run as root.
# Add tar as tar as it is necessary for some of our testing.
RUN microdnf update -y --nobest && \
  microdnf install -y tzdata shadow-utils util-linux tar && \
  rm -rf /var/cache/yum && \
  microdnf clean all

# ---------------------------------------------------------------------------
# FIPS 140-3 Phase 3 (WO-046, quality gate FIPS-CONTAINER-001):
# Install and activate the CMVP-validated OpenSSL 3.x FIPS provider so this
# stage is a functional FIPS-path candidate image, not just a glibc base.
#
# Installing `openssl` (which pulls in `openssl-libs`) provides
# /usr/lib64/ossl-modules/fips.so and the static FIPS-activation fragment
# /etc/pki/tls/fips_local.cnf. Verified directly against this image during
# this work order: `openssl list -providers -verbose` reports
#   fips: name="Red Hat Enterprise Linux 9 - OpenSSL FIPS Provider",
#         version=3.0.7-cda111b5812c30d4, status=active
# i.e. Red Hat ships the RHEL 9-validated FIPS provider module unchanged on
# UBI 10 ("Red Hat uses the same cryptographic module on RHEL 10 as is used
# on RHEL 9" -- access.redhat.com/articles/3655361). That openssl-3.0.7-*
# module lineage is covered by active NIST CMVP certificates #4746 (initial
# validation, RHEL 9.0, module base openssl-3.0.7-16.el9) and #4857 (RHEL
# 9.2/9.4/9.5/9.6, module base openssl-3.0.7-18.el9_2) --
# csrc.nist.gov/projects/cryptographic-module-validation-program/certificate/4857.
# The exact build id (3.0.7-cda111b5812c30d4) observed above was NOT
# independently cross-referenced against either certificate's listed
# tested-configuration string within this session -- flagged for
# confirmation in a later FIPS phase, per the same disclosure discipline
# already used in fips/inventory/container_kms_inventory.yaml.
#
# update-crypto-policies --set FIPS tightens the system-wide TLS/cipher
# policy backend to the FIPS subset (pairs with WO-029's FIPS-Approved
# cipher allowlist); --no-reload is required because this container has no
# init system to restart services against.
#
# Architecture divergence from Enterprise (tracked as an open assumption --
# see docs/fips/risk-register.md, traceability row REQ-007): HashiCorp's
# Enterprise FIPS 140-3 CI builds Vault with GOEXPERIMENT=boringcrypto (Go
# BoringCrypto module) as the validated crypto boundary for the Vault
# *binary itself*. This image instead activates the host OS's OpenSSL 3.x
# FIPS provider as a container-level crypto boundary for the Community/OSS
# FIPS-path candidate. Vault's Go binary uses Go's standard crypto/*
# packages and does not link against or call into this OpenSSL FIPS
# provider or read OPENSSL_CONF -- this hardens the container's OS-level
# crypto surface but is NOT itself a claim that the Vault process is
# FIPS-validated. Resolving this CE-OpenSSL vs. Enterprise-BoringCrypto
# divergence is an explicit follow-up, not something this WO closes.
RUN microdnf install -y openssl openssl-libs crypto-policies-scripts && \
  microdnf clean all && \
  update-crypto-policies --set FIPS --no-reload

# Activate the FIPS provider as the process-wide OpenSSL configuration for
# this image. openssl-fips.cnf `.include`s Red Hat's pre-shipped FIPS
# activation fragment (/etc/pki/tls/fips_local.cnf) -- there is no
# fipsinstall bootstrap step to run here; see the comment in that file for
# why (Red Hat's OpenSSL build disables the upstream `openssl fipsinstall`
# subcommand entirely).
COPY .release/docker/openssl-fips.cnf /etc/pki/tls/openssl-fips.cnf
ENV OPENSSL_CONF=/etc/pki/tls/openssl-fips.cnf

# Build-time proof that the FIPS provider is active and its self-test
# passed. Red Hat's build rejects the upstream `openssl fipsinstall
# -verify` self-test command outright (confirmed during this work order:
# it errors with "This command is not enabled in the Red Hat Enterprise
# Linux OpenSSL build"), so the Red Hat-equivalent self-test evidence is a
# successful FIPS-restricted cryptographic operation: if the provider's
# internal self-test failed, OpenSSL would refuse to report it as
# "active" and/or this fips-only digest would fail. Either failure aborts
# the image build.
RUN openssl list -providers | grep -q '^[[:space:]]*fips$' && \
  echo -n "vault-fips-provider-self-test" | openssl dgst -sha256 -provider fips -propquery fips=yes

# Create a non-root user to run the software.
RUN groupadd --gid 1000 vault && \
    adduser --uid 100 --system -g vault vault && \
    usermod -a -G root vault

COPY dist/$TARGETOS/$TARGETARCH/${BIN_NAME} /bin/${BIN_NAME}

# /vault/logs is made available to use as a location to store audit logs, if
# desired; /vault/file is made available to use as a location with the file
# storage backend, if desired; the server will be started with /vault/config as
# the configuration directory so you can add additional config files in that
# location.
ENV HOME=/home/vault
RUN mkdir -p /vault/logs && \
    mkdir -p /vault/file && \
    mkdir -p /vault/config && \
    mkdir -p $HOME && \
    chown -R vault /vault && chown -R vault $HOME && \
    chgrp -R 0 $HOME && chmod -R g+rwX $HOME && \
    chgrp -R 0 /vault && chmod -R g+rwX /vault

# Expose the logs directory as a volume since there's potentially long-running
# state in there
VOLUME /vault/logs

# Expose the file directory as a volume since there's potentially long-running
# state in there
VOLUME /vault/file

# 8200/tcp is the primary interface that applications use to interact with
# Vault.
EXPOSE 8200

# The entry point script uses dumb-init as the top-level process to reap any
# zombie processes created by Vault sub-processes.
#
# For production derivatives of this container, you should add the IPC_LOCK
# capability so that Vault can mlock memory.
COPY .release/docker/ubi-docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["docker-entrypoint.sh"]

# Use the Vault user as the default user for starting this container.
USER ${NAME}

# # By default you'll get a single-node development server that stores everything
# # in RAM and bootstraps itself. Don't use this configuration for production.
CMD ["server", "-dev"]

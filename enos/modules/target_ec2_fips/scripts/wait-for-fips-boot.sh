#!/usr/bin/env bash
# Copyright IBM Corp. 2016, 2025
# SPDX-License-Identifier: BUSL-1.1
#
# wait-for-fips-boot.sh verifies that the fips=1 kernel boot parameter set
# by target_ec2_fips's user_data (dracut-fips + `fips-mode-setup --enable`
# + reboot) has taken effect. It retries briefly because the enos SSH
# transport can reconnect a few seconds before the new initramfs is fully
# active on some AMIs.

set -uo pipefail

ATTEMPTS="${ATTEMPTS:-10}"
SLEEP_SECONDS="${SLEEP_SECONDS:-6}"

for i in $(seq 1 "$ATTEMPTS"); do
  fips_enabled="$(cat /proc/sys/crypto/fips_enabled 2>/dev/null || echo "unknown")"
  if [ "$fips_enabled" = "1" ]; then
    echo "target_ec2_fips: /proc/sys/crypto/fips_enabled=1 (attempt ${i}/${ATTEMPTS})"
    exit 0
  fi
  echo "target_ec2_fips: /proc/sys/crypto/fips_enabled=${fips_enabled}, retrying (attempt ${i}/${ATTEMPTS})" >&2
  sleep "$SLEEP_SECONDS"
done

echo "target_ec2_fips: FATAL - /proc/sys/crypto/fips_enabled did not report '1' after ${ATTEMPTS} attempts" >&2
exit 1

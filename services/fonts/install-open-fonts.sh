#!/bin/sh
set -eu

# This is the single public font payload for every server-side Office engine.
# Keep the browser editor and the headless renderer on the same files so that
# line breaking, autofit and save/reopen measurements use one metric system.
PRETENDARD_VERSION="${PRETENDARD_VERSION:-1.3.9}"
PRETENDARD_SHA256="${PRETENDARD_SHA256:-04be351a74d6bf7d60c480a3087e51d185485d35a52023142af1df19eb8c428a}"
NOTO_SANS_KR_SHA256="${NOTO_SANS_KR_SHA256:-194018e6b2b293a7964f037b25c0249ce1418bc9ab3c971060a03aa57861e252}"
NOTO_KR_OFL_SHA256="${NOTO_KR_OFL_SHA256:-1c05c68c34f9708415aada51f17e1b0092d2cea709bf4a94cd38114f9e73d7d9}"

apt-get -o Acquire::Retries=5 update
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  fontconfig \
  fonts-crosextra-caladea \
  fonts-crosextra-carlito \
  fonts-lato \
  fonts-liberation \
  fonts-liberation-sans-narrow \
  fonts-nanum \
  fonts-noto-cjk \
  fonts-noto-color-emoji \
  fonts-roboto-unhinted \
  unzip

curl --fail --location --retry 3 --silent --show-error \
  "https://github.com/orioncactus/pretendard/releases/download/v${PRETENDARD_VERSION}/Pretendard-${PRETENDARD_VERSION}.zip" \
  --output /tmp/spellbook-pretendard.zip
echo "${PRETENDARD_SHA256}  /tmp/spellbook-pretendard.zip" | sha256sum --check --strict
mkdir -p /usr/local/share/fonts/pretendard /usr/share/doc/pretendard
unzip -j /tmp/spellbook-pretendard.zip 'public/static/*.otf' -d /usr/local/share/fonts/pretendard
unzip -p /tmp/spellbook-pretendard.zip LICENSE.txt > /usr/share/doc/pretendard/LICENSE.txt
rm -f /tmp/spellbook-pretendard.zip

mkdir -p /usr/local/share/fonts/google-noto /usr/share/doc/google-noto
curl --fail --location --retry 3 --silent --show-error \
  "https://raw.githubusercontent.com/google/fonts/main/ofl/notosanskr/NotoSansKR%5Bwght%5D.ttf" \
  --output /usr/local/share/fonts/google-noto/NotoSansKR.ttf
echo "${NOTO_SANS_KR_SHA256}  /usr/local/share/fonts/google-noto/NotoSansKR.ttf" | sha256sum --check --strict
curl --fail --location --retry 3 --silent --show-error \
  "https://raw.githubusercontent.com/google/fonts/main/ofl/notosanskr/OFL.txt" \
  --output /usr/share/doc/google-noto/NotoSansKR-OFL.txt
echo "${NOTO_KR_OFL_SHA256}  /usr/share/doc/google-noto/NotoSansKR-OFL.txt" | sha256sum --check --strict

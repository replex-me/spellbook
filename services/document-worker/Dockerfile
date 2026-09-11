FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:10.0-noble AS build
ARG TARGETARCH
WORKDIR /src
COPY services/document-worker/Spellbook.Document.Worker.slnx ./services/document-worker/
COPY services/document-worker/src/Spellbook.Document.Core/Spellbook.Document.Core.csproj ./services/document-worker/src/Spellbook.Document.Core/
COPY services/document-worker/src/Spellbook.Document.Worker/Spellbook.Document.Worker.csproj ./services/document-worker/src/Spellbook.Document.Worker/
COPY services/document-worker/tools/Spellbook.Document.Tool/Spellbook.Document.Tool.csproj ./services/document-worker/tools/Spellbook.Document.Tool/
COPY services/document-worker/tests/Spellbook.Document.Tests/Spellbook.Document.Tests.csproj ./services/document-worker/tests/Spellbook.Document.Tests/
RUN case "$TARGETARCH" in \
      amd64) runtime_id=linux-x64 ;; \
      arm64) runtime_id=linux-arm64 ;; \
      *) echo "Unsupported target architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac \
    && dotnet restore services/document-worker/Spellbook.Document.Worker.slnx --runtime "$runtime_id"
COPY services/document-worker/ ./services/document-worker/
RUN case "$TARGETARCH" in \
      amd64) runtime_id=linux-x64 ;; \
      arm64) runtime_id=linux-arm64 ;; \
      *) echo "Unsupported target architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac \
    && dotnet publish services/document-worker/src/Spellbook.Document.Worker/Spellbook.Document.Worker.csproj \
      --configuration Release --output /app/publish --no-restore \
      --runtime "$runtime_id" --self-contained true
RUN case "$TARGETARCH" in \
      amd64) runtime_id=linux-x64 ;; \
      arm64) runtime_id=linux-arm64 ;; \
      *) echo "Unsupported target architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac \
    && dotnet publish services/document-worker/tools/Spellbook.Document.Tool/Spellbook.Document.Tool.csproj \
      --configuration Release --output /app/tool --no-restore \
      --runtime "$runtime_id" --self-contained true

FROM debian:trixie-slim@sha256:d7e12182ce18b85b93007c1dedf31f2d29e01ccf3182cc4017c709b6259bc132 AS runtime
ARG LIBREOFFICE_VERSION=26.8.0.3
ARG LIBREOFFICE_DEBIAN_VERSION=26.8.0.3-2~bpo13+1
ARG PRETENDARD_VERSION=1.3.9
ARG PRETENDARD_SHA256=04be351a74d6bf7d60c480a3087e51d185485d35a52023142af1df19eb8c428a
ARG NOTO_SANS_KR_SHA256=194018e6b2b293a7964f037b25c0249ce1418bc9ab3c971060a03aa57861e252
ARG NOTO_KR_OFL_SHA256=1c05c68c34f9708415aada51f17e1b0092d2cea709bf4a94cd38114f9e73d7d9
RUN apt-get -o Acquire::Retries=5 update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates \
    && echo 'deb https://deb.debian.org/debian trixie-backports main' > /etc/apt/sources.list.d/backports.list \
    && apt-get -o Acquire::Retries=5 update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends -t trixie-backports \
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
        "libreoffice-core-nogui=4:${LIBREOFFICE_DEBIAN_VERSION}" \
        "libreoffice-impress-nogui=4:${LIBREOFFICE_DEBIAN_VERSION}" \
        poppler-utils \
        "python3-uno=4:${LIBREOFFICE_DEBIAN_VERSION}" \
        unzip \
    && soffice --version | grep --fixed-strings "LibreOffice ${LIBREOFFICE_VERSION}" \
    && curl --fail --location --retry 3 --silent --show-error \
        "https://github.com/orioncactus/pretendard/releases/download/v${PRETENDARD_VERSION}/Pretendard-${PRETENDARD_VERSION}.zip" \
        --output /tmp/pretendard.zip \
    && echo "${PRETENDARD_SHA256}  /tmp/pretendard.zip" | sha256sum --check --strict \
    && mkdir -p /usr/local/share/fonts/pretendard /usr/share/doc/pretendard \
    && unzip -j /tmp/pretendard.zip 'public/static/*.otf' -d /usr/local/share/fonts/pretendard \
    && unzip -p /tmp/pretendard.zip LICENSE.txt > /usr/share/doc/pretendard/LICENSE.txt \
    && rm -f /tmp/pretendard.zip \
    && mkdir -p /usr/local/share/fonts/google-noto /usr/share/doc/google-noto \
    && curl --fail --location --retry 3 --silent --show-error \
        "https://raw.githubusercontent.com/google/fonts/main/ofl/notosanskr/NotoSansKR%5Bwght%5D.ttf" \
        --output /usr/local/share/fonts/google-noto/NotoSansKR.ttf \
    && echo "${NOTO_SANS_KR_SHA256}  /usr/local/share/fonts/google-noto/NotoSansKR.ttf" | sha256sum --check --strict \
    && curl --fail --location --retry 3 --silent --show-error \
        "https://raw.githubusercontent.com/google/fonts/main/ofl/notosanskr/OFL.txt" \
        --output /usr/share/doc/google-noto/NotoSansKR-OFL.txt \
    && echo "${NOTO_KR_OFL_SHA256}  /usr/share/doc/google-noto/NotoSansKR-OFL.txt" | sha256sum --check --strict \
    && rm -rf /var/lib/apt/lists/*
COPY services/document-worker/fonts/spellbook-font-aliases.conf /etc/fonts/conf.d/70-spellbook-font-aliases.conf
COPY services/document-worker/fonts/spellbook-korean-fallback.conf /etc/fonts/conf.d/99-spellbook-korean-fallback.conf
RUN fc-cache -f \
    && test "$(fc-match --format='%{family}' Calibri)" = "Carlito" \
    && test "$(fc-match --format='%{family}' Arial)" = "Liberation Sans" \
    && test "$(fc-match --format='%{family}|%{style}' HeadLineA)" = "Liberation Sans Narrow|Bold" \
    && test "$(fc-match --format='%{family}' '맑은 고딕')" = "Noto Sans CJK KR" \
    && fc-match --format='%{family}' 'Noto Sans KR' | grep --fixed-strings "Noto Sans KR" \
    && fc-match --format='%{family}' Pretendard | grep --fixed-strings "Pretendard" \
    && fc-match --format='%{family}' 'Pretendard Black' | grep --fixed-strings "Pretendard Black"
WORKDIR /app
RUN mkdir -p /data /tmp/spellbook-user && chown -R 1000:1000 /data /tmp/spellbook-user
COPY --from=build /app/publish .
COPY --from=build /app/tool ./tool
COPY services/document-worker/scripts/render_with_libreoffice.py /app/render_with_libreoffice.py
COPY services/document-worker/scripts/powerpoint_text_metrics.py /app/powerpoint_text_metrics.py
ENV ASPNETCORE_URLS=http://0.0.0.0:8080 \
    DOTNET_EnableDiagnostics=0 \
    SPELLBOOK_RENDER_TIME_ZONE=Asia/Seoul \
    SPELLBOOK_DISABLE_CJK_SCRIPT_SPACING=1 \
    SPELLBOOK_POWERPOINT_METRIC_BASELINE=1 \
    LIBREOFFICE_PYTHON_PATH=/usr/bin/python3 \
    PYTHONPATH=/usr/lib/libreoffice/program \
    SPELLBOOK_LIBREOFFICE_RENDER_SCRIPT=/app/render_with_libreoffice.py \
    SAL_USE_VCLPLUGIN=svp \
    HOME=/tmp/spellbook-user
USER 1000:1000
EXPOSE 8080
ENTRYPOINT ["./Spellbook.Document.Worker"]

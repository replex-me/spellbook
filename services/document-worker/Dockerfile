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
LABEL org.spellbook.component="document-worker"
ARG LIBREOFFICE_VERSION=26.8.0.3
ARG LIBREOFFICE_DEBIAN_VERSION=26.8.0.3-2~bpo13+1
COPY services/fonts/install-open-fonts.sh /usr/local/bin/install-spellbook-open-fonts
RUN apt-get -o Acquire::Retries=5 update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates \
    && echo 'deb https://deb.debian.org/debian trixie-backports main' > /etc/apt/sources.list.d/backports.list \
    && apt-get -o Acquire::Retries=5 update \
    && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y \
    && sh /usr/local/bin/install-spellbook-open-fonts \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends -t trixie-backports \
        "libreoffice-core-nogui=4:${LIBREOFFICE_DEBIAN_VERSION}" \
        "libreoffice-impress-nogui=4:${LIBREOFFICE_DEBIAN_VERSION}" \
        poppler-utils \
        "python3-uno=4:${LIBREOFFICE_DEBIAN_VERSION}" \
    && soffice --version | grep --fixed-strings "LibreOffice ${LIBREOFFICE_VERSION}" \
    && rm -rf /var/lib/apt/lists/*
COPY services/fonts/spellbook-font-aliases.conf /etc/fonts/conf.d/70-spellbook-font-aliases.conf
COPY services/fonts/spellbook-korean-fallback.conf /etc/fonts/conf.d/99-spellbook-korean-fallback.conf
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

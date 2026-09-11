FROM collabora/code@sha256:379b8f1fc955dd6d01ba24adf61d1b177048ddaae179ae8c1e6a6342daccb282 AS collabora

FROM golang:1.24-alpine AS gateway-builder
WORKDIR /src
COPY services/office-editor/gateway/ ./
RUN CGO_ENABLED=0 go test ./... && \
    CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/spellbook-office-gateway .

FROM node:24-alpine AS browser-assets
RUN apk add --no-cache gzip
COPY --from=collabora /usr/share/coolwsd /upstream
COPY services/office-editor/patch-localization.mjs /tmp/patch-localization.mjs
COPY services/office-editor/patch-host-bridge.mjs /tmp/patch-host-bridge.mjs
COPY services/office-editor/localization-ko-overrides.json /tmp/localization-ko-overrides.json
COPY services/office-editor/extensions-index.json /upstream/browser/dist/extensions/index.json
COPY services/office-editor/extension /upstream/browser/dist/extensions/org.spellbook.editor
COPY services/office-editor/host-bridge.js /upstream/browser/dist/spellbook-host.js
RUN node /tmp/patch-localization.mjs \
      /upstream/browser/dist/l10n/ui-ko.json \
      /tmp/localization-ko-overrides.json && \
    node /tmp/patch-host-bridge.mjs /upstream/browser/dist/cool.html && \
    find /upstream/browser/dist -type f \( \
      -name '*.css' -o -name '*.html' -o -name '*.js' -o -name '*.json' -o \
      -name '*.map' -o -name '*.svg' -o -name '*.txt' -o -name '*.xml' \
    \) -exec gzip -9 -f -k '{}' + && \
    mkdir -p \
      /minimal/browser/dist/admin \
      /minimal/browser/dist/l10n \
      /minimal/browser/dist/src/app \
      /minimal/browser/dist/welcome && \
    cp /upstream/discovery.xml /minimal/discovery.xml && \
    cp /upstream/favicon.ico /minimal/favicon.ico && \
    cp -a /upstream/browser/admin-templates /minimal/browser/admin-templates && \
    cp /upstream/browser/dist/cool.html /minimal/browser/dist/cool.html && \
    cp /upstream/browser/dist/welcome/welcome.html /minimal/browser/dist/welcome/welcome.html && \
    cp /upstream/browser/dist/l10n/help-localizations.json /minimal/browser/dist/l10n/help-localizations.json && \
    cp /upstream/browser/dist/l10n/localizations.json /minimal/browser/dist/l10n/localizations.json && \
    cp /upstream/browser/dist/l10n/uno-localizations.json /minimal/browser/dist/l10n/uno-localizations.json && \
    cp /upstream/browser/dist/src/app/TaskWorker.js /minimal/browser/dist/src/app/TaskWorker.js && \
    cp /upstream/browser/dist/adminIntegratorSettings.html /minimal/browser/dist/adminIntegratorSettings.html && \
    cp /upstream/browser/dist/admin-bundle.js /minimal/browser/dist/admin-bundle.js && \
    cp /upstream/browser/dist/admin/admin.html /minimal/browser/dist/admin/admin.html && \
    cp /upstream/browser/dist/admin/adminSettings.html /minimal/browser/dist/admin/adminSettings.html && \
    cp /upstream/browser/dist/admin/adminHistory.html /minimal/browser/dist/admin/adminHistory.html && \
    cp /upstream/browser/dist/admin/adminAnalytics.html /minimal/browser/dist/admin/adminAnalytics.html && \
    cp /upstream/browser/dist/admin/adminLog.html /minimal/browser/dist/admin/adminLog.html && \
    cp /upstream/browser/dist/admin/adminAudit.html /minimal/browser/dist/admin/adminAudit.html && \
    cp /upstream/browser/dist/admin/adminClusterOverview.html /minimal/browser/dist/admin/adminClusterOverview.html && \
    cp /upstream/browser/dist/admin/adminClusterOverviewAbout.html /minimal/browser/dist/admin/adminClusterOverviewAbout.html

FROM collabora AS runtime
USER root
COPY --from=browser-assets --chown=1001:1001 /upstream/browser/dist /usr/share/coolwsd/browser/dist
COPY --from=browser-assets --chown=1001:1001 /minimal /opt/spellbook/coolwsd
COPY --from=gateway-builder --chown=1001:1001 /out/spellbook-office-gateway /usr/local/bin/spellbook-office-gateway
USER 1001
EXPOSE 9980
ENTRYPOINT ["/usr/local/bin/spellbook-office-gateway"]

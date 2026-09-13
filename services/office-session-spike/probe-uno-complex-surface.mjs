import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";

const require = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
);
const { chromium } = require("@playwright/test");
const url = process.argv[2] ?? "http://localhost:3190";
const reportPath = process.argv[3] ?? null;
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const deadline = Date.now() + 60_000;
  let extensionFrame;
  while (!extensionFrame) {
    extensionFrame = page
      .frames()
      .find((frame) =>
        frame.url().includes("/extensions/org.spellbook.editor/"),
      );
    if (Date.now() >= deadline)
      throw new Error("Native editor extension did not connect.");
    if (!extensionFrame) await page.waitForTimeout(250);
  }

  const result = await extensionFrame.evaluate(() =>
    cool.callRemote(function inspectComplexImpressSurface() {
      const desktop = uno.idl.com.sun.star.frame.Desktop.create(
        uno.componentContext,
      );
      const model = desktop.getCurrentFrame().getController().getModel();
      const pages = model.getDrawPages();
      const safeCall = (value, method, args = [], fallback = null) => {
        try {
          return value[method](...args);
        } catch (_) {
          return fallback;
        }
      };
      const safeProperty = (value, name) => {
        try {
          return value.getPropertyValue(name);
        } catch (_) {
          return null;
        }
      };
      const safeMember = (value, name) => {
        try {
          return value[name];
        } catch (_) {
          return null;
        }
      };
      const services = (value) => {
        try {
          return value.getSupportedServiceNames().sort();
        } catch (_) {
          return [];
        }
      };
      const properties = (value, pattern = null) => {
        try {
          return value
            .getPropertySetInfo()
            .getProperties()
            .filter((property) => !pattern || pattern.test(property.Name))
            .map((property) => ({
              name: property.Name,
              type: String(property.Type),
              attributes: property.Attributes,
            }))
            .sort((left, right) => left.name.localeCompare(right.name));
        } catch (_) {
          return [];
        }
      };
      const identity = (value) => {
        if (!value) return null;
        return {
          implementation: safeCall(value, "getImplementationName"),
          services: services(value),
        };
      };
      const primitiveValue = (value) => {
        if (
          value === null ||
          ["string", "number", "boolean"].includes(typeof value)
        )
          return value;
        return String(value);
      };
      const structuredValue = (value, depth = 0) => {
        if (depth > 8) return "[depth-limit]";
        if (
          value === null ||
          ["string", "number", "boolean", "undefined"].includes(typeof value)
        )
          return value ?? null;
        if (Array.isArray(value))
          return value
            .slice(0, 200)
            .map((entry) => structuredValue(entry, depth + 1));
        if (typeof value === "object") {
          if (Object.hasOwn(value, "Name") && Object.hasOwn(value, "Value"))
            return {
              name: String(value.Name),
              value: structuredValue(value.Value, depth + 1),
            };
          const keys = Object.keys(value).slice(0, 50);
          if (keys.length)
            return Object.fromEntries(
              keys.map((key) => [key, structuredValue(value[key], depth + 1)]),
            );
        }
        return String(value);
      };
      const selectedProperties = (value, pattern) =>
        Object.fromEntries(
          properties(value, pattern).map((property) => [
            property.name,
            primitiveValue(safeProperty(value, property.name)),
          ]),
        );
      const animationTree = (root) => {
        if (!root) return null;
        let total = 0;
        const visit = (node, depth) => {
          if (!node || total++ >= 200 || depth > 12) return null;
          const children = [];
          try {
            const enumeration = node.createEnumeration();
            while (enumeration.hasMoreElements() && children.length < 50)
              children.push(enumeration.nextElement());
          } catch (_) {
            const count = Number(safeCall(node, "getCount", [], 0));
            for (let index = 0; index < Math.min(count, 50); index++)
              children.push(safeCall(node, "getByIndex", [index]));
          }
          return {
            ...identity(node),
            nodeType: primitiveValue(
              safeMember(node, "Type") ?? safeCall(node, "getType"),
            ),
            timing: {
              begin: structuredValue(
                safeMember(node, "Begin") ?? safeCall(node, "getBegin"),
              ),
              duration: structuredValue(
                safeMember(node, "Duration") ?? safeCall(node, "getDuration"),
              ),
              end: structuredValue(
                safeMember(node, "End") ?? safeCall(node, "getEnd"),
              ),
              fill: primitiveValue(
                safeMember(node, "Fill") ?? safeCall(node, "getFill"),
              ),
              restart: primitiveValue(
                safeMember(node, "Restart") ?? safeCall(node, "getRestart"),
              ),
            },
            userData: structuredValue(
              safeMember(node, "UserData") ?? safeCall(node, "getUserData"),
            ),
            target: structuredValue(
              safeMember(node, "Target") ?? safeCall(node, "getTarget"),
            ),
            attributeName:
              safeMember(node, "AttributeName") ??
              safeCall(node, "getAttributeName"),
            values: {
              from: structuredValue(
                safeMember(node, "From") ?? safeCall(node, "getFrom"),
              ),
              to: structuredValue(
                safeMember(node, "To") ?? safeCall(node, "getTo"),
              ),
              by: structuredValue(
                safeMember(node, "By") ?? safeCall(node, "getBy"),
              ),
              keyValues: structuredValue(
                safeMember(node, "Values") ?? safeCall(node, "getValues"),
              ),
              transition: primitiveValue(
                safeMember(node, "Transition") ??
                  safeCall(node, "getTransition"),
              ),
              subtype: primitiveValue(
                safeMember(node, "Subtype") ?? safeCall(node, "getSubtype"),
              ),
              mode: primitiveValue(
                safeMember(node, "Mode") ?? safeCall(node, "getMode"),
              ),
              direction: primitiveValue(
                safeMember(node, "Direction") ?? safeCall(node, "getDirection"),
              ),
            },
            properties: selectedProperties(
              node,
              /^(Begin|Duration|End|Fill|Restart|Acceleration|Decelerate|AutoReverse|RepeatCount|RepeatDuration|Target|SubItem|AttributeName|To|From|By|Values|Formula|CalcMode|Additive|Accumulate|Source|Volume)$/,
            ),
            childCount: children.length,
            children: children
              .map((child) => visit(child, depth + 1))
              .filter(Boolean),
          };
        };
        return visit(root, 0);
      };
      const chartSummary = (embeddedModel) => {
        if (!embeddedModel) return null;
        const diagram = safeCall(embeddedModel, "getFirstDiagram");
        if (!diagram) return null;
        const dataProvider = safeCall(embeddedModel, "getDataProvider");
        const categories = safeCall(diagram, "getCategories");
        const coordinateSystems = safeCall(
          diagram,
          "getCoordinateSystems",
          [],
          [],
        );
        return {
          document: identity(embeddedModel),
          diagram: identity(diagram),
          dataProvider: dataProvider
            ? {
                ...identity(dataProvider),
                data: structuredValue(safeCall(dataProvider, "getData")),
                rowDescriptions: structuredValue(
                  safeCall(dataProvider, "getRowDescriptions"),
                ),
                columnDescriptions: structuredValue(
                  safeCall(dataProvider, "getColumnDescriptions"),
                ),
              }
            : null,
          categories: categories
            ? {
                ...identity(categories),
                values: (() => {
                  const values = safeCall(categories, "getValues");
                  return values
                    ? {
                        role:
                          safeProperty(values, "Role") ??
                          safeMember(values, "Role"),
                        sourceRange: safeCall(
                          values,
                          "getSourceRangeRepresentation",
                        ),
                        data: structuredValue(safeCall(values, "getData")),
                      }
                    : null;
                })(),
              }
            : null,
          coordinateSystems: coordinateSystems.map((coordinateSystem) => {
            const chartTypes = safeCall(
              coordinateSystem,
              "getChartTypes",
              [],
              [],
            );
            return {
              ...identity(coordinateSystem),
              chartTypes: chartTypes.map((chartType) => {
                const series = safeCall(chartType, "getDataSeries", [], []);
                return {
                  ...identity(chartType),
                  chartType: safeCall(chartType, "getChartType"),
                  seriesCount: series.length,
                  series: series.map((item) => {
                    const sequences = safeCall(
                      item,
                      "getDataSequences",
                      [],
                      [],
                    );
                    return {
                      ...identity(item),
                      sequenceCount: sequences.length,
                      sequences: sequences.map((labeled) => {
                        const values = safeCall(labeled, "getValues");
                        const label = safeCall(labeled, "getLabel");
                        const sequenceDetails = (sequence) =>
                          sequence
                            ? {
                                ...identity(sequence),
                                role:
                                  safeProperty(sequence, "Role") ??
                                  safeMember(sequence, "Role"),
                                sourceRange: safeCall(
                                  sequence,
                                  "getSourceRangeRepresentation",
                                ),
                                data: structuredValue(
                                  safeCall(sequence, "getData"),
                                ),
                              }
                            : null;
                        return {
                          ...identity(labeled),
                          values: sequenceDetails(values),
                          label: sequenceDetails(label),
                        };
                      }),
                    };
                  }),
                };
              }),
            };
          }),
        };
      };
      const shapeSummary = (shape, shapeIndex) => {
        const embeddedModel = safeProperty(shape, "Model");
        const childCount = Number(safeCall(shape, "getCount", [], 0));
        return {
          shapeIndex,
          shapeType: safeCall(shape, "getShapeType"),
          name: safeCall(shape, "getName", [], ""),
          reference: String(shape),
          ...identity(shape),
          complexProperties: selectedProperties(
            shape,
            /(Model|Graphic|Media|URL|Stream|Link|Persist|Diagram|Chart|Table|Animation|Presentation|Placeholder|Master|Theme|Style|Interop|Custom)/i,
          ),
          embeddedModel: identity(embeddedModel),
          chart: chartSummary(embeddedModel),
          childCount,
          children: Array.from({ length: childCount }, (_, index) =>
            shapeSummary(shape.getByIndex(index), index),
          ),
        };
      };
      const slideSummaries = [];
      for (let slideIndex = 0; slideIndex < pages.getCount(); slideIndex++) {
        const slide = pages.getByIndex(slideIndex);
        const master = safeCall(slide, "getMasterPage");
        slideSummaries.push({
          slideIndex,
          name: safeCall(slide, "getName", [], ""),
          master: master
            ? { name: safeCall(master, "getName", [], ""), ...identity(master) }
            : null,
          properties: selectedProperties(
            slide,
            /(Animation|Transition|Master|Theme|Layout|Background|Visible|Display|Name|Navigation|Number)/i,
          ),
          animation: animationTree(safeCall(slide, "getAnimationNode")),
          shapes: Array.from({ length: slide.getCount() }, (_, index) =>
            shapeSummary(slide.getByIndex(index), index),
          ),
        });
      }
      const masterPages = safeCall(model, "getMasterPages");
      return {
        model: identity(model),
        masterPages: masterPages
          ? Array.from({ length: masterPages.getCount() }, (_, index) => {
              const master = masterPages.getByIndex(index);
              return {
                masterIndex: index,
                name: safeCall(master, "getName", [], ""),
                ...identity(master),
                properties: selectedProperties(
                  master,
                  /(Theme|Layout|Background|Visible|Display|Name|Number)/i,
                ),
                themeRepresentation: structuredValue(
                  safeProperty(master, "ThemeUnoRepresentation"),
                ),
                shapeCount: master.getCount(),
              };
            })
          : [],
        slides: slideSummaries,
      };
    }),
  );
  const report = `${JSON.stringify(result, null, 2)}\n`;
  if (reportPath) writeFileSync(reportPath, report, { flag: "wx" });
  process.stdout.write(report);
} finally {
  await browser.close();
}

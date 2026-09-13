import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { upstreamManifest } from "./upstream.mjs";

const args = process.argv.slice(2);
const sourceIndex = args.indexOf("--source");
const source = sourceIndex >= 0 ? args[sourceIndex + 1] : null;
if (!source)
  throw new Error(
    "Usage: node audit-ai-command-surface.mjs --source COLLABORA_SOURCE",
  );

const roots = [
  path.join(source, "engine/sd/uiconfig/simpress"),
  path.join(source, "browser/src/control/Control.NotebookbarImpress.js"),
];
for (const root of roots)
  if (!statSync(root, { throwIfNoEntry: false }))
    throw new Error(`Missing Collabora command source: ${root}`);

const files = [];
const visit = (candidate) => {
  const stat = statSync(candidate);
  if (stat.isDirectory()) {
    for (const name of readdirSync(candidate).sort())
      visit(path.join(candidate, name));
    return;
  }
  if (/\.(?:js|ui|xml)$/.test(candidate)) files.push(candidate);
};
for (const root of roots) visit(root);

const origins = new Map();
for (const file of files) {
  const relative = path.relative(source, file);
  for (const match of readFileSync(file, "utf8").matchAll(
    /\.uno:[A-Za-z0-9_]+/g,
  )) {
    const command = match[0];
    const commandOrigins = origins.get(command) ?? new Set();
    commandOrigins.add(relative);
    origins.set(command, commandOrigins);
  }
}

const exact = (category, commands, rationale) => ({
  category,
  commands: new Set(commands.map((command) => `.uno:${command}`)),
  rationale,
});
const exactRules = [
  exact(
    "platform_owned",
    [
      "AddDirect",
      "Open",
      "OpenRemote",
      "RecentFileList",
      "CloseDoc",
      "OpenTemplate",
      "SaveAsTemplate",
      "NewDoc",
      "Reload",
      "VersionDialog",
      "Save",
      "SaveAs",
      "SaveAsRemote",
      "SaveACopy",
      "SaveAll",
      "CheckOut",
      "CancelCheckOut",
      "CheckIn",
      "ExportTo",
      "ExportToPDF",
      "ExportDirectToPDF",
      "SendMail",
      "SendMailDocAsPDF",
      "WebHtml",
      "Print",
      "PrinterSetup",
      "SetDocumentProperties",
      "SignaturesMenu",
      "Signature",
      "SignPDF",
      "Quit",
    ],
    "The product owns document identity, immutable originals, save candidates, validation, export and delivery.",
  ),
  exact(
    "security_excluded",
    [
      "BasicIDEAppear",
      "MacroDialog",
      "RunMacro",
      "ScriptOrganizer",
      "AddressBookSource",
      "TwainSelect",
      "TwainTransfer",
      "ExternalEdit",
      "ManageLinks",
    ],
    "Document AI must not gain macro, arbitrary external process, device or network authority.",
  ),
  exact(
    "human_editor_state",
    [
      "Undo",
      "Redo",
      "Cut",
      "Copy",
      "Paste",
      "PasteSpecial",
      "PasteUnformatted",
      "CopyObjects",
      "SelectAll",
      "SearchDialog",
      "EditDoc",
      "NormalMultiPaneGUI",
      "OutlineMode",
      "NotesMode",
      "DiaMode",
      "SlideMasterPage",
      "NotesMasterPage",
      "HandoutMode",
      "UIPicker",
      "AvailableToolbars",
      "StatusBarVisible",
      "LeftPaneImpress",
      "ToggleTabBarVisibility",
      "BottomPaneImpress",
      "ShowRuler",
      "GridVisible",
      "GridFront",
      "HelplinesMove",
      "HelplinesVisible",
      "HelplinesFront",
      "GridUse",
      "HelplinesUse",
      "SnapFrame",
      "SnapPoints",
      "SnapBorder",
      "ShowAnnotations",
      "OutputQualityColor",
      "OutputQualityGrayscale",
      "OutputQualityBlackWhite",
      "Sidebar",
      "Gallery",
      "Navigator",
      "ZoomPanning",
      "ZoomPage",
      "ZoomPageWidth",
      "ZoomOptimal",
      "Zoom50Percent",
      "Zoom75Percent",
      "Zoom100Percent",
      "Zoom150Percent",
      "Zoom200Percent",
      "ZoomMode",
      "ZoomPrevious",
      "ZoomNext",
      "ZoomObjects",
      "Zoom",
    ],
    "These commands control the human editor session or generic history/clipboard, not a bounded AI document mutation.",
  ),
];

const patternRules = [
  {
    category: "security_excluded",
    // Match dangerous command families at the command-name boundary. A loose
    // substring match misclassified ordinary document commands such as
    // BasicShapes, SubScript, SuperScript and ObjectTitleDescription.
    pattern:
      /^\.uno:(?:BasicIDE|Macro|RunMacro|ScriptOrganizer|AddressBook|Twain|Scanner|ExternalEdit|ManageLinks)/i,
    rationale:
      "Name indicates executable, device or external automation authority.",
  },
  {
    category: "platform_owned",
    pattern:
      /(?:^\.uno:(?:Open|Save|Export|Print|SendMail|Quit|Reload|CheckIn|CheckOut|Sign)|PDF)/,
    rationale:
      "Name indicates a product lifecycle, delivery or signing action.",
  },
  {
    category: "human_editor_state",
    pattern:
      /(?:Zoom|Pane|Sidebar|StatusBar|Ruler|Helpline|Grid|Snap|DisplayQuality|OutputQuality|FullScreen|Navigator|SlideShow|PresentationMode|View$)/i,
    rationale: "Name indicates view, navigation or presentation-session state.",
  },
  {
    category: "interactive_document_ui",
    pattern:
      /(?:Dialog|Dlg|Menu|Toolbox|Floater|Window|Gallery|Panel|Wizard)$/i,
    rationale:
      "Command opens or groups interactive UI; the underlying document capability needs a typed adapter instead.",
  },
];

const commands = [...origins.keys()].sort();
const entries = commands.map((command) => {
  const exactRule = exactRules.find((rule) => rule.commands.has(command));
  if (exactRule)
    return {
      command,
      category: exactRule.category,
      review: "individually_reviewed",
      rationale: exactRule.rationale,
      origins: [...origins.get(command)].sort(),
    };
  const patternRule = patternRules.find((rule) => rule.pattern.test(command));
  if (patternRule)
    return {
      command,
      category: patternRule.category,
      review: "rule_classified_requires_review",
      rationale: patternRule.rationale,
      origins: [...origins.get(command)].sort(),
    };
  return {
    command,
    category: "document_mutation_candidate",
    review: "requires_individual_review",
    rationale:
      "Conservative default: determine target structure, arguments, permission, Undo and save/reopen behavior before exposure.",
    origins: [...origins.get(command)].sort(),
  };
});
const inventory = `${commands.join("\n")}\n`;
const counts = entries.reduce(
  (result, entry) => {
    result.byCategory[entry.category] =
      (result.byCategory[entry.category] ?? 0) + 1;
    result.byReview[entry.review] = (result.byReview[entry.review] ?? 0) + 1;
    return result;
  },
  { byCategory: {}, byReview: {} },
);
const report = {
  source: {
    ref: upstreamManifest.source.ref,
    commit: upstreamManifest.source.commit,
  },
  inventory: {
    count: commands.length,
    sha256: createHash("sha256").update(inventory).digest("hex"),
    expectedCount: upstreamManifest.impressUiUnoCommandCount,
    expectedSha256: upstreamManifest.impressUiUnoCommandsSha256,
    exact:
      commands.length === upstreamManifest.impressUiUnoCommandCount &&
      createHash("sha256").update(inventory).digest("hex") ===
        upstreamManifest.impressUiUnoCommandsSha256,
  },
  counts,
  warning:
    "Rule-classified and requires-review entries are not completed capability decisions. Only individually_reviewed entries have a manual policy decision, and no entry is an AI feature until the typed runtime contract gates pass.",
  entries,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.inventory.exact) process.exitCode = 2;

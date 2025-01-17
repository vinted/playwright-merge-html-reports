"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergeHTMLReports = void 0;
const fs_1 = require("fs");
const promises_1 = require("fs/promises");
const path_1 = __importDefault(require("path"));
const jszip_1 = __importDefault(require("jszip"));
const yazl_1 = __importDefault(require("yazl"));
const Base64Encoder_1 = __importDefault(require("./Base64Encoder"));
const fs = __importStar(require("fs-extra"));
const defaultConfig = {
    outputFolderName: "merged-html-report",
    outputBasePath: process.cwd(),
    overwriteExisting: true,
    debug: false,
};
const re = /<script>\nwindow\.playwrightReportBase64\s=\s"data:application\/zip;base64,(.+)<\/script>/;
async function mergeHTMLReports(inputReportPaths, givenConfig = {}) {
    var _a;
    if (!Array.isArray(inputReportPaths) || inputReportPaths.length < 1) {
        console.log("No Input paths provided");
        process.exit(1);
    }
    const { outputFolderName, outputBasePath, overwriteExisting, debug } = { ...defaultConfig, ...givenConfig };
    const outputPath = path_1.default.resolve(outputBasePath, `./${outputFolderName}`);
    if ((0, fs_1.existsSync)(outputPath)) {
        if (overwriteExisting) {
            if (debug) {
                console.log('Cleaning output directory');
            }
            await (0, promises_1.rm)(outputPath, { recursive: true, force: true });
        }
        else {
            throw new Error(`Report merge aborted. Output directory already exists and overwriteExisting set to false.\n
    path: ${outputPath}\n`);
        }
    }
    else {
        await (0, promises_1.mkdir)(outputPath, { recursive: true });
    }
    let mergedZipContent = new yazl_1.default.ZipFile();
    let aggregateReportJson = null;
    let baseIndexHtml = '';
    const fileReportMap = new Map();
    for (let reportDir of inputReportPaths) {
        console.log(`Processing "${reportDir}"`);
        const indexHTMLContent = await (0, promises_1.readFile)(reportDir + "/index.html", "utf8");
        const [, base64Str] = (_a = re.exec(indexHTMLContent)) !== null && _a !== void 0 ? _a : [];
        if (!base64Str)
            throw new Error('index.html does not contain report data');
        if (!baseIndexHtml) {
            baseIndexHtml = indexHTMLContent.replace(re, '');
        }
        const zipData = Buffer.from(base64Str, "base64").toString("binary");
        const zipFile = await jszip_1.default.loadAsync(zipData);
        const zipDataFiles = [];
        zipFile.forEach((relativePath, file) => {
            zipDataFiles.push({ relativePath, file });
        });
        await Promise.all(zipDataFiles.map(async ({ relativePath, file }) => {
            const fileContentString = await file.async("string");
            if (relativePath !== "report.json") {
                const fileReportJson = JSON.parse(fileContentString);
                if (fileReportMap.has(relativePath)) {
                    if (debug) {
                        console.log('Merging duplicate file report: ' + relativePath);
                    }
                    const existingReport = fileReportMap.get(relativePath);
                    if ((existingReport === null || existingReport === void 0 ? void 0 : existingReport.fileId) !== fileReportJson.fileId)
                        throw new Error('Error: collision with file ids in two file reports');
                    existingReport.tests.push(...fileReportJson.tests);
                }
                else {
                    fileReportMap.set(relativePath, fileReportJson);
                }
            }
            else {
                const currentReportJson = JSON.parse(fileContentString);
                if (debug) {
                    console.log('---------- report.json ----------');
                    console.log(JSON.stringify(currentReportJson, null, 2));
                }
                if (!aggregateReportJson)
                    aggregateReportJson = currentReportJson;
                else {
                    currentReportJson.files.forEach((file) => {
                        const existingGroup = aggregateReportJson === null || aggregateReportJson === void 0 ? void 0 : aggregateReportJson.files.find(({ fileId }) => fileId === file.fileId);
                        if (existingGroup) {
                            existingGroup.tests.push(...file.tests);
                            mergeStats(existingGroup.stats, file.stats);
                        }
                        else {
                            aggregateReportJson === null || aggregateReportJson === void 0 ? void 0 : aggregateReportJson.files.push(file);
                        }
                    });
                    mergeStats(aggregateReportJson.stats, currentReportJson.stats);
                    aggregateReportJson.projectNames = [
                        ...new Set([
                            ...aggregateReportJson.projectNames,
                            ...currentReportJson.projectNames
                        ])
                    ];
                }
            }
        }));
        const contentFolderName = "data";
        const contentFolderPath = path_1.default.join(reportDir, contentFolderName);
        const contentOuputPath = path_1.default.join(outputPath, contentFolderName);
        if ((0, fs_1.existsSync)(contentFolderPath)) {
            await copyDir(contentFolderPath, contentOuputPath, debug);
        }
        const traceFolderName = "trace";
        const traceFolderPath = path_1.default.join(reportDir, traceFolderName);
        const traceOuputPath = path_1.default.join(outputPath, traceFolderName);
        if ((0, fs_1.existsSync)(traceFolderPath) && !(0, fs_1.existsSync)(traceOuputPath)) {
            copyTraceDir(contentFolderPath, contentOuputPath);
        }
        if (debug) {
            console.log({
                reportDir
            });
        }
    }
    if (!baseIndexHtml)
        throw new Error('Base report index.html not found');
    fileReportMap.forEach((fileReport, relativePath) => {
        mergedZipContent.addBuffer(Buffer.from(JSON.stringify(fileReport)), relativePath);
    });
    mergedZipContent.addBuffer(Buffer.from(JSON.stringify(aggregateReportJson)), "report.json");
    if (debug) {
        console.log('---------- aggregateReportJson ----------');
        console.log(JSON.stringify(aggregateReportJson, null, 2));
    }
    const indexFilePath = path_1.default.join(outputPath, "index.html");
    await (0, promises_1.writeFile)(indexFilePath, baseIndexHtml + `<script>
window.playwrightReportBase64 = "data:application/zip;base64,`);
    await new Promise((f) => {
        mergedZipContent.end(undefined, () => {
            mergedZipContent.outputStream
                .pipe(new Base64Encoder_1.default())
                .pipe((0, fs_1.createWriteStream)(indexFilePath, { flags: "a" }))
                .on("close", f);
        });
    });
    await (0, promises_1.appendFile)(indexFilePath, '";</script>');
    console.log(`Successfully merged ${inputReportPaths.length} report${inputReportPaths.length === 1 ? '' : 's'}`);
}
exports.mergeHTMLReports = mergeHTMLReports;
function mergeStats(base, added) {
    base.total += added.total;
    base.expected += added.expected;
    base.unexpected += added.unexpected;
    base.flaky += added.flaky;
    base.skipped += added.skipped;
    base.duration += added.duration;
    base.ok = base.ok && added.ok;
}
async function copyDir(srcDirPath, srcDirOutputPath, debug) {
    await (0, promises_1.mkdir)(srcDirOutputPath, { recursive: true });
    const traceFiles = await (0, promises_1.readdir)(srcDirPath);
    await Promise.all(traceFiles.map(async (fileName) => {
        const srcPath = path_1.default.resolve(process.cwd(), path_1.default.join(srcDirPath, fileName));
        const destPath = path_1.default.join(srcDirOutputPath, fileName);
        if (debug) {
            console.log({
                srcPath,
                destPath
            });
        }
        await (0, promises_1.copyFile)(srcPath, destPath);
        if (debug) {
            console.log(fileName);
        }
    }));
}
async function copyTraceDir(srcDirPath, srcDirOutputPath) {
    await fs.copy(srcDirPath, srcDirOutputPath);
}
//# sourceMappingURL=merge-reports.js.map
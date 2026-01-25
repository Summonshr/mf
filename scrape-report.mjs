import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import https from "node:https";

const keyMap = {
    activeStatus: "actSts", addedDate: "addDt", agenda: "agnd", agm: "agm", agmDate: "agmDt",
    agmNo: "agmNo", agmNotice: "agmNtc", agmType: "agmTyp", application: "app",
    applicationStatus: "appSts", applicationType: "appTyp", asOf: "asOf",
    baseYearMarketCapitalization: "baseYrMktCap", bonusShare: "bonus", bookCloseDate: "bkClsDt",
    bookCloseNotice: "bkClsNtc", capitalGainBaseDate: "capGainDt", capitalRangeMin: "capMin",
    cashDividend: "divCash", cdsStockRefId: "cdsRef", change: "chg", close: "cls",
    closingPrice: "clsPrc", code: "code", companies: "comp", companyContactPerson: "contact",
    companyEmail: "email", companyId: "compId", companyName: "compNm", companyNews: "news",
    companyRegistrationNumber: "regNo", companyShortName: "shortNm", companyWebsite: "web",
    currentValue: "curVal", data: "d", description: "desc", detail: "dtl", divisor: "div",
    documentType: "docTyp", epsValue: "eps", expiryDate: "expDt", faceValue: "faceVal",
    fiftyTwoWeekHigh: "w52Hi", fiftyTwoWeekLow: "w52Lo", filePath: "file",
    financialYear: "fy", fromYear: "fromYr", fyName: "fyNm", fyNameNepali: "fyNmNp",
    high: "hi", id: "id", index: "idx", indexCode: "idxCd", indexName: "idxNm",
    instrumentType: "instTyp", isDefault: "isDef", isOpen: "isOpen", isPromoter: "isProm",
    isin: "isin", keyIndexFlag: "keyIdx", lastTradedPrice: "ltp", listingDate: "listDt",
    low: "lo", marketStatus: "mktSts", marketSummary: "mktSum", meInstanceNumber: "meInst",
    modifiedDate: "modDt", name: "nm", nepseIndex: "npsIdx", netWorthPerShare: "nwps",
    networthBasePrice: "nwBase", newsBody: "body", newsHeadline: "headline",
    newsSource: "src", newsType: "newsTyp", paidUpCapital: "paidUp", peValue: "pe",
    percentageChange: "pctChg", perChange: "perChg", permittedToTrade: "canTrade",
    pointChange: "ptChg", previousClose: "prevCls", profitAmount: "profit",
    publishToWebsite: "pubWeb", quarterMaster: "qtr", quarterName: "qtrNm",
    recordType: "recTyp", regulatoryBody: "regBody", report: "rpt", reportName: "rptNm",
    reportTypeMaster: "rptTyp", rightBookCloseDate: "rtBkClsDt", rightShare: "rtShare",
    sectorDescription: "secDesc", sectorMaster: "sector", sectorName: "secNm",
    security: "sec", securityId: "secId", securityName: "secNm", securityTradeCycle: "tradeCyc",
    shareGroupId: "shrGrp", shareTraded: "shrTrd", status: "sts", subIndices: "subIdx",
    subIndicesData: "subIdxData", submittedDate: "subDt", symbol: "sym", tickSize: "tick",
    toYear: "toYr", topGainers: "gainers", topLosers: "losers", topTransactions: "txns",
    topTurnover: "turnover", topVolume: "volume", totalTrades: "totTrd",
    tradingStartDate: "trdStartDt", turnover: "to", updatedAt: "updAt", value: "val",
    venue: "venue", versionId: "ver", website: "web", fiscalReport: "fiscal",
};

const BASE_URL = "https://nepalstock.com";
const API_BASE = `${BASE_URL}/api`;
const WASM_URL = `${BASE_URL}/assets/prod/css.wasm`;
const COMPANIES_PATH = "public/nepse-market.json";
const DEFAULT_OUT_DIR = "public/report";
const CONCURRENCY = Math.max(1, Number(process.env.SCRAPE_CONCURRENCY ?? "5"));

const args = process.argv.slice(2);
let outDir = DEFAULT_OUT_DIR;

for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--out-dir") {
        outDir = args[i + 1];
        i += 1;
    } else if (arg === "--help" || arg === "-h") {
        printUsageAndExit(0);
    } else {
        printUsageAndExit(1);
    }
}

const wasmBuffer = await fetchBuffer(WASM_URL);
const wasm = await WebAssembly.instantiate(wasmBuffer, {
    imports: { imported_func: () => { } },
});
let headers = await buildAuthHeaders();
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 500;

const companiesContent = await readFile(resolve(COMPANIES_PATH), "utf8");
const companiesData = JSON.parse(companiesContent);
const companies = companiesData.comp?.d || [];

console.log(`Found ${companies.length} companies to process`);

const resolvedOutDir = resolve(outDir);
await mkdir(resolvedOutDir, { recursive: true });

await mapWithConcurrency(companies, CONCURRENCY, async (company) => {
    const companyId = company.id;
    const symbol = company.sym;

    const endpoints = {
        report: { path: `/nots/application/reports/${companyId}`, method: "GET" },
        dividend: { path: `/nots/application/dividend/${companyId}`, method: "GET" },
    };

    const resultsEntries = await Promise.all(
        Object.entries(endpoints).map(async ([key, endpoint]) => {
            const response = await fetchJsonWithRetry(
                `${API_BASE}${endpoint.path}`,
                {
                    method: endpoint.method,
                    body: endpoint.body,
                    headers: endpoint.headers,
                },
            );
            return [key, response];
        }),
    );
    const results = Object.fromEntries(resultsEntries);

    const reportData = cleanData(results.report);
    const dividendData = cleanData(results.dividend);
    const securityData = cleanData(results.security);
    const dividendItems = extractDividendItems(dividendData);

    let reportItems = reportData?.d;
    if (reportItems?.map) {
        reportItems = reportItems.map((item) => item.fiscal).filter(Boolean);
    }

    const hasReport = Boolean(reportItems?.length);
    const hasDividend = Boolean(dividendItems?.length);

    if (!hasReport && !hasDividend) {
        return;
    }

    const output = {
        updAt: dateOnly(new Date().toISOString()),
        id: companyId,
        sym: symbol,
    };
    if (hasReport) {
        output.rpt = reportItems;
    }
    if (hasDividend) {
        output.div = dividendItems;
    }
    if (securityData?.d || securityData) {
        output.sec = securityData?.d ?? securityData;
    }

    const safeSymbol = symbol.replace(/\//g, "-");
    const filePath = resolve(resolvedOutDir, `${safeSymbol}.json`);
    await writeFile(filePath, JSON.stringify(output, null, 2) + "\n", "utf8");
    console.log(`Saved ${filePath}`);
});

console.log(`Done. Saved ${companies.length} files to ${resolvedOutDir}`);

function printUsageAndExit(code) {
    console.log(
        [
            "Usage: node scrape-report.mjs [options]",
            "",
            "Options:",
            `  --out-dir  Output directory for JSON files (default: ${DEFAULT_OUT_DIR})`,
        ].join("\n"),
    );
    process.exit(code);
}

function cleanData(data) {
    if (data === null || data === "") {
        return undefined;
    }

    if (typeof data !== "object") {
        return data;
    }

    if (Array.isArray(data)) {
        return data.map((item) => cleanData(item)).filter((item) => item !== undefined);
    }

    const ignoreKeys = [
        "modifiedBy", "applicationDocumentDetailsList", "modifiedDate",
        "activeStatus", "versionId", "isDefault",
    ];
    const cleaned = {};
    for (const [key, value] of Object.entries(data)) {
        if (ignoreKeys.includes(key)) {
            continue;
        }
        const cleanedValue = cleanData(value);
        if (cleanedValue !== undefined) {
            cleaned[keyMap[key] || key] = cleanedValue;
        }
    }
    return cleaned;
}

function extractDividendItems(dividendData) {
    if (!dividendData?.d || !Array.isArray(dividendData.d)) {
        return [];
    }

    return dividendData.d
        .map((item) => {
            const news = item?.news ?? {};
            const notice = news?.dividendsNotice ?? item?.dividendsNotice ?? {};
            const record = {
                divCash: roundToTwoDecimals(notice?.divCash),
                bonus: roundToTwoDecimals(notice?.bonus),
                rtShare: roundToTwoDecimals(notice?.rtShare),
                bkClsDt: notice?.bkClsDt ?? notice?.bkClsNtc,
                expDt: news?.expDt ?? item?.expDt,
                addDt: dateOnly(news?.addDt ?? item?.addDt),
                announcementDate: dateOnly(
                    news?.modDt ?? item?.modDt ?? news?.modifiedDate ?? item?.modifiedDate,
                ),
                fy: resolveFinancialYear(item, notice, news),
            };

            const hasValue = Object.values(record).some((value) => value !== undefined);
            return hasValue ? record : undefined;
        })
        .filter(Boolean);
}

function dateOnly(value) {
    if (!value || typeof value !== "string") {
        return value;
    }
    return value.split("T")[0];
}

function roundToTwoDecimals(value) {
    if (typeof value !== "number") {
        return value;
    }
    return Number(value.toFixed(2));
}

function resolveFinancialYear(item, notice, news) {
    const sources = [notice, item, news];
    for (const source of sources) {
        if (!source || typeof source !== "object") {
            continue;
        }
        const direct = source.fy ?? source.fiscal;
        if (direct !== undefined) {
            const normalized = normalizeFinancialYear(direct);
            if (normalized !== undefined) {
                return normalized;
            }
        }
        const normalized = normalizeFinancialYear(source);
        if (normalized !== undefined) {
            return normalized;
        }
    }
    return undefined;
}

function normalizeFinancialYear(value) {
    if (!value) {
        return undefined;
    }
    if (typeof value === "string" || typeof value === "number") {
        return value;
    }
    if (typeof value !== "object") {
        return undefined;
    }
    if (value.fyNmNp) {
        return value.fyNmNp;
    }
    if (value.fyNm) {
        return value.fyNm;
    }
    if (value.nm) {
        return value.nm;
    }
    const from = value.fromYr ?? value.fromYear;
    const to = value.toYr ?? value.toYear;
    if (from || to) {
        return [from, to].filter(Boolean).join("/");
    }
    return undefined;
}

function fetchBuffer(url) {
    return new Promise((resolve, reject) => {
        const req = https.request(url, { rejectUnauthorized: false }, (res) => {
            const chunks = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () => resolve(Buffer.concat(chunks)));
        });
        req.on("error", reject);
        req.end();
    });
}

function fetchJson(url, headers = {}, options = {}) {
    return new Promise((resolve, reject) => {
        const method = options.method ?? "GET";
        let body;
        if (options.body !== undefined) {
            if (typeof options.body === "string" || Buffer.isBuffer(options.body)) {
                body = options.body;
            } else {
                body = JSON.stringify(options.body);
            }
        }
        const reqHeaders = { ...headers, ...(options.headers || {}) };
        if (body !== undefined) {
            if (!reqHeaders["Content-Type"] && !reqHeaders["content-type"]) {
                reqHeaders["Content-Type"] = "application/json";
            }
            reqHeaders["Content-Length"] = Buffer.byteLength(body);
        }
        const req = https.request(
            url,
            { headers: reqHeaders, method, rejectUnauthorized: false },
            (res) => {
                let data = "";
                res.on("data", (chunk) => {
                    data += chunk;
                });
                res.on("end", () => {
                    try {
                        resolve({ status: res.statusCode, data: JSON.parse(data) });
                    } catch {
                        resolve({ status: res.statusCode, data });
                    }
                });
            },
        );
        req.on("error", reject);
        if (body !== undefined) {
            req.write(body);
        }
        req.end();
    });
}

async function buildAuthHeaders() {
    const prove = await fetchJson(`${API_BASE}/authenticate/prove`);
    const proveData = prove.data ?? {};
    if (!proveData.accessToken) {
        const status = prove?.status ?? "unknown";
        const detail = typeof proveData === "string" ? proveData : JSON.stringify(proveData);
        throw new Error(`Failed to fetch access token from Nepalstock. status=${status} detail=${detail}`);
    }

    const token = cleanToken(
        proveData.accessToken,
        proveData,
        wasm.instance.exports,
    );

    return {
        Authorization: `Salter ${token}`,
        Accept: "application/json, text/plain, */*",
    };
}

function shouldRetry(response) {
    if (!response) {
        return true;
    }
    if (typeof response.status === "number" && response.status >= 400) {
        return true;
    }
    const data = response.data;
    if (!data || typeof data !== "object") {
        return false;
    }
    return (
        data.status === "error" ||
        data.status === "ERROR" ||
        Boolean(data.error)
    );
}

async function fetchJsonWithRetry(url, options = {}) {
    let lastError;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
        try {
            const response = await fetchJson(url, headers, options);
            if (response?.status === 401 || response?.status === 403) {
                headers = await buildAuthHeaders();
                lastError = new Error(`auth_failed status=${response.status}`);
            } else if (!shouldRetry(response)) {
                return response;
            } else {
                lastError = new Error(
                    `request_failed status=${response?.status ?? "unknown"} body=${summarizeResponseBody(response?.data)}`,
                );
            }
        } catch (error) {
            lastError = error;
        }
        if (attempt < MAX_RETRIES) {
            await sleep(RETRY_DELAY_MS * attempt);
        }
    }
    console.log(`Error for ${url}: ${formatError(lastError)}`);
    return undefined;
}

function cleanToken(token, salts, exports) {
    const { salt1, salt2, salt3, salt4, salt5 } = salts;
    const cdx = exports.cdx(salt1, salt2, salt3, salt4, salt5);
    const rdx = exports.rdx(salt1, salt2, salt4, salt3, salt5);
    const bdx = exports.bdx(salt1, salt2, salt4, salt3, salt5);
    const ndx = exports.ndx(salt1, salt2, salt4, salt3, salt5);
    const mdx = exports.mdx(salt1, salt2, salt4, salt3, salt5);

    return (
        token.slice(0, cdx) +
        token.slice(cdx + 1, rdx) +
        token.slice(rdx + 1, bdx) +
        token.slice(bdx + 1, ndx) +
        token.slice(ndx + 1, mdx) +
        token.slice(mdx + 1)
    );
}

function summarizeResponseBody(data) {
    if (data === undefined) {
        return "undefined";
    }
    if (typeof data === "string") {
        return data.slice(0, 200);
    }
    try {
        return JSON.stringify(data).slice(0, 200);
    } catch {
        return "unserializable";
    }
}

function formatError(error) {
    if (!error) {
        return "unknown error";
    }
    if (typeof error === "string") {
        return error;
    }
    if (error instanceof Error) {
        return `${error.message}${error.cause ? ` cause=${error.cause}` : ""}`;
    }
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapWithConcurrency(items, limit, mapper) {
    if (limit <= 1) {
        for (const item of items) {
            await mapper(item);
        }
        return;
    }

    let index = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (true) {
            const current = index;
            index += 1;
            if (current >= items.length) {
                break;
            }
            await mapper(items[current]);
        }
    });
    await Promise.all(workers);
}

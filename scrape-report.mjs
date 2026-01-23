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

const prove = await fetchJson(`${API_BASE}/authenticate/prove`);
const proveData = prove.data ?? {};
if (!proveData.accessToken) {
	throw new Error("Failed to fetch access token from Nepalstock.");
}

const wasmBuffer = await fetchBuffer(WASM_URL);
const wasm = await WebAssembly.instantiate(wasmBuffer, {
	imports: { imported_func: () => {} },
});
const token = cleanToken(
	proveData.accessToken,
	proveData,
	wasm.instance.exports,
);
const headers = {
	Authorization: `Salter ${token}`,
	Accept: "application/json, text/plain, */*",
};

const companiesContent = await readFile(resolve(COMPANIES_PATH), "utf8");
const companiesData = JSON.parse(companiesContent);
const companies = companiesData.comp?.d || [];

console.log(`Found ${companies.length} companies to process`);

const resolvedOutDir = resolve(outDir);
await mkdir(resolvedOutDir, { recursive: true });

for (const company of companies) {
	const companyId = company.id;
	const symbol = company.sym;

	const endpoints = {
		report: `/nots/application/reports/${companyId}`,
	};

	const results = {};
	for (const [key, path] of Object.entries(endpoints)) {
		results[key] = await fetchJson(`${API_BASE}${path}`, headers);
	}

	const reportData = cleanData(results.report);
	if (reportData?.d && reportData?.d?.map) {
		reportData.d = reportData.d.map((item) => item.fiscal).filter(Boolean);
	}

	const output = {
		updAt: new Date().toISOString(),
		id: companyId,
		sym: symbol,
		rpt: reportData,
	};

	const safeSymbol = symbol.replace(/\//g, "-");
	const filePath = resolve(resolvedOutDir, `${safeSymbol}.json`);
	await writeFile(filePath, JSON.stringify(output, null, 2) + "\n", "utf8");
	console.log(`Saved ${filePath}`);
}

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

function fetchJson(url, headers = {}) {
	return new Promise((resolve, reject) => {
		const req = https.request(
			url,
			{ headers, rejectUnauthorized: false },
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
		req.end();
	});
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

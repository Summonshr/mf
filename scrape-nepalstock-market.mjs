import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
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
const DEFAULT_OUT = "public/nepse-market.json";

const args = process.argv.slice(2);
let outPath = DEFAULT_OUT;

for (let i = 0; i < args.length; i += 1) {
	const arg = args[i];
	if (arg === "--out") {
		outPath = args[i + 1];
		i += 1;
	} else if (arg === "--help" || arg === "-h") {
		printUsageAndExit(0);
	} else {
		printUsageAndExit(1);
	}
}

const endpoints = {
	nepseIndex: "/nots/nepse-index",
	subIndices: "/nots/index",
	subIndicesData: "/nots",
	marketSummary: "/nots/market-summary",
	list: "/nots/company/list",
	marketStatus: "/nots/nepse-data/market-open",
	topGainers: "/nots/top-ten/top-gainer?all=true",
	topLosers: "/nots/top-ten/top-loser?all=true",
	topTurnover: "/nots/top-ten/turnover?all=true",
	topVolume: "/nots/top-ten/trade?all=true",
	topTransactions: "/nots/top-ten/transaction?all=true",
};

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

const results = {};
for (const [key, path] of Object.entries(endpoints)) {
	results[key] = await fetchJson(`${API_BASE}${path}`, headers);
}

const companiesData = cleanData(results.list);
if (companiesData?.d) {
	companiesData.d = companiesData.d.filter((c) => c.sts === "A");
}

const output = {
	updAt: new Date().toISOString(),
	npsIdx: cleanData(results.nepseIndex),
	subIdx: cleanData(results.subIndices),
	subIdxData: cleanData(results.subIndicesData),
	mktSum: cleanData(results.marketSummary),
	comp: companiesData,
	mktSts: cleanData(results.marketStatus),
	gainers: limitToTen(cleanData(results.topGainers)),
	losers: limitToTen(cleanData(results.topLosers)),
	turnover: limitToTen(cleanData(results.topTurnover)),
	volume: limitToTen(cleanData(results.topVolume)),
	txns: cleanData(results.topTransactions),
};

const resolvedOut = resolve(outPath);
await mkdir(dirname(resolvedOut), { recursive: true });
await writeFile(resolvedOut, JSON.stringify(output, null, 2) + "\n", "utf8");
console.log(`Saved ${resolvedOut}`);

function printUsageAndExit(code) {
	console.log(
		[
			"Usage: node scrape-nepalstock-market.mjs [options]",
			"",
			"Options:",
			`  --out  Output path for JSON file (default: ${DEFAULT_OUT})`,
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
		"modifiedBy", "modifiedDate", "activeStatus", "reportTypeMaster",
		"versionId", "isDefault",
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

function limitToTen(data) {
	if (!data) {
		return data;
	}

	if (Array.isArray(data)) {
		return data.slice(0, 10);
	}

	if (Array.isArray(data.d)) {
		return { ...data, d: data.d.slice(0, 10) };
	}

	return data;
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

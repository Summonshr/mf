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
const MF_BASE_URL = "https://www.sharesansar.com/mutual-fund-navs";
const CHUKUL_BONUS_URL = "https://chukul.com/api/bonus";
const MF_PAGE_LENGTH = 50;
const CONCURRENCY = Math.max(1, Number(process.env.SCRAPE_CONCURRENCY ?? "5"));
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 500;

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

const resultsEntries = await Promise.all(
	Object.entries(endpoints).map(async ([key, path]) => {
		const response = await fetchJson(`${API_BASE}${path}`, headers);
		return [key, response];
	}),
);
const results = Object.fromEntries(resultsEntries);
const mutualFundNavs = await fetchMutualFundNavs();

const companiesData = cleanData(results.list);
if (companiesData?.d) {
	companiesData.d = companiesData.d.filter((c) => c.sts === "A");
}

// Fetch reports and dividends for each company
console.log(`Fetching reports for ${companiesData.d?.length || 0} companies...`);
if (companiesData?.d?.length) {
	await mapWithConcurrency(companiesData.d, CONCURRENCY, async (company) => {
		const companyId = company.id;

		try {
			const [reportResponse, dividendResponse] = await Promise.all([
				fetchJsonWithRetry(`${API_BASE}/nots/application/reports/${companyId}`, headers),
				fetchJsonWithRetry(`${API_BASE}/nots/application/dividend/${companyId}`, headers),
			]);

			const reportData = cleanData(reportResponse);
			const dividendData = cleanData(dividendResponse);

			// Extract report items
			let reportItems = reportData?.d;
			if (reportItems?.map) {
				reportItems = reportItems.map((item) => item.fiscal).filter(Boolean);
			}

			// Extract dividend items
			const dividendItems = extractDividendItems(dividendData);

			// Add to company object
			if (reportItems?.length) {
				company.rpt = reportItems;
			}
			if (dividendItems?.length) {
				company.div = dividendItems;
			}

			console.log(`Fetched reports for ${company.sym}`);
		} catch (error) {
			console.log(`Error fetching reports for ${company.sym}: ${formatError(error)}`);
		}
	});
	console.log(`Completed fetching reports for all companies`);
}

// Fetch dividend data for mutual funds from chukul.com
const mfSymbols = new Set([
	...(mutualFundNavs?.funds?.closed?.data ?? []),
	...(mutualFundNavs?.funds?.opened?.data ?? []),
].map((f) => f.symbol).filter(Boolean));
const mfCompanies = (companiesData?.d ?? []).filter((c) => mfSymbols.has(c.sym));
console.log(`Fetching dividends for ${mfCompanies.length} mutual funds...`);
if (mfCompanies.length) {
	await mapWithConcurrency(mfCompanies, CONCURRENCY, async (company) => {
		try {
			const res = await fetchJsonWithRetry(`${CHUKUL_BONUS_URL}/?symbol=${company.sym}`);
			const items = res?.data;
			if (Array.isArray(items) && items.length) {
				company.div = items.map((d) => ({
					fy: d.year,
					divCash: roundToTwoDecimals(d.cash),
					bonus: 0,
					rtShare: 0,
					bkClsDt: dateOnly(d.book_close_date),
					addDt: dateOnly(d.annoucement_date),
				})).filter((d) => Object.values(d).some((v) => v !== undefined));
			}
			console.log(`Fetched dividends for ${company.sym}`);
		} catch (error) {
			console.log(`Error fetching dividends for ${company.sym}: ${formatError(error)}`);
		}
	});
	console.log(`Completed fetching mutual fund dividends`);
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
	mfNavs: mutualFundNavs,
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

	// if (Array.isArray(data)) {
	// 	return data.slice(0, 10);
	// }

	// if (Array.isArray(data.d)) {
	// 	return { ...data, d: data.d.slice(0, 10) };
	// }

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

async function fetchMutualFundNavs({ pageLength = MF_PAGE_LENGTH } = {}) {
	const typeConfigs = [
		{ label: "closed", value: -1 },
		{ label: "opened", value: 2 },
	];
	const results = {};

	for (const { label, value } of typeConfigs) {
		const payload = await fetchAllPages(value, pageLength);
		results[label] = payload;
	}

	const output = {
		updatedAt: new Date().toISOString(),
		funds: results,
	};

	return transformMfKeys(removeModifiedBy(output));
}

async function fetchAllPages(typeValue, length) {
	let start = 0;
	let draw = 1;
	let recordsTotal = Number.POSITIVE_INFINITY;
	const rows = [];

	while (start < recordsTotal) {
		const json = await fetchMfPage({ typeValue, start, length, draw });
		if (!json || !Array.isArray(json.data)) {
			throw new Error("Unexpected mutual fund response payload.");
		}

		if (Number.isFinite(json.recordsTotal)) {
			recordsTotal = json.recordsTotal;
		} else if (recordsTotal === Number.POSITIVE_INFINITY) {
			recordsTotal = json.data.length;
		}

		rows.push(...json.data);

		if (json.data.length === 0) {
			break;
		}

		start += length;
		draw += 1;
	}

	return {
		total: recordsTotal,
		data: rows,
	};
}

async function fetchMfPage({ typeValue, start, length, draw }) {
	const params = new URLSearchParams();
	params.set("draw", String(draw));
	params.set("start", String(start));
	params.set("length", String(length));
	params.set("search[value]", "");
	params.set("search[regex]", "false");
	params.set("type", String(typeValue));

	const url = `${MF_BASE_URL}?${params.toString()}`;
	const res = await fetch(url, {
		headers: {
			"X-Requested-With": "XMLHttpRequest",
			Accept: "application/json, text/javascript, */*; q=0.01",
		},
	});

	if (!res.ok) {
		throw new Error(`Mutual fund request failed: ${res.status} ${res.statusText}`);
	}

	return res.json();
}

function removeModifiedBy(data) {
	if (data === null || typeof data !== "object") {
		return data;
	}

	if (Array.isArray(data)) {
		return data.map((item) => removeModifiedBy(item));
	}

	const cleaned = {};
	for (const [key, value] of Object.entries(data)) {
		if (key === "modifiedBy") {
			continue;
		}
		cleaned[key] = removeModifiedBy(value);
	}
	return cleaned;
}

function transformMfKeys(data) {
	const keyMap = {
		companyid: "id",
		companyname: "name",
		fund_size: "fundSize",
		maturity_date: "maturityDate",
		maturity_period: "maturityPeriod",
		daily_nav_price: "dailyNav",
		daily_date: "dailyNavDate",
		weekly_nav_price: "weeklyNav",
		weekly_date: "weeklyNavDate",
		monthly_nav_price: "monthlyNav",
		monthly_date: "monthlyNavDate",
		close: "marketPrice",
		published_date: "publishedDate",
		prem_dis: "premiumDiscount",
		refund_nav: "redemptionNav",
		fetched_at: "updatedAt",
		records_total: "total",
	};

	const removeKeys = new Set(["DT_Row_Index", "type", "modifiedBy"]);

	function transform(obj) {
		if (obj === null || typeof obj !== "object") {
			return obj;
		}

		if (Array.isArray(obj)) {
			return obj.map(transform);
		}

		const result = {};
		for (const [key, value] of Object.entries(obj)) {
			if (removeKeys.has(key)) {
				continue;
			}
			const newKey = keyMap[key] || key;
			result[newKey] = transform(value);
		}
		return result;
	}

	return transform(data);
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

async function fetchJsonWithRetry(url, currentHeaders, options = {}) {
	let lastError;
	for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
		try {
			const response = await fetchJson(url, currentHeaders, options);
			if (response?.status === 401 || response?.status === 403) {
				lastError = new Error(`auth_failed status=${response.status}`);
			} else if (!shouldRetry(response)) {
				return response;
			} else {
				lastError = new Error(
					`request_failed status=${response?.status ?? "unknown"}`,
				);
			}
		} catch (error) {
			lastError = error;
		}
		if (attempt < MAX_RETRIES) {
			await sleep(RETRY_DELAY_MS * attempt);
		}
	}
	return undefined;
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

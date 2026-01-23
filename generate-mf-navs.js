import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const BASE_URL = "https://www.sharesansar.com/mutual-fund-navs";
const DEFAULT_OUT = "public/mf.json";
const DEFAULT_LENGTH = 50;

const TYPE_MAP = new Map([
	["closed", -1],
	["opened", 2],
]);

const args = process.argv.slice(2);
let outPath = DEFAULT_OUT;
let typeArg = "all";
let pageLength = DEFAULT_LENGTH;
let forceScrape = false;

for (let i = 0; i < args.length; i += 1) {
	const arg = args[i];
	if (arg === "--out") {
		outPath = args[i + 1];
		i += 1;
	} else if (arg === "--type") {
		typeArg = args[i + 1];
		i += 1;
	} else if (arg === "--length") {
		pageLength = Number.parseInt(args[i + 1], 10);
		i += 1;
	} else if (arg === "--force") {
		forceScrape = true;
	} else if (arg === "--help" || arg === "-h") {
		printUsageAndExit(0);
	} else {
		printUsageAndExit(1);
	}
}

if (!Number.isFinite(pageLength) || pageLength <= 0) {
	console.error("Invalid --length value. Must be a positive number.");
	process.exit(1);
}

const resolvedOut = resolve(outPath);


const typeConfigs = resolveTypes(typeArg);
const results = {};

for (const { label, value } of typeConfigs) {
	const payload = await fetchAllPages(value, pageLength);
	results[label] = payload;
}

const output = {
	updatedAt: new Date().toISOString(),
	funds: results,
};

const cleanedOutput = transformKeys(removeModifiedBy(output));

const isTypeScript =
	resolvedOut.endsWith(".ts") || resolvedOut.endsWith(".tsx");
const fileBody = isTypeScript
	? `${toTypeScriptModule(cleanedOutput)}\n`
	: `${JSON.stringify(cleanedOutput, null, 2)}\n`;
await mkdir(dirname(resolvedOut), { recursive: true });
await writeFile(resolvedOut, fileBody, "utf8");

console.log(`Saved ${resolvedOut}`);

function resolveTypes(input) {
	if (!input || input === "all") {
		return [
			{ label: "closed", value: TYPE_MAP.get("closed") },
			{ label: "opened", value: TYPE_MAP.get("opened") },
		];
	}

	if (TYPE_MAP.has(input)) {
		return [{ label: input, value: TYPE_MAP.get(input) }];
	}

	if (input === "-1" || input === "2") {
		const label = input === "-1" ? "closed" : "opened";
		return [{ label, value: Number.parseInt(input, 10) }];
	}

	console.error(`Unknown --type value: ${input}`);
	printUsageAndExit(1);
}

async function fetchAllPages(typeValue, length) {
	let start = 0;
	let draw = 1;
	let recordsTotal = Number.POSITIVE_INFINITY;
	const rows = [];

	while (start < recordsTotal) {
		const json = await fetchPage({ typeValue, start, length, draw });
		if (!json || !Array.isArray(json.data)) {
			throw new Error("Unexpected response payload.");
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

async function fetchPage({ typeValue, start, length, draw }) {
	const params = new URLSearchParams();
	params.set("draw", String(draw));
	params.set("start", String(start));
	params.set("length", String(length));
	params.set("search[value]", "");
	params.set("search[regex]", "false");
	params.set("type", String(typeValue));

	const url = `${BASE_URL}?${params.toString()}`;
	const res = await fetch(url, {
		headers: {
			"X-Requested-With": "XMLHttpRequest",
			Accept: "application/json, text/javascript, */*; q=0.01",
		},
	});

	if (!res.ok) {
		throw new Error(`Request failed: ${res.status} ${res.statusText}`);
	}

	return res.json();
}

function printUsageAndExit(code) {
	console.log(
		[
			"Usage: node scripts/scrape-mutual-fund-navs.mjs [options]",
			"",
			"Options:",
			"  --type   closed|opened|all (default: all)",
			"  --length Page size for the request (default: 100)",
			"  --out    Output path (.ts writes an export module) (default: src/data/mutual-fund-navs.ts)",
			"  --force  Ignore the 8-hour freshness guard",
			"",
			"Examples:",
			"  node scripts/scrape-mutual-fund-navs.mjs --type closed",
			"  node scripts/scrape-mutual-fund-navs.mjs --out data/navs.json",
			"  node scripts/scrape-mutual-fund-navs.mjs --out src/data/mutual-fund-navs.ts",
		].join("\n"),
	);
	process.exit(code);
}

async function isFreshEnough(filePath, maxAgeMs) {
	try {
		const stats = await stat(filePath);
		const ageMs = Date.now() - stats.mtimeMs;
		return ageMs < maxAgeMs;
	} catch {
		return false;
	}
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

function transformKeys(data) {
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

function toTypeScriptModule(payload) {
	return [
		"/* eslint-disable */",
		"// Auto-generated by scripts/scrape-mutual-fund-navs.mjs",
		`export const mutualFundNavs = ${JSON.stringify(payload, null, 2)};`,
		"export default mutualFundNavs;",
	].join("\n");
}

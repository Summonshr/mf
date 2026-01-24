import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import https from "node:https";

const BASE_URL = "https://nepalstock.com";
const API_BASE = `${BASE_URL}/api`;
const WASM_URL = `${BASE_URL}/assets/prod/css.wasm`;
const COMPANIES_PATH = "public/nepse-market.json";
const DEFAULT_OUT_DIR = "public/security";

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
  imports: { imported_func: () => {} },
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

for (const company of companies) {
  const companyId = company.id;
  const symbol = company.sym;

  const response = await fetchJsonWithRetry(
    `${API_BASE}/nots/security/${companyId}`,
    {
      method: "POST",
      body: { id: companyId },
      headers: {
        Origin: BASE_URL,
        Referer: `${BASE_URL}/company/detail/${companyId}`,
      },
    }
  );

  if (!response || response.status >= 400) {
    console.log(`Skipped ${symbol ?? companyId}: request failed`);
    continue;
  }

  const output = response.data?.d ?? response.data;
  const safeSymbol = (symbol ?? String(companyId)).replace(/\//g, "-");
  const filePath = resolve(resolvedOutDir, `${safeSymbol}.json`);
  await writeFile(filePath, JSON.stringify(output, null, 2) + "\n", "utf8");
  console.log(`Saved ${filePath}`);
}

console.log(`Done. Saved ${companies.length} files to ${resolvedOutDir}`);

function printUsageAndExit(code) {
  console.log(
    [
      "Usage: node scrape-security.mjs [options]",
      "",
      "Options:",
      `  --out-dir  Output directory for JSON files (default: ${DEFAULT_OUT_DIR})`,
    ].join("\n")
  );
  process.exit(code);
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
      }
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

  const token = cleanToken(proveData.accessToken, proveData, wasm.instance.exports);

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
  return data.status === "error" || data.status === "ERROR" || Boolean(data.error);
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
          `request_failed status=${response?.status ?? "unknown"} body=${summarizeResponseBody(response?.data)}`
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

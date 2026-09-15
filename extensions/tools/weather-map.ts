/**
 * weather-map.ts — 地图气象工具扩展
 *
 * 工具：
 *   weather     天气查询（Open-Meteo，免 key）：地名 → 当前天气 + 未来 N 天预报
 *   geocode     地理编码（高德）：地址 → 经纬度
 *   poi_search  POI 搜索（高德）：关键词 + 城市 → 地点列表
 *   route       驾车路径规划（高德）：起终点（坐标或先经 geocode）→ 距离/时长/路线概要
 *
 * 高德 key：存 Windows 凭据管理器（pi-amap），申请：https://console.amap.com/dev/key/app
 *   绑定方式：powershell -File C:/Users/PC/.pi/agent/bin/pi-cred.ps1 set pi-amap → 重启 pi
 * 无 key 时 weather 可用（Open-Meteo 免 key），高德三工具返回申请指引。
 */

import { exec, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// ---------- key 管理 ----------
let amapKeyCache: string | null | undefined;
function getAmapKey(): string | null {
	if (amapKeyCache !== undefined) return amapKeyCache;
	try {
		const out = execSync(
			'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "C:/Users/PC/.pi/agent/bin/pi-cred.ps1" get pi-amap',
			{ encoding: "utf8", timeout: 15_000 },
		).trim();
		amapKeyCache = /^[0-9a-f]{32}$/i.test(out) ? out : null;
	} catch {
		amapKeyCache = null;
	}
	return amapKeyCache;
}

/** 高德数字签名私钥（可选）：凭据 pi-amap-secret。2021-12 后新建 key 强制数字签名。 */
let amapSecretCache: string | null | undefined;
function getAmapSecret(): string | null {
	if (amapSecretCache !== undefined) return amapSecretCache;
	try {
		const out = execSync(
			'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "C:/Users/PC/.pi/agent/bin/pi-cred.ps1" get pi-amap-secret',
			{ encoding: "utf8", timeout: 15_000 },
		).trim();
		amapSecretCache = /^[0-9a-f]{32}$/i.test(out) ? out : null;
	} catch {
		amapSecretCache = null;
	}
	return amapSecretCache;
}

const AMAP_KEY_HINT =
	"高德 API key 未配置。请到 https://console.amap.com/dev/key/app 申请「Web服务」类型 key（免费），然后运行：\npowershell -NoProfile -ExecutionPolicy Bypass -File \"C:/Users/PC/.pi/agent/bin/pi-cred.ps1\" set pi-amap\n再完全重启 pi 生效。";

const AMAP_SIG_HINT =
	"高德 API 报「数字签名无效」：请到 https://console.amap.com/dev/key/app 展开该 key，找到「数字签名」处的 PrivateKey（单独一段 32 位字符），先复制到剪贴板，再运行：\nGet-Clipboard | powershell -NoProfile -ExecutionPolicy Bypass -File \"C:/Users/PC/.pi/agent/bin/pi-cred.ps1\" set pi-amap-secret\n再完全重启 pi 生效。注意：只复制 PrivateKey 单独一列，勿连带 Key 或其他值。";

// ---------- HTTP ----------
async function fetchJson(url: string, headers?: Record<string, string>): Promise<any> {
	const res = await fetch(url, { signal: AbortSignal.timeout(12_000), headers });
	if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => "")}`);
	return res.json();
}

function ok(text: string) {
	return { content: [{ type: "text" as const, text }] };
}
function fail(text: string) {
	return { content: [{ type: "text" as const, text }], isError: true as const };
}

// ---------- WMO 天气码 ----------
const WMO: Record<number, string> = {
	0: "晴", 1: "基本晴", 2: "多云", 3: "阴",
	45: "雾", 48: "雾凇",
	51: "轻毛毛雨", 53: "毛毛雨", 55: "浓毛毛雨",
	56: "冻毛毛雨", 57: "浓冻毛毛雨",
	61: "小雨", 63: "中雨", 65: "大雨", 66: "冻雨", 67: "强冻雨",
	71: "小雪", 73: "中雪", 75: "大雪", 77: "雪粒",
	80: "小阵雨", 81: "阵雨", 82: "强阵雨",
	85: "小阵雪", 86: "阵雪",
	95: "雷暴", 96: "雷暴伴冰雹", 99: "强雷暴伴冰雹",
};
const wmo = (code: number): string => WMO[code] ?? `未知(${code})`;

// ---------- Open-Meteo ----------
async function openMeteoWeather(location: string, days: number): Promise<string> {
	const geo = await fetchJson(
		`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=zh&format=json`,
	);
	const place = geo?.results?.[0];
	if (!place) return `找不到地点「${location}」，请换更明确的名称（如"北京市""上海市浦东新区"）。`;

	const fc = await fetchJson(
		`https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
			`&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m` +
			`&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max` +
			`&timezone=auto&forecast_days=${days}`,
	);
	const c = fc.current ?? {};
	const d = fc.daily ?? {};
	const region = [place.admin1, place.admin2, place.country].filter(Boolean).join(" · ");
	const lines: string[] = [`📍 ${place.name}（${region}）`];
	lines.push(
		`现在：${wmo(c.weather_code)} ${Math.round(c.temperature_2m)}°C（体感 ${Math.round(c.apparent_temperature)}°C）｜湿度 ${c.relative_humidity_2m}%｜风速 ${Math.round(c.wind_speed_10m)} km/h`,
	);
	if (Array.isArray(d.time)) {
		lines.push(`未来 ${d.time.length} 天：`);
		for (let i = 0; i < d.time.length; i++) {
			lines.push(
				`  ${d.time[i]}：${wmo(d.weather_code?.[i])} ${Math.round(d.temperature_2m_min?.[i])}~${Math.round(d.temperature_2m_max?.[i])}°C｜降水 ${(d.precipitation_sum?.[i] ?? 0).toFixed(1)}mm｜最大风 ${Math.round(d.wind_speed_10m_max?.[i] ?? 0)} km/h`,
			);
		}
	}
	return lines.join("\n");
}

// ---------- 高德 ----------
async function amap(path: string, params: Record<string, string>): Promise<any> {
	const key = getAmapKey();
	if (!key) throw new Error(AMAP_KEY_HINT);
	const full: Record<string, string> = { ...params, key };
	// 数字签名（若私钥已配置）：sig = md5("/v3/<path>?<参数按key升序原文拼接>" + privateKey)
	const secret = getAmapSecret();
	if (secret) {
		// 高德数字签名（实测 2026-09-07）：md5(参数按key升序原文拼接 + 私钥)，不带路径前缀
		const sorted = Object.keys(full)
				.sort()
				.map((k) => `${k}=${full[k]}`)
				.join("&");
		full.sig = createHash("md5").update(`${sorted}${secret}`).digest("hex");
	}
	const qs = new URLSearchParams(full).toString();
	const data = await fetchJson(`https://restapi.amap.com/v3/${path}?${qs}`);
	if (String(data.status) !== "1" || (data.infocode && data.infocode !== "10000")) {
		const infocode = String(data.infocode ?? "?");
		if (infocode === "10007") throw new Error(AMAP_SIG_HINT);
		throw new Error(`高德 API 错误：${data.info ?? "未知"}（infocode ${infocode}）`);
	}
	return data;
}

function parseLngLat(s: string): string | null {
	const m = /^(\d{2,3}\.\d+),(\d{2,3}\.\d+)$/.exec(s.trim());
	return m ? `${m[1]},${m[2]}` : null;
}

// ---------- 免 key 降级链路（OSM 生态公共服务，高德不可用时） ----------
const OSM_NOTE = "（OSM 公共服务数据，精度略逊高德；高德签名修复后自动切回）";

interface OsmPlace {
	name: string;
	lngLat: string;
}

async function nominatimSearch(q: string, limit = 3): Promise<OsmPlace[]> {
	const data: any = await fetchJson(
		`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=${limit}&accept-language=zh`,
		{ "User-Agent": "pi-weather-map/1.0" },
	);
	return (Array.isArray(data) ? data : []).map((r: any) => ({
		name: String(r.display_name ?? q),
		lngLat: `${r.lon},${r.lat}`,
	}));
}

async function osrmRoute(origin: string, destination: string): Promise<{ text: string; coords: [number, number][] }> {
	const data: any = await fetchJson(
		`https://router.project-osrm.org/route/v1/driving/${origin};${destination}?overview=full&geometries=geojson&steps=true`,
	);
	const r = data?.routes?.[0];
	if (!r) throw new Error("OSRM 未规划出路线。");
	const km = (r.distance / 1000).toFixed(1);
	const min = Math.round(r.duration / 60);
	const roadNames: string[] = [];
	for (const leg of r.legs ?? [])
		for (const s of leg.steps ?? [])
			if (s.name && !roadNames.includes(s.name) && roadNames.length < 6) roadNames.push(s.name);
	const coords: [number, number][] = (r.geometry?.coordinates ?? []).map((c: number[]) => [c[1], c[0]]);
	return {
		text: `🚗 ${km} km，理论约 ${min} 分钟（OSM 无实时路况，高峰时段请酌情增加）${OSM_NOTE}\n途经：${roadNames.join(" → ") || "（路线细节省略）"}`,
		coords,
	};
}

// ---------- 交互地图（方案 C）：本地 Leaflet HTML ----------
function buildRouteMapHtml(
	coords: [number, number][],
	fromName: string,
	toName: string,
	mobileUri: string,
): string {
	return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>路线：${fromName} → ${toName}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css"/>
<style>body{margin:0}#map{width:100vw;height:100vh}</style>
</head>
<body>
<div id="map"></div>
<div id="qr-panel" style="position:fixed;top:12px;right:12px;z-index:1000;background:#fff;padding:10px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.3);text-align:center">
<div id="qr"></div>
<div style="font:12px sans-serif;color:#333;margin-top:6px">手机扫码 → 高德App导航</div>
</div>
<script src="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="https://cdn.jsdelivr.net/gh/davidshimjs/qrcodejs/qrcode.min.js"></script>
<script>
const route = ${JSON.stringify(coords)};
const MOBILE_URI = ${JSON.stringify(mobileUri)};
const map = L.map('map');
L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', {subdomains:'1234', maxZoom:18, attribution:'© 高德/OSM'}).addTo(map);
L.polyline(route, {color:'#1677ff', weight:6, opacity:0.9}).addTo(map);
L.circleMarker(route[0], {radius:9, color:'#fff', fillColor:'#22c55e', fillOpacity:1, weight:3}).addTo(map).bindPopup('起点：${fromName}').openPopup();
L.circleMarker(route[route.length-1], {radius:9, color:'#fff', fillColor:'#ef4444', fillOpacity:1, weight:3}).addTo(map).bindPopup('终点：${toName}');
map.fitBounds(route, {padding:[40,40]});
new QRCode(document.getElementById('qr'), {text: MOBILE_URI, width:140, height:140, correctLevel: QRCode.CorrectLevel.M});
</script>
</body>
</html>`;
}

function saveAndOpenMap(cwd: string, html: string): string {
	const dir = path.join(cwd, ".pi", "maps");
	fs.mkdirSync(dir, { recursive: true });
	const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
	const file = path.join(dir, `route-${ts}.html`);
	fs.writeFileSync(file, html, "utf8");
	try {
		exec(`start "" ${JSON.stringify(file)}`);
	} catch {
		/* 打开失败不影响结果返回 */
	}
	return file;
}

// 高德官方导航 URI（方案 A）：浏览器打开即实时可交互导航页
function amapNavUri(
	origin: string,
	destination: string,
	fromName: string,
	toName: string,
): string {
	// 直连高德网页版路线规划页（uri.amap.com 中转页存在参数二次编码问题，实测 2026-09-07）
	return (
		`https://ditu.amap.com/dir?type=car` +
		`&from%5Blnglat%5D=${origin}&from%5Bname%5D=${encodeURIComponent(fromName)}` +
		`&to%5Blnglat%5D=${destination}&to%5Bname%5D=${encodeURIComponent(toName)}`
	);
}

/** 手机端 URI：扫码后唤起高德 App 导航（callnative=1，手机浏览器路径无二次编码问题） */
function amapMobileUri(
	origin: string,
	destination: string,
	fromName: string,
	toName: string,
): string {
	return (
		`https://uri.amap.com/navigation?from=${origin},${encodeURIComponent(fromName)}` +
		`&to=${destination},${encodeURIComponent(toName)}&mode=car&coordinate=gaode&callnative=1`
	);
}

// ---------- 扩展 ----------
export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "weather",
		label: "天气",
		description:
			"查询天气：输入地名（中文/英文），返回当前天气与未来最多 7 天预报（温度/降水/风）。免 API key。",
		parameters: Type.Object({
			location: Type.String({ description: "地名，如「北京市」「上海」「Shenzhen」" }),
			days: Type.Optional(Type.Number({ description: "预报天数 1-7，默认 3", default: 3 })),
		}),
		async execute(_id, params) {
			const days = Math.min(7, Math.max(1, Math.round(params.days ?? 3)));
			try {
				return ok(await openMeteoWeather(params.location, days));
			} catch (err) {
				return fail(`天气查询失败：${(err as Error).message}`);
			}
		},
	});

	pi.registerTool({
		name: "geocode",
		label: "地理编码",
		description: "高德地理编码：地址文本 → 经纬度（lng,lat）与标准地址。route 工具需要坐标。",
		parameters: Type.Object({
			address: Type.String({ description: "地址，如「北京市朝阳区望京SOHO」" }),
			city: Type.Optional(Type.String({ description: "城市名，提高准确度（可选）" })),
		}),
		async execute(_id, params) {
			try {
				const data = await amap("geocode/geo", { address: params.address, ...(params.city ? { city: params.city } : {}) });
				const geos = data.geocodes ?? [];
				if (geos.length === 0) return fail(`未解析到坐标：${params.address}`);
				return ok(
					geos
						.slice(0, 3)
						.map((g: any) => `${g.formatted_address} → ${g.location}（${g.level ?? ""}）`)
						.join("\n"),
				);
			} catch (err) {
				// 高德不可用 → Nominatim 免 key 降级
				try {
					const places = await nominatimSearch(params.address, 3);
				if (places.length === 0) return fail(`未解析到坐标：${params.address}`);
					return ok(places.map((p) => `${p.name} → ${p.lngLat}`).join("\n") + `\n${OSM_NOTE}`);
				} catch {
					return fail((err as Error).message);
				}
			}
		},
	});

	pi.registerTool({
		name: "poi_search",
		label: "地点搜索",
		description: "高德 POI 搜索：关键词找地点（餐厅/站点/建筑…），返回名称、地址、坐标。",
		parameters: Type.Object({
			keywords: Type.String({ description: "关键词，如「火锅」「北京西站」" }),
			city: Type.Optional(Type.String({ description: "限定城市（可选）" })),
		}),
		async execute(_id, params) {
			try {
				const data = await amap("place/text", {
					keywords: params.keywords,
					offset: "5",
					page: "1",
					...(params.city ? { city: params.city } : {}),
				});
				const pois = data.pois ?? [];
				if (pois.length === 0) return fail(`未找到 POI：${params.keywords}`);
				return ok(
					pois
						.slice(0, 5)
						.map((p: any) => `${p.name}｜${p.address ?? ""}｜${p.location}`)
						.join("\n"),
				);
			} catch (err) {
				// 高德不可用 → Nominatim 免 key 降级
				try {
					const places = await nominatimSearch(params.keywords + (params.city ? `, ${params.city}` : ""), 5);
					if (places.length === 0) return fail(`未找到 POI：${params.keywords}`);
					return ok(places.map((p) => `${p.name}｜${p.lngLat}`).join("\n") + `\n${OSM_NOTE}`);
				} catch {
					return fail((err as Error).message);
				}
			}
		},
	});

	pi.registerTool({
		name: "route",
		description:
			"高德驾车路径规划：起终点坐标（格式 lng,lat，可先用 geocode 转换地址），返回距离/时长/路线概要，并附高德网页导航链接（浏览器打开可实时交互导航）。设 interactive: true 时额外生成本地交互地图并自动打开。",
		parameters: Type.Object({
			origin: Type.String({ description: "起点坐标 lng,lat" }),
			destination: Type.String({ description: "终点坐标 lng,lat" }),
			fromName: Type.Optional(Type.String({ description: "起点名称（用于导航链接与地图标记）" })),
			toName: Type.Optional(Type.String({ description: "终点名称" })),
			interactive: Type.Optional(Type.Boolean({ description: "生成本地 Leaflet 交互地图并用浏览器打开（用户要求显示地图时用）", default: false })),
		}),
		async execute(_id, params, _sig, _onU, ctx) {
			const origin = parseLngLat(params.origin);
			const destination = parseLngLat(params.destination);
			if (!origin || !destination)
				return fail("坐标格式应为 lng,lat（如 116.481028,39.989643），请先用 geocode 转换地址。");
			const fromName = params.fromName ?? "起点";
			const toName = params.toName ?? "终点";
			const uri = amapNavUri(origin, destination, fromName, toName);
			const render = (text: string, coords: [number, number][]): ReturnType<typeof ok> => {
				let out = `${text}\n🔗 实时导航（浏览器打开）：${uri}`;
				if (params.interactive && coords.length >= 2) {
					const file = saveAndOpenMap(
					ctx?.cwd ?? process.cwd(),
					buildRouteMapHtml(coords, fromName, toName, amapMobileUri(origin, destination, fromName, toName)),
				);
					out += `\n🗺 已生成交互地图并打开：${file}（页面右上角二维码，手机扫码可直接唤起高德App导航）`;
				}
				return ok(out);
			};
			try {
				const data = await amap("direction/driving", { origin, destination });
				// 高德 v3 驾车接口：路线在 route.paths[]（非 routes[]）
				const route0 = data.route?.paths?.[0];
				if (!route0) return fail("未规划出路线。");
				const km = (Number(route0.distance) / 1000).toFixed(1);
				const min = Math.round(Number(route0.duration) / 60);
				const steps = (route0.steps ?? [])
					.map((s: any) => String(s.instruction ?? "").trim())
					.filter(Boolean)
					.slice(0, 8);
				const extra: string[] = [];
				if (route0.tolls && Number(route0.tolls) > 0) extra.push(`过路费 ¥${route0.tolls}`);
				if (data.route?.taxi_cost) extra.push(`打车约 ¥${data.route.taxi_cost}`);
				// 路线坐标（GCJ-02，与高德瓦片匹配）：steps[].polyline = "lng,lat;lng,lat;..."
				const coords: [number, number][] = [];
				for (const s of route0.steps ?? [])
					for (const seg of String(s.polyline ?? "").split(";")) {
						const [lng, lat] = seg.split(",").map(Number);
						if (Number.isFinite(lng) && Number.isFinite(lat)) coords.push([lat, lng]);
					}
				return render(
					`🚗 ${km} km，约 ${min} 分钟${extra.length ? "（" + extra.join("，") + "）" : ""}\n${steps.map((s: string) => `  ${s}`).join("\n")}`,
					coords,
				);
			} catch (err) {
				// 高德不可用 → OSRM 免 key 降级
				try {
					const r = await osrmRoute(origin, destination);
					return render(r.text, r.coords);
				} catch {
					return fail((err as Error).message);
				}
			}
		},
	});
}

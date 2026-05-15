#!/usr/bin/env python3
"""weather.py — 使用 urllib 调用 wttr.in，解析 JSON 并输出中文天气信息。

用法:
    python3 weather.py [城市名]
    python3 weather.py 北京
    python3 weather.py London

不传参数时默认查询 "Beijing"。
所有依赖均为 Python 标准库，无需 pip 安装任何第三方包。
"""

import json
import sys
import time
from urllib.parse import quote
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

# ── WWO (World Weather Online) 天气代码 → 中文描述 ──────────────────────────
# 参考: https://www.worldweatheronline.com/weather-api/api/docs/weather-icons.aspx
WWO_CODE_MAP: dict[str, str] = {
    "113": "晴",
    "116": "大部晴朗",
    "119": "多云",
    "122": "阴天",
    "143": "薄雾",
    "176": "零星阵雨",
    "179": "零星雨夹雪",
    "182": "零星雨淞",
    "185": "零星冻雨",
    "200": "局部雷暴",
    "227": "吹雪",
    "230": "暴风雪",
    "248": "雾",
    "260": "冻雾",
    "263": "零星小雨",
    "266": "小雨",
    "281": "冻毛毛雨",
    "284": "大雨淞",
    "293": "零星毛毛雨",
    "296": "毛毛雨",
    "299": "中雨",
    "302": "中雨转大雨",
    "305": "大雨",
    "308": "暴雨",
    "311": "冰雹",
    "314": "冰粒",
    "317": "雨淞",
    "320": "阵雪",
    "323": "零星小雪",
    "326": "小雪",
    "329": "中雪",
    "332": "大雪",
    "335": "暴雪",
    "338": "大雪",
    "350": "冰雹",
    "353": "零星阵雨",
    "356": "中雨",
    "359": "暴雨",
    "362": "零星雨夹雪",
    "365": "中雨夹雪",
    "368": "小雪",
    "371": "中雪",
    "374": "冰粒",
    "377": "冰雹",
    "386": "局部雷雨",
    "389": "强雷暴",
    "392": "零星雷雪",
    "395": "大雪",
}


def _fetch_weather(city: str) -> dict:
    """拉取 wttr.in 的 JSON 天气数据。

    如果网络不可达或 API 返回非 200，直接打印错误并退出。
    """
    url = f"https://wttr.in/{quote(city)}?format=j1"
    req = Request(url, headers={"User-Agent": "weather.py/1.0"})

    try:
        with urlopen(req, timeout=15) as resp:
            raw = resp.read().decode("utf-8")
    except HTTPError as e:
        print(f"HTTP {e.code}: wttr.in 返回错误 ({city})", file=sys.stderr)
        sys.exit(1)
    except URLError as e:
        print(f"网络不可达: {e.reason}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"未知错误: {e}", file=sys.stderr)
        sys.exit(1)

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"JSON 解析失败: {e}", file=sys.stderr)
        sys.exit(1)

    return data


def _extract_fields(data: dict) -> dict:
    """从 wttr.in JSON 中提取关键字段。"""
    cur = data["current_condition"][0]
    area = data.get("nearest_area", [{}])[0]

    city_cn = (
        area.get("areaName", [{}])[0].get("value", "未知")
        or area.get("region", [{}])[0].get("value", "未知")
    )
    country = area.get("country", [{}])[0].get("value", "")

    # 天气代码 → 中文
    code = cur.get("weatherCode", "???")
    weather_cn = WWO_CODE_MAP.get(code, f"未知(代码:{code})")

    return {
        "city": f"{city_cn}, {country}".strip(", "),
        "weather": weather_cn,
        "weather_code": code,
        "temp_c": cur.get("temp_C"),
        "feels_like_c": cur.get("FeelsLikeC"),
        "humidity": cur.get("humidity"),
        "pressure_mb": cur.get("pressure"),
        "wind_speed_kmph": cur.get("windspeedKmph"),
        "wind_dir_16pt": cur.get("winddir16Point"),
        "wind_dir_deg": cur.get("winddirDegree"),
        "visibility_km": cur.get("visibility"),
        "uv_index": cur.get("uvIndex"),
        "observation_time": cur.get("observation_time"),
        "local_obs_time": cur.get("localObsDateTime"),
    }


def main() -> None:
    city = sys.argv[1] if len(sys.argv) > 1 else "Beijing"

    data = _fetch_weather(city)
    w = _extract_fields(data)

    print("=" * 50)
    print(f"  城市: {w['city']}")
    print(f"  天气: {w['weather']} (WWO 代码: {w['weather_code']})")
    print(f"  温度: {w['temp_c']} °C")
    print(f"  体感: {w['feels_like_c']} °C")
    print(f"  湿度: {w['humidity']}%")
    print(f"  气压: {w['pressure_mb']} mb")
    print(f"  风:   {w['wind_dir_16pt']} {w['wind_speed_kmph']} km/h"
          f" ({w['wind_dir_deg']}°)")
    if w["visibility_km"]:
        print(f"  能见度: {w['visibility_km']} km")
    if w["uv_index"] is not None:
        print(f"  紫外线: {w['uv_index']}")
    print(f"  观测时间(UTC): {w['observation_time']}")
    print(f"  本地观测时间: {w['local_obs_time']}")
    print(f"  脚本运行时间: {time.strftime('%Y-%m-%d %H:%M:%S %Z')}")
    print("=" * 50)


if __name__ == "__main__":
    main()

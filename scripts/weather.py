#!/usr/bin/env python3
"""
weather.py — 使用 wttr.in 获取城市天气并输出中文摘要
纯标准库实现：urllib + json + sys
用法: python weather.py [城市名]
      python weather.py 北京
      python weather.py Tokyo
"""

import json
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone

# ═══════════════════════════════════════════════════
#  WWO 天气代码 → 中文映射表
# ═══════════════════════════════════════════════════
WWO_CODE_MAP = {
    "113": "晴",
    "116": "晴间多云",
    "119": "多云",
    "122": "阴",
    "143": "雾",
    "176": "零星阵雨",
    "179": "零星雨夹雪",
    "182": "零星雨夹冰雹",
    "185": "零星冻雨",
    "200": "局部雷暴",
    "227": "吹雪",
    "230": "暴风雪",
    "248": "雾",
    "260": "冻雾",
    "263": "零星小雨",
    "266": "小雨",
    "281": "冻雨",
    "284": "冰雹",
    "293": "局部小雨",
    "296": "小雨",
    "299": "中雨",
    "302": "中雨",
    "305": "大雨",
    "308": "暴雨",
    "311": "冻毛毛雨",
    "314": "中雨伴冰雹",
    "317": "冻雨伴冰雹",
    "320": "零星雨夹雪",
    "323": "小雪",
    "326": "小雪",
    "329": "中雪",
    "332": "中雪",
    "335": "大雪",
    "338": "暴雪",
    "350": "冰雹",
    "353": "零星阵雨",
    "356": "中阵雨",
    "359": "强阵雨",
    "362": "零星雨夹雪",
    "365": "中雨夹雪",
    "368": "大雪",
    "371": "中雪",
    "374": "零星雨夹冰雹",
    "377": "中雨伴冰雹",
    "386": "局部雷暴伴阵雨",
    "389": "局部雷暴伴暴雨",
    "392": "局部雷暴伴冰雹",
    "395": "大暴雪",
}


def wind_dir_zh(degree: int) -> str:
    """将风向角度 (0–360) 转为中文方向"""
    dirs = [
        "北", "北东北", "东北", "东东北",
        "东", "东东南", "东南", "南东南",
        "南", "南西南", "西南", "西西南",
        "西", "西西北", "西北", "北西北",
    ]
    idx = round(degree / 22.5) % 16
    return dirs[idx]


def fetch_weather(city: str) -> dict:
    """从 wttr.in 获取天气 JSON，失败时退出"""
    safe_city = urllib.request.quote(city)
    url = f"https://wttr.in/{safe_city}?format=j1&lang=zh"

    req = urllib.request.Request(
        url,
        headers={"User-Agent": "weather.py/1.0"},
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        print(f"[错误] HTTP {e.code}: {e.reason}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"[错误] 网络请求失败: {e.reason}", file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"[错误] JSON 解析失败: {e}", file=sys.stderr)
        sys.exit(1)


def main() -> None:
    city = sys.argv[1] if len(sys.argv) > 1 else "Beijing"

    data = fetch_weather(city)

    # ── 城市 ──
    nearest = data.get("nearest_area", [{}])[0]
    area = nearest.get("areaName", [{}])[0]
    city_name = area.get("value", city)
    country = nearest.get("country", [{}])[0].get("value", "")

    # ── 当前天气 ──
    current = data.get("current_condition", [{}])[0]

    wwo_code = current.get("weatherCode", "")
    weather_zh = WWO_CODE_MAP.get(wwo_code, f"未知代码({wwo_code})")

    temp_c    = current.get("temp_C", "N/A")
    feels_like = current.get("FeelsLikeC", "N/A")
    humidity  = current.get("humidity", "N/A")
    pressure  = current.get("pressure", "N/A")

    wind_speed = current.get("windspeedKmph", "N/A")
    wind_deg   = current.get("winddirDegree")
    wind_dir   = wind_dir_zh(int(wind_deg)) if wind_deg and wind_deg.isdigit() else "N/A"

    obs_time = current.get("observation_time", "N/A")
    query_time = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # ── 输出 ──
    print(f"城市:     {city_name}{'，' + country if country else ''}")
    print(f"天气:     {weather_zh}")
    print(f"温度:     {temp_c} °C")
    print(f"体感温度: {feels_like} °C")
    print(f"湿度:     {humidity}%")
    print(f"气压:     {pressure} hPa")
    print(f"风速:     {wind_speed} km/h ({wind_dir}风)")
    print(f"观测时间: {obs_time}")
    print(f"查询时间: {query_time}")


if __name__ == "__main__":
    main()

# wttr.in API 结构与 WWO 天气代码调研

> 调研日期：2026-05-15  
> 节点：调研 wttr.in API 结构与 WWO 天气代码

---

## 一、wttr.in JSON 响应结构 (format=j1)

### 1.1 请求方式

```bash
curl "https://wttr.in/{city}?format=j1&lang=zh"
```

支持中文城市名（URL 编码）、英文名、拼音、经纬度坐标。

### 1.2 响应顶层结构

| 字段 | 类型 | 说明 |
|------|------|------|
| `current_condition` | `array[1]` | 当前天气实况（仅 1 条） |
| `weather` | `array[3]` | 3 天预报（每天 8 个时段） |
| `nearest_area` | `array[1]` | 匹配到的最近区域信息 |
| `request` | `array[1]` | 请求解析信息（query/type） |

### 1.3 `current_condition[0]` 字段

| 字段 | 类型 | 说明 | 示例 |
|------|------|------|------|
| `temp_C` | `str` | 当前温度（℃） | `"23"` |
| `temp_F` | `str` | 当前温度（℉） | `"74"` |
| `FeelsLikeC` | `str` | 体感温度（℃） | `"24"` |
| `humidity` | `str` | 湿度（%） | `"73"` |
| `weatherCode` | `str` | WWO 天气代码 | `"143"` |
| `weatherDesc` | `list[{value}]` | 天气描述（英文） | `[{"value": "Mist"}]` |
| `lang_zh` | `list[{value}]` | 天气描述（中文） | `[{"value": "薄雾"}]` |
| `weatherIconUrl` | `list[{value}]` | 天气图标 URL | … |
| `windspeedKmph` | `str` | 风速（km/h） | `"13"` |
| `winddir16Point` | `str` | 16 方位风向 | `"S"` |
| `winddirDegree` | `str` | 风向角度（°） | `"188"` |
| `pressure` | `str` | 气压（mbar） | `"1015"` |
| `visibility` | `str` | 能见度（km） | `"5"` |
| `uvIndex` | `str` | 紫外线指数 | `"0"` |
| `precipMM` | `str` | 降水量（mm） | `"0.0"` |
| `cloudcover` | `str` | 云量（%） | `"50"` |
| `observation_time` | `str` | 观测时间（UTC） | `"02:00 PM"` |
| `localObsDateTime` | `str` | 本地观测时间 | `"2026-05-15 10:00 PM"` |

### 1.4 `weather[0]` 单日预报结构

| 字段 | 类型 | 说明 |
|------|------|------|
| `date` | `str` | 日期 `YYYY-MM-DD` |
| `maxtempC` / `mintempC` | `str` | 最高/最低温度（℃） |
| `avgtempC` | `str` | 平均温度（℃） |
| `sunHour` | `str` | 日照时长（小时） |
| `uvIndex` | `str` | 紫外线指数 |
| `astronomy` | `array[1]` | 天文数据（日出/日落/月相等） |
| `hourly` | `array[8]` | 逐小时预报（每 3 小时 1 条） |

### 1.5 `hourly[i]` 逐小时字段

包含 `tempC`、`weatherCode`、`weatherDesc`、`lang_zh`、`humidity`、`windspeedKmph`、`winddir16Point`、`pressure`、`visibility`、`uvIndex`、`precipMM`、`cloudcover`、`chanceofrain`、`chanceofsnow`、`FeelsLikeC` 等。

### 1.6 `nearest_area[0]` 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `areaName` | `list[{value}]` | 区域名称 |
| `country` | `list[{value}]` | 国家 |
| `region` | `list[{value}]` | 地区 |
| `latitude` / `longitude` | `str` | 经纬度 |
| `population` | `str` | 人口 |

---

## 二、WWO 天气代码完整映射表（48 个）

数据来源：World Weather Online 官方条件代码（`wwoConditionCodes.txt`）+ wttr.in `constants.py`。

| 代码 | 英文描述 | 中文描述 | Emoji | wttr.in 常量名 |
|------|----------|----------|-------|----------------|
| 113 | Clear/Sunny | 晴 / 晴朗 | ☀️ | Sunny |
| 116 | Partly Cloudy | 多云间晴 | ⛅ | PartlyCloudy |
| 119 | Cloudy | 多云 | ☁️ | Cloudy |
| 122 | Overcast | 阴天 | ☁️ | VeryCloudy |
| 143 | Mist | 薄雾 | 🌫️ | Fog |
| 176 | Patchy rain nearby | 局部阵雨 | 🌦️ | LightShowers |
| 179 | Patchy snow nearby | 局部阵雪 | 🌨️ | LightSleetShowers |
| 182 | Patchy sleet nearby | 局部雨夹雪 | 🌧️❄️ | LightSleet |
| 185 | Patchy freezing drizzle nearby | 局部冻毛毛雨 | 🌧️❄️ | LightSleet |
| 200 | Thundery outbreaks in nearby | 邻近雷暴 | ⛈️ | ThunderyShowers |
| 227 | Blowing snow | 吹雪 | 💨❄️ | LightSnow |
| 230 | Blizzard | 暴风雪 | 🌨️💨 | HeavySnow |
| 248 | Fog | 雾 | 🌫️ | Fog |
| 260 | Freezing fog | 冻雾 | 🌫️❄️ | Fog |
| 263 | Patchy light drizzle | 局部小毛毛雨 | 🌦️ | LightShowers |
| 266 | Light drizzle | 小毛毛雨 | 🌧️ | LightRain |
| 281 | Freezing drizzle | 冻毛毛雨 | 🌧️❄️ | LightSleet |
| 284 | Heavy freezing drizzle | 重度冻毛毛雨 | 🌧️❄️ | LightSleet |
| 293 | Patchy light rain | 局部小雨 | 🌦️ | LightRain |
| 296 | Light rain | 小雨 | 🌧️ | LightRain |
| 299 | Moderate rain at times | 间歇性中雨 | 🌧️ | HeavyShowers |
| 302 | Moderate rain | 中雨 | 🌧️ | HeavyRain |
| 305 | Heavy rain at times | 间歇性大雨 | 🌧️ | HeavyShowers |
| 308 | Heavy rain | 大雨 | 🌧️ | HeavyRain |
| 311 | Light freezing rain | 小冻雨 | 🌧️❄️ | LightSleet |
| 314 | Moderate or Heavy freezing rain | 中到大冻雨 | 🌧️❄️ | LightSleet |
| 317 | Light sleet | 小雨夹雪 | 🌧️❄️ | LightSleet |
| 320 | Moderate or heavy sleet | 中到大雨夹雪 | 🌧️❄️ | LightSnow |
| 323 | Patchy light snow | 局部小雪 | 🌨️ | LightSnowShowers |
| 326 | Light snow | 小雪 | 🌨️ | LightSnowShowers |
| 329 | Patchy moderate snow | 局部中雪 | 🌨️ | HeavySnow |
| 332 | Moderate snow | 中雪 | 🌨️ | HeavySnow |
| 335 | Patchy heavy snow | 局部大雪 | ❄️ | HeavySnowShowers |
| 338 | Heavy snow | 大雪 | ❄️ | HeavySnow |
| 350 | Ice pellets | 冰粒 | 🧊 | LightSleet |
| 353 | Light rain shower | 小阵雨 | 🌦️ | LightShowers |
| 356 | Moderate or heavy rain shower | 中到大阵雨 | 🌧️ | HeavyShowers |
| 359 | Torrential rain shower | 暴雨 / 倾盆大雨 | 🌧️💦 | HeavyRain |
| 362 | Light sleet showers | 小阵雨夹雪 | 🌧️❄️ | LightSleetShowers |
| 365 | Moderate or heavy sleet showers | 中到大阵雨夹雪 | 🌧️❄️ | LightSleetShowers |
| 368 | Light snow showers | 小阵雪 | 🌨️ | LightSnowShowers |
| 371 | Moderate or heavy snow showers | 中到大阵雪 | ❄️ | HeavySnowShowers |
| 374 | Light showers of ice pellets | 小冰粒阵雨 | 🧊🌧️ | LightSleetShowers |
| 377 | Moderate or heavy showers of ice pellets | 中到大冰粒阵雨 | 🧊🌧️ | LightSleet |
| 386 | Patchy light rain in area with thunder | 局部雷阵雨 | ⛈️🌧️ | ThunderyShowers |
| 389 | Moderate or heavy rain in area with thunder | 中到大雷雨 | ⛈️🌧️ | ThunderyHeavyRain |
| 392 | Patchy light snow in area with thunder | 局部雷阵雪 | ⛈️❄️ | ThunderySnowShowers |
| 395 | Moderate or heavy snow in area with thunder | 中到大雷阵雪 | ⛈️❄️ | HeavySnowShowers |

---

## 三、关键发现

1. **WWO 代码总数为 48 个**（113–395），这是 World Weather Online 的完整公开条件代码集（非 50+）。
2. **wttr.in 使用了其中全部 48 个代码**，但内部将其归约为 18 种类别（如多个代码映射到 `LightSleet`），通过 `WEATHER_SYMBOL` 字典统一图标。
3. **lang=zh 参数**可在 `lang_zh` 字段返回中文描述，但仅部分字段本地化（`weatherDesc` 仍返回英文）。
4. **`current_condition` 只有一个条目**，而 `weather` 固定返回 3 天预报，每天 8 个 `hourly` 时段。
5. **所有数值均为字符串类型**，需要 `float()` / `int()` 转换后使用。

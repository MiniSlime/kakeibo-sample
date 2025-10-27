import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

const forecastSchema = z.object({
  date: z.string(),
  maxTemp: z.number(),
  minTemp: z.number(),
  precipitationChance: z.number(),
  condition: z.string(),
  location: z.string(),
});

function getWeatherCondition(code: number): string {
  const conditions: Record<number, string> = {
    0: 'Clear sky',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Foggy',
    48: 'Depositing rime fog',
    51: 'Light drizzle',
    53: 'Moderate drizzle',
    55: 'Dense drizzle',
    61: 'Slight rain',
    63: 'Moderate rain',
    65: 'Heavy rain',
    71: 'Slight snow fall',
    73: 'Moderate snow fall',
    75: 'Heavy snow fall',
    95: 'Thunderstorm',
  };
  return conditions[code] || 'Unknown';
}

const fetchWeather = createStep({
  id: 'fetch-weather',
  description: '指定された都市の天気予報を取得します',
  inputSchema: z.object({
    city: z.string().describe('天気予報を取得する都市'),
  }),
  outputSchema: forecastSchema,
  execute: async ({ inputData }) => {
    if (!inputData) {
      throw new Error('入力データが見つかりません');
    }

    const geocodingUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(inputData.city)}&count=1`;
    const geocodingResponse = await fetch(geocodingUrl);
    const geocodingData = (await geocodingResponse.json()) as {
      results: { latitude: number; longitude: number; name: string }[];
    };

    if (!geocodingData.results?.[0]) {
      throw new Error(`場所 '${inputData.city}' が見つかりません`);
    }

    const { latitude, longitude, name } = geocodingData.results[0];

    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=precipitation,weathercode&timezone=auto,&hourly=precipitation_probability,temperature_2m`;
    const response = await fetch(weatherUrl);
    const data = (await response.json()) as {
      current: {
        time: string;
        precipitation: number;
        weathercode: number;
      };
      hourly: {
        precipitation_probability: number[];
        temperature_2m: number[];
      };
    };

    const forecast = {
      date: new Date().toISOString(),
      maxTemp: Math.max(...data.hourly.temperature_2m),
      minTemp: Math.min(...data.hourly.temperature_2m),
      condition: getWeatherCondition(data.current.weathercode),
      precipitationChance: data.hourly.precipitation_probability.reduce(
        (acc, curr) => Math.max(acc, curr),
        0,
      ),
      location: name,
    };

    return forecast;
  },
});

const planActivities = createStep({
  id: 'plan-activities',
  description: '天気予報に基づいてアクティビティを提案します',
  inputSchema: forecastSchema,
  outputSchema: z.object({
    activities: z.string().describe('提案されたアクティビティのテキスト'),
  }),
  execute: async ({ inputData, mastra }) => {
    const forecast = inputData;

    if (!forecast) {
      throw new Error('予報データが見つかりません');
    }

    const agent = mastra?.getAgent('weatherAgent');
    if (!agent) {
      throw new Error('天気エージェントが見つかりません');
    }

    const prompt = `以下の${forecast.location}の天気予報に基づいて、適切なアクティビティを提案してください。
      ${JSON.stringify(forecast, null, 2)}
      予報の各日について、以下の形式で正確に回答を構成してください。

      📅 [曜日、月 日、年]
      ═══════════════════════════

      🌡️ 天気概要
      • 状況: [簡単な説明]
      • 気温: [X°C/Y°F から A°C/B°F]
      • 降水量: [X% の確率]

      🌅 午前中のアクティビティ
      屋外:
      • [アクティビティ名] - [具体的な場所/ルートを含む簡単な説明]
        最適な時間帯: [特定の時間帯]
        備考: [関連する天候の考慮事項]

      🌞 午後のアクティビティ
      屋外:
      • [アクティビティ名] - [具体的な場所/ルートを含む簡単な説明]
        最適な時間帯: [特定の時間帯]
        備考: [関連する天候の考慮事項]

      🏠 屋内での代替案
      • [アクティビティ名] - [具体的な場所を含む簡単な説明]
        理想的な状況: [この代替案がトリガーされる天候条件]

      ⚠️ 特記事項
      • [関連する気象警報、UV指数、風の状態など]

      ガイドライン:
      - 1日あたり2〜3つの時間指定の屋外アクティビティを提案してください。
      - 1〜2つの屋内バックアップオプションを含めてください。
      - 降水量が50%を超える場合は、屋内アクティビティを優先してください。
      - すべてのアクティビティは、その場所に固有のものでなければなりません。
      - 具体的な会場、トレイル、または場所を含めてください。
      - 気温に基づいてアクティビティの強度を考慮してください。
      - 説明は簡潔かつ有益にしてください。

      一貫性を保つため、絵文字とセクションヘッダーを上記のとおり正確に維持してください。`;

    const response = await agent.stream([
      {
        role: 'user',
        content: prompt,
      },
    ]);

    let activitiesText = '';

    for await (const chunk of response.textStream) {
      process.stdout.write(chunk);
      activitiesText += chunk;
    }

    return {
      activities: activitiesText,
    };
  },
});

const weatherWorkflow = createWorkflow({
  id: 'weather-workflow',
  inputSchema: z.object({
    city: z.string().describe('天気予報を取得する都市'),
  }),
  outputSchema: z.object({
    activities: z.string().describe('提案されたアクティビティのテキスト'),
  }),
})
  .then(fetchWeather)
  .then(planActivities);

weatherWorkflow.commit();

export { weatherWorkflow };

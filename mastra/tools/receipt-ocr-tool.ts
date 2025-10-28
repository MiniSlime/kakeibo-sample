import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

// グローバルストレージ: runIdごとに画像URLを保存
const imageUrlStorage = new Map<string, string>();

export function setImageUrlForRun(runId: string, imageUrl: string) {
  imageUrlStorage.set(runId, imageUrl);
}

export function clearImageUrlForRun(runId: string) {
  imageUrlStorage.delete(runId);
}

// 画像URLをbase64エンコードされたData URLに変換
async function imageUrlToBase64(imageUrl: string): Promise<string> {
  try {
    if (imageUrl.startsWith('data:')) {
      return imageUrl;
    }

    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
      return imageUrl;
    }

    return imageUrl;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`画像の処理に失敗しました: ${error.message}`);
    }
    throw new Error(`画像の処理に失敗しました。`);
  }
}

const analyzeReceipt = async (imageUrl: string) => {
  try {
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      throw new Error('OPENAI_API_KEY environment variable is not set');
    }

    const base64ImageUrl = await imageUrlToBase64(imageUrl);

    const prompt = `
このレシート画像から以下の情報を抽出してJSON形式で返してください。
簡潔に、必要最小限の情報のみを返してください。

必須項目:
- storeName: 店舗名
- date: 購入日時 (YYYY-MM-DDTHH:mm:ss形式、時刻不明なら12:00:00)
- items: [{name: 商品名, quantity: 数量, price: 単価, total: 小計}]
- subtotal: 小計
- tax: 消費税
- total: 合計金額

任意項目:
- paymentMethod: 支払い方法（判読できる場合のみ）

レスポンス例:
{"storeName":"コンビニ","date":"2025-10-28T12:00:00","items":[{"name":"商品A","quantity":1,"price":100,"total":100}],"subtotal":100,"tax":10,"total":110}

不明な項目は省略または0にしてください。
`;

    const requestBody = {
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: prompt,
            },
            {
              type: 'image_url',
              image_url: {
                url: base64ImageUrl,
                detail: 'low',
              },
            },
          ],
        },
      ],
      max_tokens: 800,
      response_format: { type: 'json_object' },
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiApiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API error: ${response.status} ${response.statusText}. ${errorText}`);
      }

      const data = await response.json();
      const content = data.choices[0].message.content;
      const receiptData = JSON.parse(content);

      return {
        storeName: receiptData.storeName || '不明',
        date: receiptData.date || new Date().toISOString(),
        items: receiptData.items || [],
        subtotal: receiptData.subtotal || 0,
        tax: receiptData.tax || 0,
        total: receiptData.total || 0,
        paymentMethod: receiptData.paymentMethod,
      };
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        throw new Error('OpenAI APIリクエストがタイムアウトしました（60秒）。画像が大きすぎる可能性があります。');
      }
      throw fetchError;
    }
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`レシート画像の解析に失敗しました: ${error.message}`);
    }
    throw new Error('レシート画像の解析に失敗しました。');
  }
};

export const receiptOcrTool = createTool({
  id: 'receipt-ocr',
  description: 'レシート画像から購入情報を抽出する',
  inputSchema: z.object({
    imageUrl: z.string().describe('レシート画像のURL（base64 data URLまたはHTTPS URLを指定）'),
  }),
  outputSchema: z.object({
    storeName: z.string().describe('店舗名'),
    date: z.string().describe('購入日時'),
    items: z.array(
      z.object({
        name: z.string().describe('商品名'),
        quantity: z.number().describe('数量'),
        price: z.number().describe('単価'),
        total: z.number().describe('小計'),
      })
    ).describe('購入商品リスト'),
    subtotal: z.number().describe('小計'),
    tax: z.number().describe('消費税'),
    total: z.number().describe('合計金額'),
    paymentMethod: z.string().optional().describe('支払い方法'),
  }),
  execute: async (params) => {
    const { context } = params;
    let imageUrl = context.imageUrl;
    
    if (!imageUrl || imageUrl === '') {
      const runId = (params as unknown as { runId?: string }).runId;
      if (runId) {
        const storedUrl = imageUrlStorage.get(runId);
        if (storedUrl) {
          imageUrl = storedUrl;
          clearImageUrlForRun(runId);
        }
      }
    }
    
    return await analyzeReceipt(imageUrl);
  },
});

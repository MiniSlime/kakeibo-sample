import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';

// 画像URLをbase64エンコードされたData URLに変換
async function imageUrlToBase64(imageUrl: string): Promise<string> {
  // すでにdata URLの場合はそのまま返す
  if (imageUrl.startsWith('data:')) {
    return imageUrl;
  }

  // HTTPSのURLの場合は拒否
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    throw new Error('外部URLからの画像取得はサーバー環境制約によりサポートしていません。画像はチャットにファイルとしてアップロードしてください（data:image/... 形式）。');
  }

  // その他の場合はそのまま返す
  return imageUrl;
}

// レシート情報のスキーマ
const receiptSchema = z.object({
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
  category: z.string().optional().describe('カテゴリー'),
});

// ステップ1: レシート画像からOCRで情報を抽出
const extractReceiptInfo = createStep({
  id: 'extract-receipt-info',
  description: 'レシート画像から購入情報を抽出します',
  inputSchema: z.object({
    imageUrl: z.string().describe('レシート画像のURL（base64 data URLまたはHTTPS URLを指定）'),
    category: z.string().optional().describe('支出カテゴリー（食費、日用品など）'),
  }),
  outputSchema: receiptSchema,
  execute: async ({ inputData }) => {
    if (!inputData) {
      throw new Error('入力データが見つかりません');
    }

    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      throw new Error('OPENAI_API_KEY environment variable is not set');
    }

    const base64ImageUrl = await imageUrlToBase64(inputData.imageUrl);

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

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiApiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: prompt
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: base64ImageUrl,
                    detail: 'low'
                  }
                },
              ],
            },
          ],
          max_tokens: 800,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`OpenAI API error: ${JSON.stringify(errorData)}`);
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
        category: inputData.category,
      };
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        throw new Error('OpenAI APIリクエストがタイムアウトしました（60秒）。画像が大きすぎる可能性があります。');
      }
      throw fetchError;
    }
  },
});

// ステップ2: 抽出した情報をスプレッドシートに記録
const recordToSpreadsheet = createStep({
  id: 'record-to-spreadsheet',
  description: 'レシート情報をスプレッドシートに記録します',
  inputSchema: receiptSchema,
  outputSchema: z.object({
    success: z.boolean().describe('記録が成功したかどうか'),
    message: z.string().describe('処理結果のメッセージ'),
    filePath: z.string().describe('記録されたファイルのパス'),
    recordedCount: z.number().describe('記録された行数'),
  }),
  execute: async ({ inputData }) => {
    if (!inputData) {
      throw new Error('レシートデータが見つかりません');
    }

    try {
      const dataDir = path.join(process.cwd(), 'data');
      const csvFilePath = path.join(dataDir, 'kakeibo.csv');

      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      const csvHeader = '日付,店舗名,カテゴリー,商品名,数量,単価,小計,消費税,合計金額,支払い方法\n';

      if (!fs.existsSync(csvFilePath)) {
        fs.writeFileSync(csvFilePath, csvHeader, 'utf-8');
      }

      let recordedCount = 0;
      const category = inputData.category || '未分類';
      const paymentMethod = inputData.paymentMethod || '不明';

      const escapeCSV = (value: string): string => {
        if (value.includes(',') || value.includes('"') || value.includes('\n')) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      };

      for (const item of inputData.items) {
        const row = [
          inputData.date,
          escapeCSV(inputData.storeName),
          escapeCSV(category),
          escapeCSV(item.name),
          item.quantity,
          item.price,
          item.total,
          inputData.tax,
          inputData.total,
          escapeCSV(paymentMethod),
        ].join(',') + '\n';

        fs.appendFileSync(csvFilePath, row, 'utf-8');
        recordedCount++;
      }

      return {
        success: true,
        message: `${recordedCount}件の商品情報を記録しました`,
        filePath: csvFilePath,
        recordedCount,
      };
    } catch (error) {
      return {
        success: false,
        message: `記録に失敗しました: ${error instanceof Error ? error.message : String(error)}`,
        filePath: '',
        recordedCount: 0,
      };
    }
  },
});

// ワークフロー定義: レシート認識 → スプレッドシート記録
const kakeiboWorkflow = createWorkflow({
  id: 'kakeibo-workflow',
  inputSchema: z.object({
    imageUrl: z.string().describe('レシート画像のURL'),
    category: z.string().optional().describe('支出カテゴリー（食費、日用品など）'),
  }),
  outputSchema: z.object({
    success: z.boolean().describe('記録が成功したかどうか'),
    message: z.string().describe('処理結果のメッセージ'),
    filePath: z.string().describe('記録されたファイルのパス'),
    recordedCount: z.number().describe('記録された行数'),
  }),
})
  .then(extractReceiptInfo)
  .then(recordToSpreadsheet);

kakeiboWorkflow.commit();

export { kakeiboWorkflow };

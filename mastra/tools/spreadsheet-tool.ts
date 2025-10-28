import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';

export const spreadsheetTool = createTool({
  id: 'spreadsheet-record',
  description: 'レシート情報をスプレッドシート（CSV）に記録する',
  inputSchema: z.object({
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
    category: z.string().optional().describe('カテゴリー（食費、日用品など）'),
  }),
  outputSchema: z.object({
    success: z.boolean().describe('記録が成功したかどうか'),
    message: z.string().describe('処理結果のメッセージ'),
    filePath: z.string().describe('記録されたファイルのパス'),
    recordedCount: z.number().describe('記録された行数'),
  }),
  execute: async ({ context }) => {
    return await recordToSpreadsheet(context);
  },
});

interface ReceiptData {
  storeName: string;
  date: string;
  items: Array<{
    name: string;
    quantity: number;
    price: number;
    total: number;
  }>;
  subtotal: number;
  tax: number;
  total: number;
  paymentMethod?: string;
  category?: string;
}

const recordToSpreadsheet = async (receiptData: ReceiptData) => {
  try {
    // データディレクトリのパス
    const dataDir = path.join(process.cwd(), 'data');
    const csvFilePath = path.join(dataDir, 'kakeibo.csv');

    // dataディレクトリが存在しない場合は作成
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // CSVヘッダー
    const csvHeader = '日付,店舗名,カテゴリー,商品名,数量,単価,小計,消費税,合計金額,支払い方法\n';

    // ファイルが存在しない場合はヘッダーを作成
    if (!fs.existsSync(csvFilePath)) {
      fs.writeFileSync(csvFilePath, csvHeader, 'utf-8');
    }

    // 各商品を1行ずつ追加
    let recordedCount = 0;
    const category = receiptData.category || '未分類';
    const paymentMethod = receiptData.paymentMethod || '不明';

    for (const item of receiptData.items) {
      const row = [
        receiptData.date,
        escapeCSV(receiptData.storeName),
        escapeCSV(category),
        escapeCSV(item.name),
        item.quantity,
        item.price,
        item.total,
        receiptData.tax,
        receiptData.total,
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
};

// CSVエスケープ処理
const escapeCSV = (value: string): string => {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
};

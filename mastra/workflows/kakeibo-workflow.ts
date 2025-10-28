import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { setImageUrlForRun } from '../tools/receipt-ocr-tool';

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

// ステップ1: レシートOCRエージェントを実行
const runReceiptOcrAgent = createStep({
  id: 'run-receipt-ocr-agent',
  description: 'レシートOCRエージェントを実行してレシート画像から情報を抽出します',
  inputSchema: z.object({
    imageUrl: z.string().describe('レシート画像のURL'),
    category: z.string().optional().describe('支出カテゴリー（食費、日用品など）'),
  }),
  outputSchema: receiptSchema,
  execute: async ({ mastra, inputData, runId }) => {
    if (!inputData) {
      throw new Error('入力データが見つかりません');
    }

    const imageUrlPreview = inputData.imageUrl
      ? (inputData.imageUrl.startsWith('data:') ? `data URL (${inputData.imageUrl.length} chars)` : inputData.imageUrl)
      : 'null';

    console.log('[DEBUG] Step 1 - Receipt OCR Agent');
    console.log('[DEBUG] Input imageUrl:', imageUrlPreview);
    console.log('[DEBUG] Input category:', inputData.category);
    console.log('[DEBUG] RunID:', runId);

    // 画像URLをグローバルストレージに保存
    if (runId) {
      setImageUrlForRun(runId, inputData.imageUrl);
    }

    const agent = mastra.getAgent('receiptOcrAgent');
    
    // エージェント実行時にrunIdを渡す
    const result = await agent.generate(
      '[システム: ユーザーがレシート画像をアップロードしました。receipt-ocrツールを使用してください]',
      {
        runId: runId,
      }
    );

    console.log('[DEBUG] Agent text:', result.text);

    // ツール実行結果から情報を抽出
    const toolResults = result.toolResults || [];
    console.log('[DEBUG] Tool results count:', toolResults.length);
    
    if (toolResults.length === 0) {
      throw new Error('レシートOCRツールが実行されませんでした');
    }

    const ocrResult = toolResults[0].payload.result as Record<string, unknown>;
    console.log('[DEBUG] OCR Result - Store:', ocrResult.storeName);
    console.log('[DEBUG] OCR Result - Items count:', (ocrResult.items as Array<unknown>)?.length || 0);
    console.log('[DEBUG] OCR Result - Total:', ocrResult.total);

    return {
      storeName: (ocrResult.storeName as string) || '不明',
      date: (ocrResult.date as string) || new Date().toISOString(),
      items: (ocrResult.items as Array<{
        name: string;
        quantity: number;
        price: number;
        total: number;
      }>) || [],
      subtotal: (ocrResult.subtotal as number) || 0,
      tax: (ocrResult.tax as number) || 0,
      total: (ocrResult.total as number) || 0,
      paymentMethod: ocrResult.paymentMethod as string | undefined,
      category: inputData.category,
    };
  },
});

// ステップ2: CSV記入エージェントを実行
const runCsvWriterAgent = createStep({
  id: 'run-csv-writer-agent',
  description: 'CSV記入エージェントを実行してレシート情報を記録します',
  inputSchema: receiptSchema,
  outputSchema: z.object({
    success: z.boolean().describe('記録が成功したかどうか'),
    message: z.string().describe('処理結果のメッセージ'),
    filePath: z.string().describe('記録されたファイルのパス'),
    recordedCount: z.number().describe('記録された行数'),
  }),
  execute: async ({ mastra, inputData }) => {
    if (!inputData) {
      throw new Error('レシートデータが見つかりません');
    }

    console.log('[DEBUG] Step 2 - CSV Writer Agent');
    console.log('[DEBUG] Input - Store:', inputData.storeName);
    console.log('[DEBUG] Input - Items count:', inputData.items.length);
    console.log('[DEBUG] Input - Total:', inputData.total);

    const agent = mastra.getAgent('csvWriterAgent');

    const message = `以下のレシート情報をCSVに記録してください:
店舗名: ${inputData.storeName}
日付: ${inputData.date}
カテゴリー: ${inputData.category || '未分類'}
商品数: ${inputData.items.length}件
合計金額: ${inputData.total}円
支払い方法: ${inputData.paymentMethod || '不明'}

商品リスト:
${inputData.items.map((item, i) => `${i + 1}. ${item.name} - ${item.quantity}個 × ${item.price}円 = ${item.total}円`).join('\n')}

消費税: ${inputData.tax}円
小計: ${inputData.subtotal}円`;

    console.log('[DEBUG] Message length:', message.length);

    const result = await agent.generate(message);

    console.log('[DEBUG] Agent text:', result.text);

    const toolResults = result.toolResults || [];
    console.log('[DEBUG] Tool results count:', toolResults.length);
    
    if (toolResults.length === 0) {
      throw new Error('CSVツールが実行されませんでした');
    }

    const csvResult = toolResults[0].payload.result as Record<string, unknown>;
    console.log('[DEBUG] CSV Result - Success:', csvResult.success);
    console.log('[DEBUG] CSV Result - Message:', csvResult.message);
    console.log('[DEBUG] CSV Result - RecordedCount:', csvResult.recordedCount);

    return {
      success: (csvResult.success as boolean) || false,
      message: (csvResult.message as string) || 'CSV記録完了',
      filePath: (csvResult.filePath as string) || '',
      recordedCount: (csvResult.recordedCount as number) || 0,
    };
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
  .then(runReceiptOcrAgent)
  .then(runCsvWriterAgent);

kakeiboWorkflow.commit();

export { kakeiboWorkflow };

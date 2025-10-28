import { Agent } from '@mastra/core/agent';
import { receiptOcrTool } from '../tools/receipt-ocr-tool';

export const receiptOcrAgent = new Agent({
  name: 'Receipt OCR Agent',
  instructions: `あなたはレシート画像解析の専門エージェントです。

## タスク
レシート画像から購入情報を抽出してください。

## ルール
1. receipt-ocrツールを使用してレシート画像を解析する
2. imageUrl引数には空文字列""を渡す（システムが自動的に設定します）
3. 抽出結果をJSON形式で返す

説明は不要です。すぐにツールを呼び出してください。`,
  model: 'openai/gpt-4o',
  tools: { receiptOcrTool },
});
